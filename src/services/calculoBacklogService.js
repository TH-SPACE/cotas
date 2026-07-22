// Matemática compartilhada entre os painéis de Reparos e Instalações: ambos
// partem de "quantidade em aberto por bucket" + "tempo médio por bucket" e chegam
// em previsto/janelas/PU/técnicos do mesmo jeito, só mudando os nomes dos campos
// de origem (backlogReparos/tempoReparoMinutos vs backlogInstalacoes/tempoInstalacaoMinutos)
// e o número de janelas de horário (Reparos usa 2, Instalações usa 4).

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

// PU pode vir de duas formas: um peso único pra tudo (`pu`, usado pelos Reparos) ou
// um total bruto já ponderado por linha (`campoPuBruto`, usado pelas Instalações —
// cada SPECIFICATION_PRODUCT tem seu próprio peso em depara_pu_produto, então o SQL
// já soma o peso ticket-a-ticket e aqui só aplicamos o percentual de "previsto").
function calcularLinhasComPrevisto(linhas, config) {
  const {
    percentual, percentuaisJanela, pu, metaPuTecnico,
    campoBacklog, campoTempo, campoPuBruto, topNVolume = TOP_N_VOLUME_PADRAO,
  } = config;

  const rankBacklog = new Map(
    [...linhas]
      .sort((a, b) => b[campoBacklog] - a[campoBacklog])
      .map((linha, indice) => [linha.bucket, indice])
  );

  return linhas.map(linha => {
    const previstoResolucao = Math.round(linha[campoBacklog] * percentual / 100);
    const janelas = distribuirEmJanelas(previstoResolucao, percentuaisJanela);
    const minutos = janelas.map(qtd => qtd * linha[campoTempo]);
    const puCalculado = campoPuBruto !== undefined
      ? Math.round(linha[campoPuBruto] * percentual / 100 * 100) / 100
      : Math.round(previstoResolucao * pu * 100) / 100;
    const rank = rankBacklog.get(linha.bucket);

    return {
      ...linha,
      previstoResolucao,
      janelas,
      minutos,
      pu: puCalculado,
      tecnicos: Math.ceil(puCalculado / metaPuTecnico),
      maiorVolume: linha[campoBacklog] > 0 && rank < topNVolume,
    };
  });
}

function calcularTotais(totalGeral, linhasComPrevisto, config) {
  const { percentual, percentuaisJanela, metaPuTecnico } = config;
  const totalPrevisto = Math.round(totalGeral * percentual / 100);
  const totalJanelas = distribuirEmJanelas(totalPrevisto, percentuaisJanela);
  const totalMinutos = totalJanelas.map((_, i) =>
    linhasComPrevisto.reduce((acc, l) => acc + l.minutos[i], 0)
  );
  const totalPu = Math.round(linhasComPrevisto.reduce((acc, l) => acc + l.pu, 0) * 100) / 100;

  return {
    totalPrevisto,
    totalJanelas,
    totalMinutos,
    totalPu,
    totalTecnicos: Math.ceil(totalPu / metaPuTecnico),
  };
}

// Mapa aliada -> índice de cor (0..qtd-1), na ordem em que cada aliada aparece,
// para reaproveitar as mesmas cores entre a tabela principal e a do modal de config.
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

module.exports = { calcularLinhasComPrevisto, calcularTotais, construirMapaCoresAliada };
