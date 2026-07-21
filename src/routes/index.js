const express = require('express');
const { getResumoBuckets, getArmariosNaoMapeados } = require('../services/bucketService');

const router = express.Router();

const PERCENTUAL_PADRAO = 70;
const PERCENTUAL_JANELA_PADRAO = 70;

function normalizarPercentual(valor, padrao) {
  const num = Number(valor);
  if (!Number.isFinite(num)) return padrao;
  return Math.min(100, Math.max(0, num));
}

router.get('/', async (req, res, next) => {
  try {
    const percentual = normalizarPercentual(req.query.percentual, PERCENTUAL_PADRAO);
    const percentualJanela = normalizarPercentual(req.query.percentualJanela, PERCENTUAL_JANELA_PADRAO);

    const [{ linhas, totalGeral }, naoMapeados] = await Promise.all([
      getResumoBuckets(),
      getArmariosNaoMapeados(),
    ]);

    const linhasComPrevisto = linhas.map(linha => {
      const previstoResolucao = Math.round(linha.backlogReparos * percentual / 100);
      const janela0830_1230 = Math.round(previstoResolucao * percentualJanela / 100);
      return {
        ...linha,
        previstoResolucao,
        janela0830_1230,
        janela1230_1800: previstoResolucao - janela0830_1230,
      };
    });

    const totalPrevisto = Math.round(totalGeral * percentual / 100);
    const totalJanela0830_1230 = Math.round(totalPrevisto * percentualJanela / 100);

    res.render('index', {
      linhas: linhasComPrevisto,
      totalGeral,
      totalPrevisto,
      totalJanela0830_1230,
      totalJanela1230_1800: totalPrevisto - totalJanela0830_1230,
      naoMapeados,
      percentual,
      percentualJanela,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
