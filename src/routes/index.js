const express = require('express');
const { getResumoBuckets, getArmariosNaoMapeados } = require('../services/bucketService');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const [{ linhas, totalGeral }, naoMapeados] = await Promise.all([
      getResumoBuckets(),
      getArmariosNaoMapeados(),
    ]);

    res.render('index', {
      linhas,
      totalGeral,
      naoMapeados,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
