const express = require('express');
const multer = require('multer');
const {
  getResumoBuckets,
  getTecnologiasDisponiveis,
  TECNOLOGIA_PADRAO,
  getFiltrosDisponiveisReparo,
  getDataCargaReparo,
  STATUS_EXCLUIDOS_PADRAO: STATUS_EXCLUIDOS_PADRAO_REPARO,
  STATUS_REASON_EXCLUIDOS_PADRAO: STATUS_REASON_EXCLUIDOS_PADRAO_REPARO,
} = require('../services/bucketService');
const {
  getResumoBucketsInstalacoes,
  getFiltrosDisponiveisInstalacoes,
  getPuProdutos,
  atualizarPuProdutos,
  STATUS_EXCLUIDOS_PADRAO: STATUS_EXCLUIDOS_PADRAO_INSTALACAO,
  STATUS_REASON_EXCLUIDOS_PADRAO: STATUS_REASON_EXCLUIDOS_PADRAO_INSTALACAO,
  TECNOLOGIA_ACESSO_PADRAO,
} = require('../services/instalacaoBucketService');
const {
  getResumoBucketsServicos,
  getFiltrosDisponiveisServicos,
  getPuProdutosServicos,
  atualizarPuProdutosServicos,
  STATUS_EXCLUIDOS_PADRAO: STATUS_EXCLUIDOS_PADRAO_SERVICO,
  STATUS_REASON_EXCLUIDOS_PADRAO: STATUS_REASON_EXCLUIDOS_PADRAO_SERVICO,
  TECNOLOGIA_ACESSO_PADRAO: TECNOLOGIA_ACESSO_PADRAO_SERVICO,
} = require('../services/servicoBucketService');
const {
  getResumoBucketsMe,
  getFiltrosDisponiveisMe,
  getPuProdutosMe,
  atualizarPuProdutosMe,
  STATUS_EXCLUIDOS_PADRAO: STATUS_EXCLUIDOS_PADRAO_ME,
  STATUS_REASON_EXCLUIDOS_PADRAO: STATUS_REASON_EXCLUIDOS_PADRAO_ME,
  TECNOLOGIA_ACESSO_PADRAO: TECNOLOGIA_ACESSO_PADRAO_ME,
} = require('../services/meBucketService');
const { importarInstalacoes, getDataCargaInstalacoes } = require('../services/instalacoesService');
const { importarReparos } = require('../services/reparosUploadService');
const { getTemposBucket, atualizarTemposBucket } = require('../services/temposBucketService');
const {
  calcularPrevisto,
  calcularTotalPrevisto,
  calcularSugestao,
  calcularDistribuicaoPorSugestao,
  calcularTotais,
  construirMapaCoresAliada,
} = require('../services/calculoBacklogService');
const { getConfiguracoesGerais, salvarConfiguracoesGerais } = require('../services/configGeralService');
const { getElosCredenciais, salvarElosCredenciais } = require('../services/elosCredenciaisService');
const { getStatusRaspagem, solicitarExecucaoManual } = require('../services/raspagemStatusService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const PERCENTUAL_PADRAO = 70;
const PERCENTUAL_JANELA_PADRAO = 70;
const PU_REPARO_PADRAO = 0.80;
const META_PU_TECNICO_PADRAO = 2.9;
const CARGA_REPARO_PADRAO = 0;
// Reparos tem 2 janelas: a 1ª é configurável (percentualJanela), a 2ª é o restante.
const JANELAS_REPARO = ['08:30 - 12:30', '12:30 - 18:00'];

const PERCENTUAL_INSTALACAO_PADRAO = 70;
const PERCENTUAL_JANELA1_INSTALACAO_PADRAO = 25;
const PERCENTUAL_JANELA2_INSTALACAO_PADRAO = 25;
const PERCENTUAL_JANELA3_INSTALACAO_PADRAO = 25;
const META_PU_TECNICO_INSTALACAO_PADRAO = 2.9;
const CARGA_INSTALACAO_PADRAO = 0;
// Instalações, Serviços e ME têm 4 janelas: as 3 primeiras são configuráveis, a 4ª é o restante.
const JANELAS_INSTALACAO = ['08:30 - 10:30', '10:30 - 12:30', '14:00 - 16:00', '16:00 - 18:00'];

const PERCENTUAL_SERVICO_PADRAO = 70;
const PERCENTUAL_JANELA1_SERVICO_PADRAO = 25;
const PERCENTUAL_JANELA2_SERVICO_PADRAO = 25;
const PERCENTUAL_JANELA3_SERVICO_PADRAO = 25;
const META_PU_TECNICO_SERVICO_PADRAO = 2.9;
const CARGA_SERVICO_PADRAO = 0;
const JANELAS_SERVICO = ['08:30 - 10:30', '10:30 - 12:30', '14:00 - 16:00', '16:00 - 18:00'];

const PERCENTUAL_ME_PADRAO = 70;
const PERCENTUAL_JANELA1_ME_PADRAO = 25;
const PERCENTUAL_JANELA2_ME_PADRAO = 25;
const PERCENTUAL_JANELA3_ME_PADRAO = 25;
const META_PU_TECNICO_ME_PADRAO = 2.9;
const CARGA_ME_PADRAO = 0;
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

// Reconstrói a query string de estado (só os FILTROS dos quatro painéis) para os
// redirects de POST /config/*, que não mexem no valor enviado, só no que originou o
// post. Previsto/Janelas/Meta de PU/Carga não entram mais aqui -- persistem em
// configuracoes_gerais (ver configGeralService.js), não na URL.
function montarQueryStringEstado(body) {
  const params = new URLSearchParams();
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
  const configGeral = await getConfiguracoesGerais();
  const percentual = normalizarPercentual(configGeral.percentual, PERCENTUAL_PADRAO);
    const percentualJanela = normalizarPercentual(configGeral.percentualJanela, PERCENTUAL_JANELA_PADRAO);
    const puReparo = normalizarPu(configGeral.puReparo, PU_REPARO_PADRAO);
    const metaPuTecnico = normalizarMetaPuTecnico(configGeral.metaPuTecnico, META_PU_TECNICO_PADRAO);
    const cargaReparo = normalizarPu(configGeral.cargaReparo, CARGA_REPARO_PADRAO);
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

    const percentualInstalacao = normalizarPercentual(configGeral.percentualInstalacao, PERCENTUAL_INSTALACAO_PADRAO);
    const percentualJanela1Instalacao = normalizarPercentual(configGeral.percentualJanela1Instalacao, PERCENTUAL_JANELA1_INSTALACAO_PADRAO);
    const percentualJanela2Instalacao = normalizarPercentual(configGeral.percentualJanela2Instalacao, PERCENTUAL_JANELA2_INSTALACAO_PADRAO);
    const percentualJanela3Instalacao = normalizarPercentual(configGeral.percentualJanela3Instalacao, PERCENTUAL_JANELA3_INSTALACAO_PADRAO);
    const metaPuTecnicoInstalacao = normalizarMetaPuTecnico(configGeral.metaPuTecnicoInstalacao, META_PU_TECNICO_INSTALACAO_PADRAO);
    const cargaInstalacao = normalizarPu(configGeral.cargaInstalacao, CARGA_INSTALACAO_PADRAO);

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

    const percentualServico = normalizarPercentual(configGeral.percentualServico, PERCENTUAL_SERVICO_PADRAO);
    const percentualJanela1Servico = normalizarPercentual(configGeral.percentualJanela1Servico, PERCENTUAL_JANELA1_SERVICO_PADRAO);
    const percentualJanela2Servico = normalizarPercentual(configGeral.percentualJanela2Servico, PERCENTUAL_JANELA2_SERVICO_PADRAO);
    const percentualJanela3Servico = normalizarPercentual(configGeral.percentualJanela3Servico, PERCENTUAL_JANELA3_SERVICO_PADRAO);
    const metaPuTecnicoServico = normalizarMetaPuTecnico(configGeral.metaPuTecnicoServico, META_PU_TECNICO_SERVICO_PADRAO);
    const cargaServico = normalizarPu(configGeral.cargaServico, CARGA_SERVICO_PADRAO);

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

    const percentualMe = normalizarPercentual(configGeral.percentualMe, PERCENTUAL_ME_PADRAO);
    const percentualJanela1Me = normalizarPercentual(configGeral.percentualJanela1Me, PERCENTUAL_JANELA1_ME_PADRAO);
    const percentualJanela2Me = normalizarPercentual(configGeral.percentualJanela2Me, PERCENTUAL_JANELA2_ME_PADRAO);
    const percentualJanela3Me = normalizarPercentual(configGeral.percentualJanela3Me, PERCENTUAL_JANELA3_ME_PADRAO);
    const metaPuTecnicoMe = normalizarMetaPuTecnico(configGeral.metaPuTecnicoMe, META_PU_TECNICO_ME_PADRAO);
    const cargaMe = normalizarPu(configGeral.cargaMe, CARGA_ME_PADRAO);

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
      temposBucket,
      tecnologiasDisponiveis,
      dataCargaReparo,
      { linhas: linhasInstalacoes, totalGeral: totalGeralInstalacoes },
      puProdutos,
      dataCargaInstalacoes,
      { linhas: linhasServicos, totalGeral: totalGeralServicos },
      puProdutosServicos,
      { linhas: linhasMe, totalGeral: totalGeralMe },
      puProdutosMe,
      elosCredenciais,
    ] = await Promise.all([
      getResumoBuckets(tecnologiasSelecionadas, {
        status: statusReparoSelecionados,
        statusReason: statusReasonReparoSelecionados,
      }),
      getTemposBucket(),
      getTecnologiasDisponiveis(),
      getDataCargaReparo(),
      getResumoBucketsInstalacoes({
        status: statusInstalacaoSelecionados,
        statusReason: statusReasonInstalacaoSelecionados,
        tecnologiaAcesso: tecnologiaAcessoSelecionadas,
      }),
      getPuProdutos(),
      getDataCargaInstalacoes(),
      getResumoBucketsServicos({
        status: statusServicoSelecionados,
        statusReason: statusReasonServicoSelecionados,
        tecnologiaAcesso: tecnologiaAcessoServicoSelecionadas,
      }),
      getPuProdutosServicos(),
      getResumoBucketsMe({
        status: statusMeSelecionados,
        statusReason: statusReasonMeSelecionados,
        tecnologiaAcesso: tecnologiaAcessoMeSelecionadas,
      }),
      getPuProdutosMe(),
      getElosCredenciais(),
    ]);

    const linhasComPrevistoBruto = calcularPrevisto(linhas, { percentual, campoBacklog: 'backlogReparos' });
    const totalPrevistoReparo = calcularTotalPrevisto(totalGeral, percentual);
    const linhasComSugestaoReparo = calcularSugestao(linhasComPrevistoBruto, totalPrevistoReparo, cargaReparo);
    const linhasComPrevisto = calcularDistribuicaoPorSugestao(linhasComSugestaoReparo, {
      percentuaisJanela: [percentualJanela], pu: puReparo, metaPuTecnico,
      campoBacklog: 'backlogReparos', campoTempo: 'tempoReparoMinutos',
    });
    const totais = calcularTotais(totalPrevistoReparo, cargaReparo, linhasComPrevisto, {
      percentuaisJanela: [percentualJanela], metaPuTecnico,
    });

    const percentuaisJanelaInstalacao = [percentualJanela1Instalacao, percentualJanela2Instalacao, percentualJanela3Instalacao];
    const linhasInstalacoesComPrevistoBruto = calcularPrevisto(linhasInstalacoes, {
      percentual: percentualInstalacao, campoBacklog: 'backlogInstalacoes',
    });
    const totalPrevistoInstalacaoBase = calcularTotalPrevisto(totalGeralInstalacoes, percentualInstalacao);
    const linhasInstalacoesComSugestao = calcularSugestao(linhasInstalacoesComPrevistoBruto, totalPrevistoInstalacaoBase, cargaInstalacao);
    const linhasInstalacoesComPrevisto = calcularDistribuicaoPorSugestao(linhasInstalacoesComSugestao, {
      percentuaisJanela: percentuaisJanelaInstalacao, metaPuTecnico: metaPuTecnicoInstalacao,
      campoBacklog: 'backlogInstalacoes', campoTempo: 'tempoInstalacaoMinutos',
      campoPuBruto: 'puBrutoTotal',
    });
    const totaisInstalacoes = calcularTotais(totalPrevistoInstalacaoBase, cargaInstalacao, linhasInstalacoesComPrevisto, {
      percentuaisJanela: percentuaisJanelaInstalacao, metaPuTecnico: metaPuTecnicoInstalacao,
    });
    const totalSugestaoInstalacoes = totaisInstalacoes.totalSugestao;

    const percentuaisJanelaServico = [percentualJanela1Servico, percentualJanela2Servico, percentualJanela3Servico];
    const linhasServicosComPrevistoBruto = calcularPrevisto(linhasServicos, {
      percentual: percentualServico, campoBacklog: 'backlogServicos',
    });
    const totalPrevistoServicoBase = calcularTotalPrevisto(totalGeralServicos, percentualServico);
    const linhasServicosComSugestao = calcularSugestao(linhasServicosComPrevistoBruto, totalPrevistoServicoBase, cargaServico);
    const linhasServicosComPrevisto = calcularDistribuicaoPorSugestao(linhasServicosComSugestao, {
      percentuaisJanela: percentuaisJanelaServico, metaPuTecnico: metaPuTecnicoServico,
      campoBacklog: 'backlogServicos', campoTempo: 'tempoServicoMinutos',
      campoPuBruto: 'puBrutoTotal',
    });
    const totaisServicos = calcularTotais(totalPrevistoServicoBase, cargaServico, linhasServicosComPrevisto, {
      percentuaisJanela: percentuaisJanelaServico, metaPuTecnico: metaPuTecnicoServico,
    });
    const totalSugestaoServicos = totaisServicos.totalSugestao;

    const percentuaisJanelaMe = [percentualJanela1Me, percentualJanela2Me, percentualJanela3Me];
    const linhasMeComPrevistoBruto = calcularPrevisto(linhasMe, {
      percentual: percentualMe, campoBacklog: 'backlogMe',
    });
    const totalPrevistoMeBase = calcularTotalPrevisto(totalGeralMe, percentualMe);
    const linhasMeComSugestao = calcularSugestao(linhasMeComPrevistoBruto, totalPrevistoMeBase, cargaMe);
    const linhasMeComPrevisto = calcularDistribuicaoPorSugestao(linhasMeComSugestao, {
      percentuaisJanela: percentuaisJanelaMe, metaPuTecnico: metaPuTecnicoMe,
      campoBacklog: 'backlogMe', campoTempo: 'tempoMeMinutos',
      campoPuBruto: 'puBrutoTotal',
    });
    const totaisMe = calcularTotais(totalPrevistoMeBase, cargaMe, linhasMeComPrevisto, {
      percentuaisJanela: percentuaisJanelaMe, metaPuTecnico: metaPuTecnicoMe,
    });
    const totalSugestaoMe = totaisMe.totalSugestao;

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
      cargaReparo,
      aliadaCores: construirMapaCoresAliada(ALIADA_COR_QTD, linhasComPrevisto, temposBucket),
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
      totalSugestaoInstalacoes,
      janelasInstalacaoLabels: JANELAS_INSTALACAO,
      percentualInstalacao,
      percentualJanela1Instalacao,
      percentualJanela2Instalacao,
      percentualJanela3Instalacao,
      metaPuTecnicoInstalacao,
      cargaInstalacao,
      puProdutos,
      aliadaCoresInstalacoes: construirMapaCoresAliada(ALIADA_COR_QTD, linhasInstalacoesComPrevisto, temposBucket),
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
      totalSugestaoServicos,
      janelasServicoLabels: JANELAS_SERVICO,
      percentualServico,
      percentualJanela1Servico,
      percentualJanela2Servico,
      percentualJanela3Servico,
      metaPuTecnicoServico,
      cargaServico,
      puProdutosServicos,
      aliadaCoresServicos: construirMapaCoresAliada(ALIADA_COR_QTD, linhasServicosComPrevisto, temposBucket),
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
      totalSugestaoMe,
      janelasMeLabels: JANELAS_ME,
      percentualMe,
      percentualJanela1Me,
      percentualJanela2Me,
      percentualJanela3Me,
      metaPuTecnicoMe,
      cargaMe,
      puProdutosMe,
      aliadaCoresMe: construirMapaCoresAliada(ALIADA_COR_QTD, linhasMeComPrevisto, temposBucket),
      filtrosDisponiveisMe,
      statusMeSelecionados,
      statusReasonMeSelecionados,
      tecnologiaAcessoMeSelecionadas,
      dataCargaMe: formatarDataCarga(dataCargaInstalacoes),

      // Tempos por bucket (depara_tempo_bucket): 1 tabela só, compartilhada pelas
      // 4 seções na página de Configurações (Instalação/Serviço/ME/Reparo são
      // colunas da mesma linha, não tabelas separadas).
      temposBucket,
      aliadaCoresTemposBucket: construirMapaCoresAliada(ALIADA_COR_QTD, temposBucket),

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
    const linkConfiguracoes = `/configuracoes?${montarQueryStringEstado(req.query).toString()}`;

    res.render('index', {
      ...dados,
      linkResumoCotas,
      linkConfiguracoes,
    });
  } catch (err) {
    next(err);
  }
});

// Página única de configurações: reúne os ajustes que antes ficavam espalhados
// em 4 modais (Instalações/Serviços/ME/Reparos), pra não precisar abrir um de
// cada vez -- reaproveita o mesmo carregarDadosPainel da index, então os valores
// mostrados aqui (inclusive as tabelas de tempo/PU) nunca divergem da tela principal.
router.get('/configuracoes', async (req, res, next) => {
  try {
    const dados = await carregarDadosPainel(req.query);
    const linkVoltar = `/?${montarQueryStringEstado(req.query).toString()}`;
    const linkResumoCotas = `/resumo-cotas?${montarQueryStringEstado(req.query).toString()}`;
    const linkConfiguracoes = `/configuracoes?${montarQueryStringEstado(req.query).toString()}`;

    res.render('configuracoes', {
      ...dados,
      linkVoltar,
      linkResumoCotas,
      linkConfiguracoes,
      instalacoesUpload: req.query.instalacoesUpload,
      instalacoesUploadLinhas: req.query.instalacoesUploadLinhas,
      instalacoesUploadErro: req.query.instalacoesUploadErro,
      reparosUpload: req.query.reparosUpload,
      reparosUploadLinhas: req.query.reparosUploadLinhas,
      reparosUploadErro: req.query.reparosUploadErro,
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
    const linkConfiguracoes = `/configuracoes?${montarQueryStringEstado(req.query).toString()}`;

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
      linkConfiguracoes,
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

// Previsto/Janelas/Meta de PU/Carga das 4 seções, um formulário só -- persiste em
// configuracoes_gerais (ver configGeralService.js) em vez de só na URL, então
// sobrevive a um link "limpo" ou reinício do servidor.
router.post('/config/geral', async (req, res, next) => {
  try {
    const valores = {
      percentual: normalizarPercentual(req.body.percentual, PERCENTUAL_PADRAO),
      percentualJanela: normalizarPercentual(req.body.percentualJanela, PERCENTUAL_JANELA_PADRAO),
      puReparo: normalizarPu(req.body.puReparo, PU_REPARO_PADRAO),
      metaPuTecnico: normalizarMetaPuTecnico(req.body.metaPuTecnico, META_PU_TECNICO_PADRAO),
      cargaReparo: normalizarPu(req.body.cargaReparo, CARGA_REPARO_PADRAO),
      percentualInstalacao: normalizarPercentual(req.body.percentualInstalacao, PERCENTUAL_INSTALACAO_PADRAO),
      percentualJanela1Instalacao: normalizarPercentual(req.body.percentualJanela1Instalacao, PERCENTUAL_JANELA1_INSTALACAO_PADRAO),
      percentualJanela2Instalacao: normalizarPercentual(req.body.percentualJanela2Instalacao, PERCENTUAL_JANELA2_INSTALACAO_PADRAO),
      percentualJanela3Instalacao: normalizarPercentual(req.body.percentualJanela3Instalacao, PERCENTUAL_JANELA3_INSTALACAO_PADRAO),
      metaPuTecnicoInstalacao: normalizarMetaPuTecnico(req.body.metaPuTecnicoInstalacao, META_PU_TECNICO_INSTALACAO_PADRAO),
      cargaInstalacao: normalizarPu(req.body.cargaInstalacao, CARGA_INSTALACAO_PADRAO),
      percentualServico: normalizarPercentual(req.body.percentualServico, PERCENTUAL_SERVICO_PADRAO),
      percentualJanela1Servico: normalizarPercentual(req.body.percentualJanela1Servico, PERCENTUAL_JANELA1_SERVICO_PADRAO),
      percentualJanela2Servico: normalizarPercentual(req.body.percentualJanela2Servico, PERCENTUAL_JANELA2_SERVICO_PADRAO),
      percentualJanela3Servico: normalizarPercentual(req.body.percentualJanela3Servico, PERCENTUAL_JANELA3_SERVICO_PADRAO),
      metaPuTecnicoServico: normalizarMetaPuTecnico(req.body.metaPuTecnicoServico, META_PU_TECNICO_SERVICO_PADRAO),
      cargaServico: normalizarPu(req.body.cargaServico, CARGA_SERVICO_PADRAO),
      percentualMe: normalizarPercentual(req.body.percentualMe, PERCENTUAL_ME_PADRAO),
      percentualJanela1Me: normalizarPercentual(req.body.percentualJanela1Me, PERCENTUAL_JANELA1_ME_PADRAO),
      percentualJanela2Me: normalizarPercentual(req.body.percentualJanela2Me, PERCENTUAL_JANELA2_ME_PADRAO),
      percentualJanela3Me: normalizarPercentual(req.body.percentualJanela3Me, PERCENTUAL_JANELA3_ME_PADRAO),
      metaPuTecnicoMe: normalizarMetaPuTecnico(req.body.metaPuTecnicoMe, META_PU_TECNICO_ME_PADRAO),
      cargaMe: normalizarPu(req.body.cargaMe, CARGA_ME_PADRAO),
    };

    await salvarConfiguracoesGerais(valores);

    res.redirect(`/configuracoes?${montarQueryStringEstado(req.body).toString()}`);
  } catch (err) {
    next(err);
  }
});

// Um formulário só grava as 4 colunas de uma vez (INSTALACAO/SERVICO/ALTERACAO/REPARO)
// porque é uma tabela só (depara_tempo_bucket) -- ver temposBucketService.js.
router.post('/config/tempo-bucket', async (req, res, next) => {
  try {
    const buckets = [].concat(req.body.bucket || []);
    const instalacoes = [].concat(req.body.instalacao || []);
    const servicos = [].concat(req.body.servico || []);
    const alteracoes = [].concat(req.body.alteracao || []);
    const reparos = [].concat(req.body.reparo || []);

    const atualizacoes = buckets
      .map((bucket, i) => ({
        bucket,
        instalacao: Number(instalacoes[i]),
        servico: Number(servicos[i]),
        alteracao: Number(alteracoes[i]),
        reparo: Number(reparos[i]),
      }))
      .filter(item => item.bucket
        && Number.isFinite(item.instalacao) && item.instalacao >= 0
        && Number.isFinite(item.servico) && item.servico >= 0
        && Number.isFinite(item.alteracao) && item.alteracao >= 0
        && Number.isFinite(item.reparo) && item.reparo >= 0);

    await atualizarTemposBucket(atualizacoes);

    res.redirect(`/configuracoes?${montarQueryStringEstado(req.body).toString()}`);
  } catch (err) {
    next(err);
  }
});

// Um formulário só grava as 3 tabelas de PU por produto (Instalação/Serviço/ME) de
// uma vez -- são tabelas diferentes (produtos não se correspondem entre seções),
// mas a página mostra tudo numa tabela só, então o salvamento também é um só.
router.post('/config/pu-produto-todos', async (req, res, next) => {
  try {
    const montarAtualizacoes = (produtos, pus) => [].concat(produtos || [])
      .map((produto, i) => ({ produto, pu: Number([].concat(pus || [])[i]) }))
      .filter(item => item.produto && Number.isFinite(item.pu) && item.pu >= 0);

    await Promise.all([
      atualizarPuProdutos(montarAtualizacoes(req.body.produtoInstalacao, req.body.puInstalacao)),
      atualizarPuProdutosServicos(montarAtualizacoes(req.body.produtoServico, req.body.puServico)),
      atualizarPuProdutosMe(montarAtualizacoes(req.body.produtoMe, req.body.puMe)),
    ]);

    res.redirect(`/configuracoes?${montarQueryStringEstado(req.body).toString()}`);
  } catch (err) {
    next(err);
  }
});

router.post('/instalacoes/upload', upload.single('arquivo'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.redirect('/configuracoes?instalacoesUpload=erro&instalacoesUploadErro=' + encodeURIComponent('Nenhum arquivo selecionado.'));
    }

    const { totalLinhas } = await importarInstalacoes(req.file.buffer, req.file.originalname);

    res.redirect(`/configuracoes?instalacoesUpload=ok&instalacoesUploadLinhas=${totalLinhas}`);
  } catch (err) {
    res.redirect('/configuracoes?instalacoesUpload=erro&instalacoesUploadErro=' + encodeURIComponent(err.message));
  }
});

// Upload manual do backlog de Reparos -- TRUNCATE + INSERT em backlog_elos
// (substitui tudo), igual ao de Instalações. Diferente de Instalações, essa
// tabela é compartilhada com outro sistema (ver reparosUploadService.js) --
// decisão consciente do usuário de manter simples em vez de um upsert escopado.
router.post('/reparos/upload', upload.single('arquivo'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.redirect('/configuracoes?reparosUpload=erro&reparosUploadErro=' + encodeURIComponent('Nenhum arquivo selecionado.'));
    }

    const { totalLinhas } = await importarReparos(req.file.buffer);

    res.redirect(`/configuracoes?reparosUpload=ok&reparosUploadLinhas=${totalLinhas}`);
  } catch (err) {
    res.redirect('/configuracoes?reparosUpload=erro&reparosUploadErro=' + encodeURIComponent(err.message));
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

// Consultado via polling pelo modal "Credenciais do Elos" (public/js/main.js)
// enquanto ele está aberto, pra mostrar o progresso ao vivo da raspagem
// (login, exportando, importando...) sem precisar recarregar a página.
router.get('/api/raspagem-status', async (req, res, next) => {
  try {
    const status = await getStatusRaspagem();
    if (!status) {
      return res.json({ etapa: 'ocioso', mensagem: '', ultimaExecucaoEm: null, ultimoResultado: null, ultimasLinhas: null, ultimoErro: null });
    }

    res.json({
      etapa: status.etapa,
      mensagem: status.mensagem,
      ultimaExecucaoEm: status.ultima_execucao_em ? formatarDataCarga(status.ultima_execucao_em) : null,
      ultimoResultado: status.ultimo_resultado,
      ultimasLinhas: status.ultimas_linhas,
      ultimoErro: status.ultimo_erro,
    });
  } catch (err) {
    next(err);
  }
});

// Botão "Executar agora" do modal "Credenciais do Elos" -- só liga a flag;
// quem roda de fato é o processo separado da raspagem (ver comentário em
// raspagemStatusService.js). Resposta em JSON porque é chamado via fetch, sem
// navegação de página (mantém o modal aberto e a barra de status atualizando).
router.post('/api/raspagem-executar-agora', async (req, res, next) => {
  try {
    await solicitarExecucaoManual();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
