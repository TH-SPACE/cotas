const express = require('express');
const multer = require('multer');
const {
  getResumoBuckets,
  getTemposReparo,
  atualizarTemposReparo,
  getTecnologiasDisponiveis,
  TECNOLOGIA_PADRAO,
  getFiltrosDisponiveisReparo,
  getDataCargaReparo,
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
const {
  getResumoBucketsServicos,
  getTemposServicos,
  atualizarTemposServicos,
  getFiltrosDisponiveisServicos,
  getPuProdutosServicos,
  atualizarPuProdutosServicos,
  STATUS_EXCLUIDOS_PADRAO: STATUS_EXCLUIDOS_PADRAO_SERVICO,
  STATUS_REASON_EXCLUIDOS_PADRAO: STATUS_REASON_EXCLUIDOS_PADRAO_SERVICO,
  TECNOLOGIA_ACESSO_PADRAO: TECNOLOGIA_ACESSO_PADRAO_SERVICO,
} = require('../services/servicoBucketService');
const {
  getResumoBucketsMe,
  getTemposMe,
  atualizarTemposMe,
  getFiltrosDisponiveisMe,
  getPuProdutosMe,
  atualizarPuProdutosMe,
  STATUS_EXCLUIDOS_PADRAO: STATUS_EXCLUIDOS_PADRAO_ME,
  STATUS_REASON_EXCLUIDOS_PADRAO: STATUS_REASON_EXCLUIDOS_PADRAO_ME,
  TECNOLOGIA_ACESSO_PADRAO: TECNOLOGIA_ACESSO_PADRAO_ME,
} = require('../services/meBucketService');
const { importarInstalacoes, getDataCargaInstalacoes } = require('../services/instalacoesService');
const {
  calcularLinhasComPrevisto,
  calcularTotais,
  construirMapaCoresAliada,
} = require('../services/calculoBacklogService');
const { getElosCredenciais, salvarElosCredenciais } = require('../services/elosCredenciaisService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const PERCENTUAL_PADRAO = 70;
const PERCENTUAL_JANELA_PADRAO = 70;
const PU_REPARO_PADRAO = 0.80;
const META_PU_TECNICO_PADRAO = 2.9;
// Reparos tem 2 janelas: a 1ª é configurável (percentualJanela), a 2ª é o restante.
const JANELAS_REPARO = ['08:30 - 12:30', '12:30 - 18:00'];

const PERCENTUAL_INSTALACAO_PADRAO = 70;
const PERCENTUAL_JANELA1_INSTALACAO_PADRAO = 25;
const PERCENTUAL_JANELA2_INSTALACAO_PADRAO = 25;
const PERCENTUAL_JANELA3_INSTALACAO_PADRAO = 25;
const META_PU_TECNICO_INSTALACAO_PADRAO = 2.9;
// Instalações, Serviços e ME têm 4 janelas: as 3 primeiras são configuráveis, a 4ª é o restante.
const JANELAS_INSTALACAO = ['08:30 - 10:30', '10:30 - 12:30', '14:00 - 16:00', '16:00 - 18:00'];

const PERCENTUAL_SERVICO_PADRAO = 70;
const PERCENTUAL_JANELA1_SERVICO_PADRAO = 25;
const PERCENTUAL_JANELA2_SERVICO_PADRAO = 25;
const PERCENTUAL_JANELA3_SERVICO_PADRAO = 25;
const META_PU_TECNICO_SERVICO_PADRAO = 2.9;
const JANELAS_SERVICO = ['08:30 - 10:30', '10:30 - 12:30', '14:00 - 16:00', '16:00 - 18:00'];

const PERCENTUAL_ME_PADRAO = 70;
const PERCENTUAL_JANELA1_ME_PADRAO = 25;
const PERCENTUAL_JANELA2_ME_PADRAO = 25;
const PERCENTUAL_JANELA3_ME_PADRAO = 25;
const META_PU_TECNICO_ME_PADRAO = 2.9;
const JANELAS_ME = ['08:30 - 10:30', '10:30 - 12:30', '14:00 - 16:00', '16:00 - 18:00'];

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

// Formata 'YYYY-MM-DD HH:mm:ss' (retornado pelo MySQL, dateStrings:true) pro
// padrão brasileiro usado no resto da tela. null (base ainda vazia) vira aviso.
function formatarDataCarga(valor) {
  if (!valor) return 'sem carga registrada';
  const [data, hora] = valor.split(' ');
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano} ${hora.slice(0, 5)}`;
}

// Diferente de normalizarTecnologias: aqui `valor` pode legitimamente conter uma
// string vazia (ex.: STATUS_REASON em branco), então não dá pra usar filter(Boolean).
// Só cai no padrão se o campo nem veio na query (usuário nunca marcou nada ainda).
function normalizarListaComPadrao(valor, padrao) {
  if (valor === undefined) return padrao;
  const lista = [].concat(valor);
  return lista.length > 0 ? lista : padrao;
}

// Reconstrói a query string de estado (filtros + configs dos quatro painéis) para os
// redirects de POST /config/*, que não mexem no valor enviado, só no que originou o post.
function montarQueryStringEstado(body) {
  const params = new URLSearchParams();
  if (body.percentual) params.set('percentual', body.percentual);
  if (body.percentualJanela) params.set('percentualJanela', body.percentualJanela);
  if (body.puReparo) params.set('puReparo', body.puReparo);
  if (body.metaPuTecnico) params.set('metaPuTecnico', body.metaPuTecnico);
  if (body.percentualInstalacao) params.set('percentualInstalacao', body.percentualInstalacao);
  if (body.percentualJanela1Instalacao) params.set('percentualJanela1Instalacao', body.percentualJanela1Instalacao);
  if (body.percentualJanela2Instalacao) params.set('percentualJanela2Instalacao', body.percentualJanela2Instalacao);
  if (body.percentualJanela3Instalacao) params.set('percentualJanela3Instalacao', body.percentualJanela3Instalacao);
  if (body.metaPuTecnicoInstalacao) params.set('metaPuTecnicoInstalacao', body.metaPuTecnicoInstalacao);
  if (body.percentualServico) params.set('percentualServico', body.percentualServico);
  if (body.percentualJanela1Servico) params.set('percentualJanela1Servico', body.percentualJanela1Servico);
  if (body.percentualJanela2Servico) params.set('percentualJanela2Servico', body.percentualJanela2Servico);
  if (body.percentualJanela3Servico) params.set('percentualJanela3Servico', body.percentualJanela3Servico);
  if (body.metaPuTecnicoServico) params.set('metaPuTecnicoServico', body.metaPuTecnicoServico);
  if (body.percentualMe) params.set('percentualMe', body.percentualMe);
  if (body.percentualJanela1Me) params.set('percentualJanela1Me', body.percentualJanela1Me);
  if (body.percentualJanela2Me) params.set('percentualJanela2Me', body.percentualJanela2Me);
  if (body.percentualJanela3Me) params.set('percentualJanela3Me', body.percentualJanela3Me);
  if (body.metaPuTecnicoMe) params.set('metaPuTecnicoMe', body.metaPuTecnicoMe);
  normalizarTecnologias(body.tecnologia).forEach(t => params.append('tecnologia', t));
  [].concat(body.statusReparo || []).forEach(v => params.append('statusReparo', v));
  [].concat(body.statusReasonReparo || []).forEach(v => params.append('statusReasonReparo', v));
  [].concat(body.statusInstalacao || []).forEach(v => params.append('statusInstalacao', v));
  [].concat(body.statusReasonInstalacao || []).forEach(v => params.append('statusReasonInstalacao', v));
  [].concat(body.tecnologiaAcesso || []).forEach(v => params.append('tecnologiaAcesso', v));
  [].concat(body.statusServico || []).forEach(v => params.append('statusServico', v));
  [].concat(body.statusReasonServico || []).forEach(v => params.append('statusReasonServico', v));
  [].concat(body.tecnologiaAcessoServico || []).forEach(v => params.append('tecnologiaAcessoServico', v));
  [].concat(body.statusMe || []).forEach(v => params.append('statusMe', v));
  [].concat(body.statusReasonMe || []).forEach(v => params.append('statusReasonMe', v));
  [].concat(body.tecnologiaAcessoMe || []).forEach(v => params.append('tecnologiaAcessoMe', v));
  return params;
}

// Carrega e calcula os 4 painéis (Reparos/Instalações/Serviços/ME) a partir de um
// objeto de query string — usado tanto pela página principal quanto pela página de
// resumo consolidado (/resumo-cotas), pra nunca fazer as duas divergirem.
async function carregarDadosPainel(query) {
  const percentual = normalizarPercentual(query.percentual, PERCENTUAL_PADRAO);
    const percentualJanela = normalizarPercentual(query.percentualJanela, PERCENTUAL_JANELA_PADRAO);
    const puReparo = normalizarPu(query.puReparo, PU_REPARO_PADRAO);
    const metaPuTecnico = normalizarMetaPuTecnico(query.metaPuTecnico, META_PU_TECNICO_PADRAO);
    const tecnologiasSelecionadas = normalizarTecnologias(query.tecnologia);

    // Mesmo raciocínio do bloco de Instalações: os valores disponíveis (e o padrão
    // pré-marcado) dependem do que existe hoje em backlog_elos.
    const filtrosDisponiveisReparo = await getFiltrosDisponiveisReparo();
    const statusReparoSelecionados = normalizarListaComPadrao(
      query.statusReparo,
      filtrosDisponiveisReparo.status.filter(v => !STATUS_EXCLUIDOS_PADRAO_REPARO.includes(v))
    );
    const statusReasonReparoSelecionados = normalizarListaComPadrao(
      query.statusReasonReparo,
      filtrosDisponiveisReparo.statusReason.filter(v => !STATUS_REASON_EXCLUIDOS_PADRAO_REPARO.includes(v))
    );

    const percentualInstalacao = normalizarPercentual(query.percentualInstalacao, PERCENTUAL_INSTALACAO_PADRAO);
    const percentualJanela1Instalacao = normalizarPercentual(query.percentualJanela1Instalacao, PERCENTUAL_JANELA1_INSTALACAO_PADRAO);
    const percentualJanela2Instalacao = normalizarPercentual(query.percentualJanela2Instalacao, PERCENTUAL_JANELA2_INSTALACAO_PADRAO);
    const percentualJanela3Instalacao = normalizarPercentual(query.percentualJanela3Instalacao, PERCENTUAL_JANELA3_INSTALACAO_PADRAO);
    const metaPuTecnicoInstalacao = normalizarMetaPuTecnico(query.metaPuTecnicoInstalacao, META_PU_TECNICO_INSTALACAO_PADRAO);

    // Os valores disponíveis (e, por tabela, o padrão pré-marcado) dependem do que
    // existe hoje em backlog_instalacoes, então precisam vir antes de montar a seleção.
    const filtrosDisponiveisInstalacoes = await getFiltrosDisponiveisInstalacoes();
    const statusInstalacaoSelecionados = normalizarListaComPadrao(
      query.statusInstalacao,
      filtrosDisponiveisInstalacoes.status.filter(v => !STATUS_EXCLUIDOS_PADRAO_INSTALACAO.includes(v))
    );
    const statusReasonInstalacaoSelecionados = normalizarListaComPadrao(
      query.statusReasonInstalacao,
      filtrosDisponiveisInstalacoes.statusReason.filter(v => !STATUS_REASON_EXCLUIDOS_PADRAO_INSTALACAO.includes(v))
    );
    const tecnologiaAcessoSelecionadas = normalizarListaComPadrao(query.tecnologiaAcesso, TECNOLOGIA_ACESSO_PADRAO);

    const percentualServico = normalizarPercentual(query.percentualServico, PERCENTUAL_SERVICO_PADRAO);
    const percentualJanela1Servico = normalizarPercentual(query.percentualJanela1Servico, PERCENTUAL_JANELA1_SERVICO_PADRAO);
    const percentualJanela2Servico = normalizarPercentual(query.percentualJanela2Servico, PERCENTUAL_JANELA2_SERVICO_PADRAO);
    const percentualJanela3Servico = normalizarPercentual(query.percentualJanela3Servico, PERCENTUAL_JANELA3_SERVICO_PADRAO);
    const metaPuTecnicoServico = normalizarMetaPuTecnico(query.metaPuTecnicoServico, META_PU_TECNICO_SERVICO_PADRAO);

    const filtrosDisponiveisServicos = await getFiltrosDisponiveisServicos();
    const statusServicoSelecionados = normalizarListaComPadrao(
      query.statusServico,
      filtrosDisponiveisServicos.status.filter(v => !STATUS_EXCLUIDOS_PADRAO_SERVICO.includes(v))
    );
    const statusReasonServicoSelecionados = normalizarListaComPadrao(
      query.statusReasonServico,
      filtrosDisponiveisServicos.statusReason.filter(v => !STATUS_REASON_EXCLUIDOS_PADRAO_SERVICO.includes(v))
    );
    const tecnologiaAcessoServicoSelecionadas = normalizarListaComPadrao(query.tecnologiaAcessoServico, TECNOLOGIA_ACESSO_PADRAO_SERVICO);

    const percentualMe = normalizarPercentual(query.percentualMe, PERCENTUAL_ME_PADRAO);
    const percentualJanela1Me = normalizarPercentual(query.percentualJanela1Me, PERCENTUAL_JANELA1_ME_PADRAO);
    const percentualJanela2Me = normalizarPercentual(query.percentualJanela2Me, PERCENTUAL_JANELA2_ME_PADRAO);
    const percentualJanela3Me = normalizarPercentual(query.percentualJanela3Me, PERCENTUAL_JANELA3_ME_PADRAO);
    const metaPuTecnicoMe = normalizarMetaPuTecnico(query.metaPuTecnicoMe, META_PU_TECNICO_ME_PADRAO);

    const filtrosDisponiveisMe = await getFiltrosDisponiveisMe();
    const statusMeSelecionados = normalizarListaComPadrao(
      query.statusMe,
      filtrosDisponiveisMe.status.filter(v => !STATUS_EXCLUIDOS_PADRAO_ME.includes(v))
    );
    const statusReasonMeSelecionados = normalizarListaComPadrao(
      query.statusReasonMe,
      filtrosDisponiveisMe.statusReason.filter(v => !STATUS_REASON_EXCLUIDOS_PADRAO_ME.includes(v))
    );
    const tecnologiaAcessoMeSelecionadas = normalizarListaComPadrao(query.tecnologiaAcessoMe, TECNOLOGIA_ACESSO_PADRAO_ME);

    const [
      { linhas, totalGeral },
      temposReparo,
      tecnologiasDisponiveis,
      dataCargaReparo,
      { linhas: linhasInstalacoes, totalGeral: totalGeralInstalacoes },
      temposInstalacao,
      puProdutos,
      dataCargaInstalacoes,
      { linhas: linhasServicos, totalGeral: totalGeralServicos },
      temposServicos,
      puProdutosServicos,
      { linhas: linhasMe, totalGeral: totalGeralMe },
      temposMe,
      puProdutosMe,
      elosCredenciais,
    ] = await Promise.all([
      getResumoBuckets(tecnologiasSelecionadas, {
        status: statusReparoSelecionados,
        statusReason: statusReasonReparoSelecionados,
      }),
      getTemposReparo(),
      getTecnologiasDisponiveis(),
      getDataCargaReparo(),
      getResumoBucketsInstalacoes({
        status: statusInstalacaoSelecionados,
        statusReason: statusReasonInstalacaoSelecionados,
        tecnologiaAcesso: tecnologiaAcessoSelecionadas,
      }),
      getTemposInstalacao(),
      getPuProdutos(),
      getDataCargaInstalacoes(),
      getResumoBucketsServicos({
        status: statusServicoSelecionados,
        statusReason: statusReasonServicoSelecionados,
        tecnologiaAcesso: tecnologiaAcessoServicoSelecionadas,
      }),
      getTemposServicos(),
      getPuProdutosServicos(),
      getResumoBucketsMe({
        status: statusMeSelecionados,
        statusReason: statusReasonMeSelecionados,
        tecnologiaAcesso: tecnologiaAcessoMeSelecionadas,
      }),
      getTemposMe(),
      getPuProdutosMe(),
      getElosCredenciais(),
    ]);

    const linhasComPrevisto = calcularLinhasComPrevisto(linhas, {
      percentual, percentuaisJanela: [percentualJanela], pu: puReparo, metaPuTecnico,
      campoBacklog: 'backlogReparos', campoTempo: 'tempoReparoMinutos',
    });
    const totais = calcularTotais(totalGeral, linhasComPrevisto, {
      percentual, percentuaisJanela: [percentualJanela], metaPuTecnico,
    });

    const percentuaisJanelaInstalacao = [percentualJanela1Instalacao, percentualJanela2Instalacao, percentualJanela3Instalacao];
    const linhasInstalacoesComPrevisto = calcularLinhasComPrevisto(linhasInstalacoes, {
      percentual: percentualInstalacao, percentuaisJanela: percentuaisJanelaInstalacao,
      metaPuTecnico: metaPuTecnicoInstalacao,
      campoBacklog: 'backlogInstalacoes', campoTempo: 'tempoInstalacaoMinutos',
      campoPuBruto: 'puBrutoTotal',
    });
    const totaisInstalacoes = calcularTotais(totalGeralInstalacoes, linhasInstalacoesComPrevisto, {
      percentual: percentualInstalacao, percentuaisJanela: percentuaisJanelaInstalacao,
      metaPuTecnico: metaPuTecnicoInstalacao,
    });

    const percentuaisJanelaServico = [percentualJanela1Servico, percentualJanela2Servico, percentualJanela3Servico];
    const linhasServicosComPrevisto = calcularLinhasComPrevisto(linhasServicos, {
      percentual: percentualServico, percentuaisJanela: percentuaisJanelaServico,
      metaPuTecnico: metaPuTecnicoServico,
      campoBacklog: 'backlogServicos', campoTempo: 'tempoServicoMinutos',
      campoPuBruto: 'puBrutoTotal',
    });
    const totaisServicos = calcularTotais(totalGeralServicos, linhasServicosComPrevisto, {
      percentual: percentualServico, percentuaisJanela: percentuaisJanelaServico,
      metaPuTecnico: metaPuTecnicoServico,
    });

    const percentuaisJanelaMe = [percentualJanela1Me, percentualJanela2Me, percentualJanela3Me];
    const linhasMeComPrevisto = calcularLinhasComPrevisto(linhasMe, {
      percentual: percentualMe, percentuaisJanela: percentuaisJanelaMe,
      metaPuTecnico: metaPuTecnicoMe,
      campoBacklog: 'backlogMe', campoTempo: 'tempoMeMinutos',
      campoPuBruto: 'puBrutoTotal',
    });
    const totaisMe = calcularTotais(totalGeralMe, linhasMeComPrevisto, {
      percentual: percentualMe, percentuaisJanela: percentuaisJanelaMe,
      metaPuTecnico: metaPuTecnicoMe,
    });

    return {
      // Reparos
      linhas: linhasComPrevisto,
      totalGeral,
      ...totais,
      janelasReparoLabels: JANELAS_REPARO,
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
      dataCargaReparo: formatarDataCarga(dataCargaReparo),

      // Instalações
      linhasInstalacoes: linhasInstalacoesComPrevisto,
      totalGeralInstalacoes,
      totalPrevistoInstalacoes: totaisInstalacoes.totalPrevisto,
      totalJanelasInstalacoes: totaisInstalacoes.totalJanelas,
      totalMinutosInstalacoes: totaisInstalacoes.totalMinutos,
      totalPuInstalacoes: totaisInstalacoes.totalPu,
      totalTecnicosInstalacoes: totaisInstalacoes.totalTecnicos,
      janelasInstalacaoLabels: JANELAS_INSTALACAO,
      percentualInstalacao,
      percentualJanela1Instalacao,
      percentualJanela2Instalacao,
      percentualJanela3Instalacao,
      metaPuTecnicoInstalacao,
      temposInstalacao,
      puProdutos,
      aliadaCoresInstalacoes: construirMapaCoresAliada(ALIADA_COR_QTD, linhasInstalacoesComPrevisto, temposInstalacao),
      filtrosDisponiveisInstalacoes,
      statusInstalacaoSelecionados,
      statusReasonInstalacaoSelecionados,
      tecnologiaAcessoSelecionadas,
      dataCargaInstalacoes: formatarDataCarga(dataCargaInstalacoes),

      // Serviços
      linhasServicos: linhasServicosComPrevisto,
      totalGeralServicos,
      totalPrevistoServicos: totaisServicos.totalPrevisto,
      totalJanelasServicos: totaisServicos.totalJanelas,
      totalMinutosServicos: totaisServicos.totalMinutos,
      totalPuServicos: totaisServicos.totalPu,
      totalTecnicosServicos: totaisServicos.totalTecnicos,
      janelasServicoLabels: JANELAS_SERVICO,
      percentualServico,
      percentualJanela1Servico,
      percentualJanela2Servico,
      percentualJanela3Servico,
      metaPuTecnicoServico,
      temposServicos,
      puProdutosServicos,
      aliadaCoresServicos: construirMapaCoresAliada(ALIADA_COR_QTD, linhasServicosComPrevisto, temposServicos),
      filtrosDisponiveisServicos,
      statusServicoSelecionados,
      statusReasonServicoSelecionados,
      tecnologiaAcessoServicoSelecionadas,
      dataCargaServicos: formatarDataCarga(dataCargaInstalacoes),

      // ME (Mudança de Endereço)
      linhasMe: linhasMeComPrevisto,
      totalGeralMe,
      totalPrevistoMe: totaisMe.totalPrevisto,
      totalJanelasMe: totaisMe.totalJanelas,
      totalMinutosMe: totaisMe.totalMinutos,
      totalPuMe: totaisMe.totalPu,
      totalTecnicosMe: totaisMe.totalTecnicos,
      janelasMeLabels: JANELAS_ME,
      percentualMe,
      percentualJanela1Me,
      percentualJanela2Me,
      percentualJanela3Me,
      metaPuTecnicoMe,
      temposMe,
      puProdutosMe,
      aliadaCoresMe: construirMapaCoresAliada(ALIADA_COR_QTD, linhasMeComPrevisto, temposMe),
      filtrosDisponiveisMe,
      statusMeSelecionados,
      statusReasonMeSelecionados,
      tecnologiaAcessoMeSelecionadas,
      dataCargaMe: formatarDataCarga(dataCargaInstalacoes),

      // Credenciais da raspagem automática do Elos (elos-backlog-scraper) --
      // nunca inclui a senha, só usuário + quando foi a última atualização.
      elosCredenciais: elosCredenciais
        ? { usuario: elosCredenciais.usuario, atualizadoEm: formatarDataCarga(elosCredenciais.atualizado_em) }
        : null,
    };
}

router.get('/', async (req, res, next) => {
  try {
    const dados = await carregarDadosPainel(req.query);
    const linkResumoCotas = `/resumo-cotas?${montarQueryStringEstado(req.query).toString()}`;

    res.render('index', {
      ...dados,
      linkResumoCotas,
      instalacoesUpload: req.query.instalacoesUpload,
      instalacoesUploadLinhas: req.query.instalacoesUploadLinhas,
      instalacoesUploadErro: req.query.instalacoesUploadErro,
    });
  } catch (err) {
    next(err);
  }
});

// Página consolidada: uma linha por bucket, com as COTAS(min) de cada painel
// abertas por janela de horário (não só o total) — reaproveita o mesmo cálculo
// da página principal, nunca recalcula com regras próprias.
router.get('/resumo-cotas', async (req, res, next) => {
  try {
    const dados = await carregarDadosPainel(req.query);
    const linkVoltar = `/?${montarQueryStringEstado(req.query).toString()}`;
    const linkResumoCotas = `/resumo-cotas?${montarQueryStringEstado(req.query).toString()}`;

    const qtdJanelasInstalacao = dados.janelasInstalacaoLabels.length;
    const qtdJanelasMe = dados.janelasMeLabels.length;
    const qtdJanelasServico = dados.janelasServicoLabels.length;
    const qtdJanelasReparo = dados.janelasReparoLabels.length;

    const porBucket = new Map();
    const acumularSecao = (linhas, campo, qtdJanelas) => {
      linhas.forEach(linha => {
        if (!porBucket.has(linha.bucket)) {
          porBucket.set(linha.bucket, {
            aliada: linha.aliada,
            bucket: linha.bucket,
            instalacao: new Array(qtdJanelasInstalacao).fill(0),
            me: new Array(qtdJanelasMe).fill(0),
            servico: new Array(qtdJanelasServico).fill(0),
            reparo: new Array(qtdJanelasReparo).fill(0),
          });
        }
        porBucket.get(linha.bucket)[campo] = linha.minutos;
      });
    };
    acumularSecao(dados.linhasInstalacoes, 'instalacao', qtdJanelasInstalacao);
    acumularSecao(dados.linhasMe, 'me', qtdJanelasMe);
    acumularSecao(dados.linhasServicos, 'servico', qtdJanelasServico);
    acumularSecao(dados.linhas, 'reparo', qtdJanelasReparo);

    const linhasResumo = [...porBucket.values()].sort((a, b) =>
      a.aliada.localeCompare(b.aliada) || a.bucket.localeCompare(b.bucket)
    );

    res.render('resumo-cotas', {
      linkVoltar,
      linkResumoCotas,
      linhasResumo,
      janelasInstalacaoLabels: dados.janelasInstalacaoLabels,
      janelasMeLabels: dados.janelasMeLabels,
      janelasServicoLabels: dados.janelasServicoLabels,
      janelasReparoLabels: dados.janelasReparoLabels,
      totalMinutosInstalacao: dados.totalMinutosInstalacoes,
      totalMinutosMe: dados.totalMinutosMe,
      totalMinutosServico: dados.totalMinutosServicos,
      totalMinutosReparo: dados.totalMinutos,
      aliadaCores: construirMapaCoresAliada(ALIADA_COR_QTD, linhasResumo),
      elosCredenciais: dados.elosCredenciais,
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

router.post('/config/tempo-servico', async (req, res, next) => {
  try {
    const buckets = [].concat(req.body.bucket || []);
    const servicos = [].concat(req.body.servico || []);

    const atualizacoes = buckets
      .map((bucket, i) => ({ bucket, servico: Number(servicos[i]) }))
      .filter(item => item.bucket && Number.isFinite(item.servico) && item.servico >= 0);

    await atualizarTemposServicos(atualizacoes);

    res.redirect(`/?${montarQueryStringEstado(req.body).toString()}`);
  } catch (err) {
    next(err);
  }
});

router.post('/config/pu-produto-servico', async (req, res, next) => {
  try {
    const produtos = [].concat(req.body.produto || []);
    const pus = [].concat(req.body.pu || []);

    const atualizacoes = produtos
      .map((produto, i) => ({ produto, pu: Number(pus[i]) }))
      .filter(item => item.produto && Number.isFinite(item.pu) && item.pu >= 0);

    await atualizarPuProdutosServicos(atualizacoes);

    res.redirect(`/?${montarQueryStringEstado(req.body).toString()}`);
  } catch (err) {
    next(err);
  }
});

router.post('/config/tempo-me', async (req, res, next) => {
  try {
    const buckets = [].concat(req.body.bucket || []);
    const alteracoes = [].concat(req.body.alteracao || []);

    const atualizacoes = buckets
      .map((bucket, i) => ({ bucket, alteracao: Number(alteracoes[i]) }))
      .filter(item => item.bucket && Number.isFinite(item.alteracao) && item.alteracao >= 0);

    await atualizarTemposMe(atualizacoes);

    res.redirect(`/?${montarQueryStringEstado(req.body).toString()}`);
  } catch (err) {
    next(err);
  }
});

router.post('/config/pu-produto-me', async (req, res, next) => {
  try {
    const produtos = [].concat(req.body.produto || []);
    const pus = [].concat(req.body.pu || []);

    const atualizacoes = produtos
      .map((produto, i) => ({ produto, pu: Number(pus[i]) }))
      .filter(item => item.produto && Number.isFinite(item.pu) && item.pu >= 0);

    await atualizarPuProdutosMe(atualizacoes);

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

    const { totalLinhas } = await importarInstalacoes(req.file.buffer, req.file.originalname);

    res.redirect(`/?instalacoesUpload=ok&instalacoesUploadLinhas=${totalLinhas}`);
  } catch (err) {
    res.redirect('/?instalacoesUpload=erro&instalacoesUploadErro=' + encodeURIComponent(err.message));
  }
});

router.post('/config/elos-credenciais', async (req, res, next) => {
  try {
    const usuario = (req.body.elosUsuario || '').trim();
    const senha = req.body.elosSenha || '';

    if (usuario) {
      await salvarElosCredenciais(usuario, senha);
    }

    res.redirect(`/?${montarQueryStringEstado(req.body).toString()}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
