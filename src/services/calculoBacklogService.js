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

// Linha "Total geral": TODAS as colunas somam as linhas exibidas (bottom-up),
// igual COTAS(min) e PU já faziam. Antes Previsto/Sugestão/ORDENS eram
// recalculados direto do total do cluster (achando que "evitava deriva de
// arredondamento"), mas o efeito colateral era pior: a linha de total podia não
// bater com a soma da própria coluna acima dela (ex.: ORDENS de Serviços na
// janela 16:00-18:00 somava 17 nas linhas mas mostrava 15 no total) -- confuso
// pra quem confere a conta na mão. Bottom-up garante que o rodapé SEMPRE fecha
// com o que está na tela.
function calcularTotais(linhasComTudo, config) {
  const { percentuaisJanela, metaPuTecnico } = config;
  const qtdJanelas = percentuaisJanela.length + 1;
  const somarCampo = (campo) => linhasComTudo.reduce((acc, l) => acc + l[campo], 0);

  const totalPrevisto = somarCampo('previstoResolucao');
  const totalSugestao = somarCampo('sugestao');
  const totalJanelas = Array.from({ length: qtdJanelas }, (_, i) =>
    linhasComTudo.reduce((acc, l) => acc + (l.janelas[i] || 0), 0)
  );
  const totalMinutos = totalJanelas.map((_, i) =>
    linhasComTudo.reduce((acc, l) => acc + l.minutos[i], 0)
  );
  const totalPu = Math.round(somarCampo('pu') * 100) / 100;

  return {
    totalPrevisto,
    totalSugestao,
    totalJanelas,
    totalMinutos,
    totalPu,
    totalTecnicos: Math.ceil(totalPu / metaPuTecnico),
  };
}

// Roda o pipeline inteiro (Previsto -> Sugestão -> ORDENS/COTAS/PU/Técnicos ->
// Total) SEPARADAMENTE por (aliada, região) dentro de uma mesma seção -- cada
// grupo tem sua própria config (Previsto%, Carga, %janela, Meta de PU), que
// pode divergir dos outros (ver configAliadaService.js / configAliadaRegiaoService.js).
// O ponto-chave é a Sugestão: como a Carga é por grupo, ela é redistribuída
// DENTRO do grupo (denominador = Previsto total DAQUELE grupo), não da seção
// inteira -- senão a Carga de um grupo "vazaria" pros buckets de outro.
//
// `linha.regiao` (CAPITAL/INTERIOR, ver bucketRegiaoService.js) já vem atribuída
// pelo chamador -- esta função é agnóstica de onde a região veio, só agrupa pelo
// que já está no dado (mesmo padrão de `linha.aliada`). Aliadas sem split
// (hoje: qualquer uma sem bucket capital classificado, incl. VIVO) têm todas as
// linhas na mesma região (INTERIOR, o padrão), então o grupo colapsa pra 1 só --
// comportamento idêntico ao agrupamento por aliada pura de antes.
//
// `configDe(chaveGrupo)` -> { percentual, carga, percentuaisJanela, pu, metaPuTecnico },
// onde `chaveGrupo` = "ALIADA::REGIAO" (quem chama faz o split). `numJanelas`
// (labels.length) garante que uma seção vazia/filtrada ainda devolve arrays de
// total do tamanho certo. O `maiorVolume` (top-N por backlog) continua sendo
// calculado sobre a seção INTEIRA, não por grupo, pra não mudar quais buckets
// aparecem destacados hoje.
function calcularSecaoPorAliadaRegiao(linhas, config) {
  const { campoBacklog, campoTempo, campoPuBruto, numJanelas, configDe } = config;

  const rankBacklog = new Map(
    [...linhas]
      .sort((a, b) => b[campoBacklog] - a[campoBacklog])
      .map((linha, indice) => [linha.bucket, indice])
  );

  // Agrupa por (aliada, região) preservando a ordem em que cada grupo aparece.
  const chaveGrupo = (linha) => `${linha.aliada}::${linha.regiao}`;
  const ordemGrupos = [];
  const grupos = new Map();
  linhas.forEach(linha => {
    const chave = chaveGrupo(linha);
    if (!grupos.has(chave)) { grupos.set(chave, []); ordemGrupos.push(chave); }
    grupos.get(chave).push(linha);
  });

  const linhasPorBucket = new Map();
  const totaisPorAliada = [];

  ordemGrupos.forEach(chave => {
    const cfg = configDe(chave);
    const grupo = grupos.get(chave);

    const comPrevisto = grupo.map(linha => ({
      ...linha,
      previstoResolucao: Math.round(linha[campoBacklog] * cfg.percentual / 100),
      maiorVolume: linha[campoBacklog] > 0 && rankBacklog.get(linha.bucket) < TOP_N_VOLUME_PADRAO,
    }));

    const totalPrevistoAliada = comPrevisto.reduce((acc, l) => acc + l.previstoResolucao, 0);
    const comSugestao = calcularSugestao(comPrevisto, totalPrevistoAliada, cfg.carga);
    const comDistribuicao = calcularDistribuicaoPorSugestao(comSugestao, {
      percentuaisJanela: cfg.percentuaisJanela, pu: cfg.pu, metaPuTecnico: cfg.metaPuTecnico,
      campoBacklog, campoTempo, campoPuBruto,
    });

    comDistribuicao.forEach(l => linhasPorBucket.set(l.bucket, l));
    totaisPorAliada.push(calcularTotais(comDistribuicao, {
      percentuaisJanela: cfg.percentuaisJanela, metaPuTecnico: cfg.metaPuTecnico,
    }));
  });

  // Reconstrói na ordem ORIGINAL de entrada (bucket é único por seção).
  const linhasSaida = linhas.map(linha => linhasPorBucket.get(linha.bucket));

  // Total da seção: soma bottom-up das colunas aditivas + soma dos Técnicos por
  // grupo (cada (aliada,região) é seu próprio "bolo", Técnicos = ceil(PU_grupo / Meta_grupo),
  // então o total da seção é a SOMA desses ceils, não um ceil único).
  const somar = (campo) => linhasSaida.reduce((acc, l) => acc + l[campo], 0);
  const totais = {
    totalPrevisto: somar('previstoResolucao'),
    totalSugestao: somar('sugestao'),
    totalJanelas: Array.from({ length: numJanelas }, (_, i) =>
      linhasSaida.reduce((acc, l) => acc + (l.janelas[i] || 0), 0)
    ),
    totalMinutos: Array.from({ length: numJanelas }, (_, i) =>
      linhasSaida.reduce((acc, l) => acc + (l.minutos[i] || 0), 0)
    ),
    totalPu: Math.round(somar('pu') * 100) / 100,
    totalTecnicos: totaisPorAliada.reduce((acc, t) => acc + t.totalTecnicos, 0),
  };

  return { linhas: linhasSaida, totais };
}

// Cores FIXAS por aliada, pinadas pelo NOME (não mais pela ordem de aparição) --
// o usuário quer ABILITY sempre laranja, ONDACOM sempre azul e VIVO sempre roxo,
// e igual em todas as páginas (antes, sendo por ordem, a mesma aliada podia
// trocar de cor entre telas conforme a ordem dos dados). Os índices batem com as
// classes .aliada-color-N / variáveis --aliada-N-* em style.css (0=laranja,
// 1=azul, 4=roxo).
const ALIADA_COR_FIXA = { ABILITY: 0, ONDACOM: 1, VIVO: 4 };

// Mapa aliada -> índice de cor. Aliada conhecida usa a cor fixa; qualquer aliada
// nova/desconhecida cai num rodízio de cores livres (0..qtd-1), pra não quebrar.
function construirMapaCoresAliada(qtdCores, ...listas) {
  const mapa = {};
  let indiceLivre = 0;
  listas.flat().forEach(item => {
    if (item.aliada in mapa) return;
    const fixa = ALIADA_COR_FIXA[String(item.aliada).toUpperCase()];
    mapa[item.aliada] = fixa !== undefined ? fixa : (indiceLivre++ % qtdCores);
  });
  return mapa;
}

module.exports = {
  calcularPrevisto,
  calcularTotalPrevisto,
  calcularSugestao,
  calcularDistribuicaoPorSugestao,
  calcularTotais,
  calcularSecaoPorAliadaRegiao,
  construirMapaCoresAliada,
};
