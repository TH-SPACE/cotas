const express = require('express');
const multer = require('multer');
const {
  getResumoBuckets,
  getTemposReparo,
  atualizarTemposReparo,
  getTecnologiasDisponiveis,
  TECNOLOGIA_PADRAO,
  getFiltrosDisponiveisReparo,
  STATUS_EXCLUIDOS_PADRAO: STATUS_EXCLUIDOS_PADRAO_REPARO,
  STATUS_REASON_EXCLUIDOS_PADRAO: STATUS_REASON_EXCLUIDOS_PADRAO_REPARO,
} = require('../services/bucketService');
const {
  getResumoBucketsInstalacoes,
  getTemposInstalacao,
  atualizarTemposInstalacao,
  getFiltrosDisponiveisInstalacoes,
  getPuProdutos,
  atualizarPuProdutos,
  STATUS_EXCLUIDOS_PADRAO: STATUS_EXCLUIDOS_PADRAO_INSTALACAO,
  STATUS_REASON_EXCLUIDOS_PADRAO: STATUS_REASON_EXCLUIDOS_PADRAO_INSTALACAO,
  TECNOLOGIA_ACESSO_PADRAO,
} = require('../services/instalacaoBucketService');
const { importarInstalacoes } = require('../services/instalacoesService');
const {
  calcularLinhasComPrevisto,
  calcularTotais,
  construirMapaCoresAliada,
} = require('../services/calculoBacklogService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const PERCENTUAL_PADRAO = 70;
const PERCENTUAL_JANELA_PADRAO = 70;
const PU_REPARO_PADRAO = 0.80;
const META_PU_TECNICO_PADRAO = 2.9;

const PERCENTUAL_INSTALACAO_PADRAO = 70;
const PERCENTUAL_JANELA_INSTALACAO_PADRAO = 70;
const META_PU_TECNICO_INSTALACAO_PADRAO = 2.9;

const ALIADA_COR_QTD = 4;

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

function normalizarTecnologias(valor) {
  const lista = [].concat(valor || []).filter(Boolean);
  return lista.length > 0 ? lista : TECNOLOGIA_PADRAO;
}

// Diferente de normalizarTecnologias: aqui `valor` pode legitimamente conter uma
// string vazia (ex.: STATUS_REASON em branco), então não dá pra usar filter(Boolean).
// Só cai no padrão se o campo nem veio na query (usuário nunca marcou nada ainda).
function normalizarListaComPadrao(valor, padrao) {
  if (valor === undefined) return padrao;
  const lista = [].concat(valor);
  return lista.length > 0 ? lista : padrao;
}

// Reconstrói a query string de estado (filtros + configs dos dois painéis) para os
// redirects de POST /config/*, que não mexem no valor enviado, só no que originou o post.
function montarQueryStringEstado(body) {
  const params = new URLSearchParams();
  if (body.percentual) params.set('percentual', body.percentual);
  if (body.percentualJanela) params.set('percentualJanela', body.percentualJanela);
  if (body.puReparo) params.set('puReparo', body.puReparo);
  if (body.metaPuTecnico) params.set('metaPuTecnico', body.metaPuTecnico);
  if (body.percentualInstalacao) params.set('percentualInstalacao', body.percentualInstalacao);
  if (body.percentualJanelaInstalacao) params.set('percentualJanelaInstalacao', body.percentualJanelaInstalacao);
  if (body.metaPuTecnicoInstalacao) params.set('metaPuTecnicoInstalacao', body.metaPuTecnicoInstalacao);
  normalizarTecnologias(body.tecnologia).forEach(t => params.append('tecnologia', t));
  [].concat(body.statusReparo || []).forEach(v => params.append('statusReparo', v));
  [].concat(body.statusReasonReparo || []).forEach(v => params.append('statusReasonReparo', v));
  [].concat(body.statusInstalacao || []).forEach(v => params.append('statusInstalacao', v));
  [].concat(body.statusReasonInstalacao || []).forEach(v => params.append('statusReasonInstalacao', v));
  [].concat(body.tecnologiaAcesso || []).forEach(v => params.append('tecnologiaAcesso', v));
  return params;
}

router.get('/', async (req, res, next) => {
  try {
    const percentual = normalizarPercentual(req.query.percentual, PERCENTUAL_PADRAO);
    const percentualJanela = normalizarPercentual(req.query.percentualJanela, PERCENTUAL_JANELA_PADRAO);
    const puReparo = normalizarPu(req.query.puReparo, PU_REPARO_PADRAO);
    const metaPuTecnico = normalizarMetaPuTecnico(req.query.metaPuTecnico, META_PU_TECNICO_PADRAO);
    const tecnologiasSelecionadas = normalizarTecnologias(req.query.tecnologia);

    // Mesmo raciocínio do bloco de Instalações: os valores disponíveis (e o padrão
    // pré-marcado) dependem do que existe hoje em backlog_elos.
    const filtrosDisponiveisReparo = await getFiltrosDisponiveisReparo();
    const statusReparoSelecionados = normalizarListaComPadrao(
      req.query.statusReparo,
      filtrosDisponiveisReparo.status.filter(v => !STATUS_EXCLUIDOS_PADRAO_REPARO.includes(v))
    );
    const statusReasonReparoSelecionados = normalizarListaComPadrao(
      req.query.statusReasonReparo,
      filtrosDisponiveisReparo.statusReason.filter(v => !STATUS_REASON_EXCLUIDOS_PADRAO_REPARO.includes(v))
    );

    const percentualInstalacao = normalizarPercentual(req.query.percentualInstalacao, PERCENTUAL_INSTALACAO_PADRAO);
    const percentualJanelaInstalacao = normalizarPercentual(req.query.percentualJanelaInstalacao, PERCENTUAL_JANELA_INSTALACAO_PADRAO);
    const metaPuTecnicoInstalacao = normalizarMetaPuTecnico(req.query.metaPuTecnicoInstalacao, META_PU_TECNICO_INSTALACAO_PADRAO);

    // Os valores disponíveis (e, por tabela, o padrão pré-marcado) dependem do que
    // existe hoje em backlog_instalacoes, então precisam vir antes de montar a seleção.
    const filtrosDisponiveisInstalacoes = await getFiltrosDisponiveisInstalacoes();
    const statusInstalacaoSelecionados = normalizarListaComPadrao(
      req.query.statusInstalacao,
      filtrosDisponiveisInstalacoes.status.filter(v => !STATUS_EXCLUIDOS_PADRAO_INSTALACAO.includes(v))
    );
    const statusReasonInstalacaoSelecionados = normalizarListaComPadrao(
      req.query.statusReasonInstalacao,
      filtrosDisponiveisInstalacoes.statusReason.filter(v => !STATUS_REASON_EXCLUIDOS_PADRAO_INSTALACAO.includes(v))
    );
    const tecnologiaAcessoSelecionadas = normalizarListaComPadrao(req.query.tecnologiaAcesso, TECNOLOGIA_ACESSO_PADRAO);

    const [
      { linhas, totalGeral },
      temposReparo,
      tecnologiasDisponiveis,
      { linhas: linhasInstalacoes, totalGeral: totalGeralInstalacoes },
      temposInstalacao,
      puProdutos,
    ] = await Promise.all([
      getResumoBuckets(tecnologiasSelecionadas, {
        status: statusReparoSelecionados,
        statusReason: statusReasonReparoSelecionados,
      }),
      getTemposReparo(),
      getTecnologiasDisponiveis(),
      getResumoBucketsInstalacoes({
        status: statusInstalacaoSelecionados,
        statusReason: statusReasonInstalacaoSelecionados,
        tecnologiaAcesso: tecnologiaAcessoSelecionadas,
      }),
      getTemposInstalacao(),
      getPuProdutos(),
    ]);

    const linhasComPrevisto = calcularLinhasComPrevisto(linhas, {
      percentual, percentualJanela, pu: puReparo, metaPuTecnico,
      campoBacklog: 'backlogReparos', campoTempo: 'tempoReparoMinutos',
    });
    const totais = calcularTotais(totalGeral, linhasComPrevisto, {
      percentual, percentualJanela, metaPuTecnico,
    });

    const linhasInstalacoesComPrevisto = calcularLinhasComPrevisto(linhasInstalacoes, {
      percentual: percentualInstalacao, percentualJanela: percentualJanelaInstalacao,
      metaPuTecnico: metaPuTecnicoInstalacao,
      campoBacklog: 'backlogInstalacoes', campoTempo: 'tempoInstalacaoMinutos',
      campoPuBruto: 'puBrutoTotal',
    });
    const totaisInstalacoes = calcularTotais(totalGeralInstalacoes, linhasInstalacoesComPrevisto, {
      percentual: percentualInstalacao, percentualJanela: percentualJanelaInstalacao,
      metaPuTecnico: metaPuTecnicoInstalacao,
    });

    const produtosSemPu = [].concat(req.query.instalacoesUploadProdutosSemPu || []);

    res.render('index', {
      // Reparos
      linhas: linhasComPrevisto,
      totalGeral,
      ...totais,
      percentual,
      percentualJanela,
      puReparo,
      metaPuTecnico,
      temposReparo,
      aliadaCores: construirMapaCoresAliada(ALIADA_COR_QTD, linhasComPrevisto, temposReparo),
      tecnologiasSelecionadas,
      tecnologiasDisponiveis,
      filtrosDisponiveisReparo,
      statusReparoSelecionados,
      statusReasonReparoSelecionados,

      // Instalações
      linhasInstalacoes: linhasInstalacoesComPrevisto,
      totalGeralInstalacoes,
      totalPrevistoInstalacoes: totaisInstalacoes.totalPrevisto,
      totalJanela0830_1230Instalacoes: totaisInstalacoes.totalJanela0830_1230,
      totalJanela1230_1800Instalacoes: totaisInstalacoes.totalJanela1230_1800,
      totalMinutos0830_1230Instalacoes: totaisInstalacoes.totalMinutos0830_1230,
      totalMinutos1230_1800Instalacoes: totaisInstalacoes.totalMinutos1230_1800,
      totalPuInstalacoes: totaisInstalacoes.totalPu,
      totalTecnicosInstalacoes: totaisInstalacoes.totalTecnicos,
      percentualInstalacao,
      percentualJanelaInstalacao,
      metaPuTecnicoInstalacao,
      temposInstalacao,
      puProdutos,
      aliadaCoresInstalacoes: construirMapaCoresAliada(ALIADA_COR_QTD, linhasInstalacoesComPrevisto, temposInstalacao),
      filtrosDisponiveisInstalacoes,
      statusInstalacaoSelecionados,
      statusReasonInstalacaoSelecionados,
      tecnologiaAcessoSelecionadas,

      instalacoesUpload: req.query.instalacoesUpload,
      instalacoesUploadLinhas: req.query.instalacoesUploadLinhas,
      instalacoesUploadErro: req.query.instalacoesUploadErro,
      produtosSemPu,
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

    res.redirect(`/?${montarQueryStringEstado(req.body).toString()}`);
  } catch (err) {
    next(err);
  }
});

router.post('/config/tempo-instalacao', async (req, res, next) => {
  try {
    const buckets = [].concat(req.body.bucket || []);
    const instalacoes = [].concat(req.body.instalacao || []);

    const atualizacoes = buckets
      .map((bucket, i) => ({ bucket, instalacao: Number(instalacoes[i]) }))
      .filter(item => item.bucket && Number.isFinite(item.instalacao) && item.instalacao >= 0);

    await atualizarTemposInstalacao(atualizacoes);

    res.redirect(`/?${montarQueryStringEstado(req.body).toString()}`);
  } catch (err) {
    next(err);
  }
});

router.post('/config/pu-produto', async (req, res, next) => {
  try {
    const produtos = [].concat(req.body.produto || []);
    const pus = [].concat(req.body.pu || []);

    const atualizacoes = produtos
      .map((produto, i) => ({ produto, pu: Number(pus[i]) }))
      .filter(item => item.produto && Number.isFinite(item.pu) && item.pu >= 0);

    await atualizarPuProdutos(atualizacoes);

    res.redirect(`/?${montarQueryStringEstado(req.body).toString()}`);
  } catch (err) {
    next(err);
  }
});

router.post('/instalacoes/upload', upload.single('arquivo'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.redirect('/?instalacoesUpload=erro&instalacoesUploadErro=' + encodeURIComponent('Nenhum arquivo selecionado.'));
    }

    const { totalLinhas, produtosSemPu } = await importarInstalacoes(req.file.buffer, req.file.originalname);

    const params = new URLSearchParams();
    params.set('instalacoesUpload', 'ok');
    params.set('instalacoesUploadLinhas', totalLinhas);
    produtosSemPu.forEach(p => params.append('instalacoesUploadProdutosSemPu', p));

    res.redirect(`/?${params.toString()}`);
  } catch (err) {
    res.redirect('/?instalacoesUpload=erro&instalacoesUploadErro=' + encodeURIComponent(err.message));
  }
});

module.exports = router;
