// Matemática compartilhada entre os painéis de Reparos, Instalações, Serviços e ME:
// todos partem de "quantidade em aberto por bucket" + "tempo médio por bucket" e
// chegam em previsto/sugestão/janelas/PU/técnicos do mesmo jeito, só mudando os
// nomes dos campos de origem (backlogReparos/tempoReparoMinutos vs
// backlogInstalacoes/tempoInstalacaoMinutos etc.) e o número de janelas de horário
// (Reparos usa 2, os outros três usam 4).
//
// Pipeline, nessa ordem (cada etapa depende da anterior):
//   1. calcularPrevisto        -> Previsto (meta bruta de resolução, % do backlog)
//   2. calcularTotalPrevisto   -> Previsto total do tipo (denominador da Sugestão)
//   3. calcularSugestao        -> Sugestão (Carga redistribuída proporcional ao Previsto)
//   4. calcularDistribuicaoPorSugestao -> ORDENS/COTAS(min)/PU/Técnicos, a partir da Sugestão
//   5. calcularTotais          -> linha "Total geral"

const TOP_N_VOLUME_PADRAO = 3;

// `percentuaisJanela` traz o percentual de todas as janelas MENOS a última — a
// última é sempre o restante (100% - soma das outras), igual ao "12:30-18:00" dos
// Reparos já funcionava, só generalizado pra N janelas em vez de fixo em 2.
// Nunca fica negativa: se a soma das editáveis passar de 100%, o restante vira 0.
function distribuirEmJanelas(total, percentuaisJanela) {
  const janelas = [];
  let restante = total;
  percentuaisJanela.forEach(pct => {
    const qtd = Math.round(total * pct / 100);
    janelas.push(qtd);
    restante -= qtd;
  });
  janelas.push(Math.max(0, restante));
  return janelas;
}

// Previsto: meta bruta de resolução (% do backlog em aberto). Continua sendo
// só uma referência exibida na tabela e a base da fatia de cada bucket na
// Sugestão (calcularSugestao) -- não alimenta mais ORDENS/COTAS(min)/PU/Técnicos
// diretamente, isso agora vem da Sugestão (calcularDistribuicaoPorSugestao).
function calcularPrevisto(linhas, config) {
  const { percentual, campoBacklog, topNVolume = TOP_N_VOLUME_PADRAO } = config;

  const rankBacklog = new Map(
    [...linhas]
      .sort((a, b) => b[campoBacklog] - a[campoBacklog])
      .map((linha, indice) => [linha.bucket, indice])
  );

  return linhas.map(linha => {
    const previstoResolucao = Math.round(linha[campoBacklog] * percentual / 100);
    const rank = rankBacklog.get(linha.bucket);

    return {
      ...linha,
      previstoResolucao,
      maiorVolume: linha[campoBacklog] > 0 && rank < topNVolume,
    };
  });
}

function calcularTotalPrevisto(totalGeral, percentual) {
  return Math.round(totalGeral * percentual / 100);
}

// Sugestão: distribui `carga` (configurada por tipo na página de Configurações)
// entre os buckets proporcionalmente à fatia de Previsto de cada um sobre o
// Previsto total do tipo. A partir daqui a Sugestão passa a ser a base de
// ORDENS/COTAS(min)/PU/Técnicos -- ver calcularDistribuicaoPorSugestao.
function calcularSugestao(linhasComPrevisto, totalPrevisto, carga) {
  return linhasComPrevisto.map(linha => ({
    ...linha,
    sugestao: totalPrevisto > 0 ? Math.round(linha.previstoResolucao / totalPrevisto * carga) : 0,
  }));
}

// ORDENS (janelas), COTAS(min) e PU/Técnicos, todos derivados da Sugestão de cada
// bucket (não mais do Previsto). PU pode vir de duas formas: um peso único pra
// tudo (`pu`, usado pelos Reparos) ou um total bruto já ponderado por linha
// (`campoPuBruto`, usado pelas Instalações/Serviços/ME -- cada SPECIFICATION_PRODUCT
// tem seu próprio peso em depara_pu_produto*, o SQL já soma o peso ticket-a-ticket).
// Nesse segundo caso aplicamos a fração do backlog que a Sugestão representa
// (sugestao ÷ backlog) sobre o total bruto de PU do bucket.
function calcularDistribuicaoPorSugestao(linhasComSugestao, config) {
  const { percentuaisJanela, pu, metaPuTecnico, campoBacklog, campoTempo, campoPuBruto } = config;

  return linhasComSugestao.map(linha => {
    const janelas = distribuirEmJanelas(linha.sugestao, percentuaisJanela);
    const minutos = janelas.map(qtd => qtd * linha[campoTempo]);
    const fracaoBacklogSugerida = linha[campoBacklog] > 0 ? linha.sugestao / linha[campoBacklog] : 0;
    const puCalculado = campoPuBruto !== undefined
      ? Math.round(linha[campoPuBruto] * fracaoBacklogSugerida * 100) / 100
      : Math.round(linha.sugestao * pu * 100) / 100;

    return {
      ...linha,
      janelas,
      minutos,
      pu: puCalculado,
      tecnicos: Math.ceil(puCalculado / metaPuTecnico),
    };
  });
}

// Linha "Total geral": Previsto e Sugestão totais são recalculados direto do
// total do cluster (não somam as linhas — evita deriva de arredondamento por
// bucket); ORDENS parte da Sugestão total do mesmo jeito que cada bucket parte
// da própria Sugestão. COTAS(min) e PU continuam somando as linhas, como antes.
function calcularTotais(totalPrevisto, carga, linhasComTudo, config) {
  const { percentuaisJanela, metaPuTecnico } = config;
  const totalSugestao = Math.round(carga);
  const totalJanelas = distribuirEmJanelas(totalSugestao, percentuaisJanela);
  const totalMinutos = totalJanelas.map((_, i) =>
    linhasComTudo.reduce((acc, l) => acc + l.minutos[i], 0)
  );
  const totalPu = Math.round(linhasComTudo.reduce((acc, l) => acc + l.pu, 0) * 100) / 100;

  return {
    totalPrevisto,
    totalSugestao,
    totalJanelas,
    totalMinutos,
    totalPu,
    totalTecnicos: Math.ceil(totalPu / metaPuTecnico),
  };
}

// Mapa aliada -> índice de cor (0..qtd-1), na ordem em que cada aliada aparece,
// para reaproveitar as mesmas cores entre a tabela principal e a página de config.
function construirMapaCoresAliada(qtdCores, ...listas) {
  const mapa = {};
  let indice = 0;
  listas.flat().forEach(item => {
    if (!(item.aliada in mapa)) {
      mapa[item.aliada] = indice % qtdCores;
      indice += 1;
    }
  });
  return mapa;
}

module.exports = {
  calcularPrevisto,
  calcularTotalPrevisto,
  calcularSugestao,
  calcularDistribuicaoPorSugestao,
  calcularTotais,
  construirMapaCoresAliada,
};
