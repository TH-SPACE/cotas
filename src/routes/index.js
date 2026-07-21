const express = require('express');
const {
  getResumoBuckets,
  getArmariosNaoMapeados,
  getTemposReparo,
  atualizarTemposReparo,
} = require('../services/bucketService');

const router = express.Router();

const PERCENTUAL_PADRAO = 70;
const PERCENTUAL_JANELA_PADRAO = 70;
const PU_REPARO_PADRAO = 0.80;
const META_PU_TECNICO_PADRAO = 2.9;
const ALIADA_COR_QTD = 4;

// Mapa aliada -> índice de cor (0..ALIADA_COR_QTD-1), na ordem em que cada aliada aparece,
// reaproveitado tanto na tabela de resumo quanto na lista de tempos de reparo do modal.
function construirMapaCoresAliada(...listas) {
  const mapa = {};
  let indice = 0;
  listas.flat().forEach(item => {
    if (!(item.aliada in mapa)) {
      mapa[item.aliada] = indice % ALIADA_COR_QTD;
      indice += 1;
    }
  });
  return mapa;
}

function normalizarPercentual(valor, padrao) {
  const num = Number(valor);
  if (!Number.isFinite(num)) return padrao;
  return Math.min(100, Math.max(0, num));
}

function normalizarPu(valor, padrao) {
  const num = Number(valor);
  if (!Number.isFinite(num) || num < 0) return padrao;
  return num;
}

function normalizarMetaPuTecnico(valor, padrao) {
  const num = Number(valor);
  if (!Number.isFinite(num) || num <= 0) return padrao;
  return num;
}

router.get('/', async (req, res, next) => {
  try {
    const percentual = normalizarPercentual(req.query.percentual, PERCENTUAL_PADRAO);
    const percentualJanela = normalizarPercentual(req.query.percentualJanela, PERCENTUAL_JANELA_PADRAO);
    const puReparo = normalizarPu(req.query.puReparo, PU_REPARO_PADRAO);
    const metaPuTecnico = normalizarMetaPuTecnico(req.query.metaPuTecnico, META_PU_TECNICO_PADRAO);

    const [{ linhas, totalGeral }, naoMapeados, temposReparo] = await Promise.all([
      getResumoBuckets(),
      getArmariosNaoMapeados(),
      getTemposReparo(),
    ]);

    const linhasComPrevisto = linhas.map(linha => {
      const previstoResolucao = Math.round(linha.backlogReparos * percentual / 100);
      const janela0830_1230 = Math.round(previstoResolucao * percentualJanela / 100);
      const janela1230_1800 = previstoResolucao - janela0830_1230;
      const pu = Math.round(previstoResolucao * puReparo * 100) / 100;
      return {
        ...linha,
        previstoResolucao,
        janela0830_1230,
        janela1230_1800,
        minutos0830_1230: janela0830_1230 * linha.tempoReparoMinutos,
        minutos1230_1800: janela1230_1800 * linha.tempoReparoMinutos,
        pu,
        tecnicos: Math.ceil(pu / metaPuTecnico),
      };
    });

    const totalPrevisto = Math.round(totalGeral * percentual / 100);
    const totalJanela0830_1230 = Math.round(totalPrevisto * percentualJanela / 100);
    const totalPu = Math.round(totalPrevisto * puReparo * 100) / 100;

    res.render('index', {
      linhas: linhasComPrevisto,
      totalGeral,
      totalPrevisto,
      totalJanela0830_1230,
      totalJanela1230_1800: totalPrevisto - totalJanela0830_1230,
      totalMinutos0830_1230: linhasComPrevisto.reduce((acc, l) => acc + l.minutos0830_1230, 0),
      totalMinutos1230_1800: linhasComPrevisto.reduce((acc, l) => acc + l.minutos1230_1800, 0),
      totalPu,
      totalTecnicos: Math.ceil(totalPu / metaPuTecnico),
      naoMapeados,
      percentual,
      percentualJanela,
      puReparo,
      metaPuTecnico,
      temposReparo,
      aliadaCores: construirMapaCoresAliada(linhasComPrevisto, temposReparo),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/config/tempo-reparo', async (req, res, next) => {
  try {
    const buckets = [].concat(req.body.bucket || []);
    const reparos = [].concat(req.body.reparo || []);

    const atualizacoes = buckets
      .map((bucket, i) => ({ bucket, reparo: Number(reparos[i]) }))
      .filter(item => item.bucket && Number.isFinite(item.reparo) && item.reparo >= 0);

    await atualizarTemposReparo(atualizacoes);

    const params = new URLSearchParams();
    if (req.body.percentual) params.set('percentual', req.body.percentual);
    if (req.body.percentualJanela) params.set('percentualJanela', req.body.percentualJanela);
    if (req.body.puReparo) params.set('puReparo', req.body.puReparo);
    if (req.body.metaPuTecnico) params.set('metaPuTecnico', req.body.metaPuTecnico);

    res.redirect(`/?${params.toString()}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
