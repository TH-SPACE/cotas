// Matemática compartilhada entre os painéis de Reparos e Instalações: ambos
// partem de "quantidade em aberto por bucket" + "tempo médio por bucket" e chegam
// em previsto/janelas/PU/técnicos do mesmo jeito, só mudando os nomes dos campos
// de origem (backlogReparos/tempoReparoMinutos vs backlogInstalacoes/tempoInstalacaoMinutos).

const TOP_N_VOLUME_PADRAO = 3;

// PU pode vir de duas formas: um peso único pra tudo (`pu`, usado pelos Reparos) ou
// um total bruto já ponderado por linha (`campoPuBruto`, usado pelas Instalações —
// cada SPECIFICATION_PRODUCT tem seu próprio peso em depara_pu_produto, então o SQL
// já soma o peso ticket-a-ticket e aqui só aplicamos o percentual de "previsto").
function calcularLinhasComPrevisto(linhas, config) {
  const {
    percentual, percentualJanela, pu, metaPuTecnico,
    campoBacklog, campoTempo, campoPuBruto, topNVolume = TOP_N_VOLUME_PADRAO,
  } = config;

  const rankBacklog = new Map(
    [...linhas]
      .sort((a, b) => b[campoBacklog] - a[campoBacklog])
      .map((linha, indice) => [linha.bucket, indice])
  );

  return linhas.map(linha => {
    const previstoResolucao = Math.round(linha[campoBacklog] * percentual / 100);
    const janela0830_1230 = Math.round(previstoResolucao * percentualJanela / 100);
    const janela1230_1800 = previstoResolucao - janela0830_1230;
    const puCalculado = campoPuBruto !== undefined
      ? Math.round(linha[campoPuBruto] * percentual / 100 * 100) / 100
      : Math.round(previstoResolucao * pu * 100) / 100;
    const rank = rankBacklog.get(linha.bucket);

    return {
      ...linha,
      previstoResolucao,
      janela0830_1230,
      janela1230_1800,
      minutos0830_1230: janela0830_1230 * linha[campoTempo],
      minutos1230_1800: janela1230_1800 * linha[campoTempo],
      pu: puCalculado,
      tecnicos: Math.ceil(puCalculado / metaPuTecnico),
      maiorVolume: linha[campoBacklog] > 0 && rank < topNVolume,
    };
  });
}

function calcularTotais(totalGeral, linhasComPrevisto, config) {
  const { percentual, percentualJanela, metaPuTecnico } = config;
  const totalPrevisto = Math.round(totalGeral * percentual / 100);
  const totalJanela0830_1230 = Math.round(totalPrevisto * percentualJanela / 100);
  const totalPu = Math.round(linhasComPrevisto.reduce((acc, l) => acc + l.pu, 0) * 100) / 100;

  return {
    totalPrevisto,
    totalJanela0830_1230,
    totalJanela1230_1800: totalPrevisto - totalJanela0830_1230,
    totalMinutos0830_1230: linhasComPrevisto.reduce((acc, l) => acc + l.minutos0830_1230, 0),
    totalMinutos1230_1800: linhasComPrevisto.reduce((acc, l) => acc + l.minutos1230_1800, 0),
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
