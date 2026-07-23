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
const { getTemposBucket, atualizarTemposBucket } = require('../services/temposBucketService');
const {
  calcularPrevisto,
  calcularTotalPrevisto,
  calcularSugestao,
  calcularDistribuicaoPorSugestao,
  calcularTotais,
  construirMapaCoresAliada,
} = require('../services/calculoBacklogService');
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

// Reconstrói a query string de estado (filtros + configs dos quatro painéis) para os
// redirects de POST /config/*, que não mexem no valor enviado, só no que originou o post.
function montarQueryStringEstado(body) {
  const params = new URLSearchParams();
  if (body.percentual) params.set('percentual', body.percentual);
  if (body.percentualJanela) params.set('percentualJanela', body.percentualJanela);
  if (body.puReparo) params.set('puReparo', body.puReparo);
  if (body.metaPuTecnico) params.set('metaPuTecnico', body.metaPuTecnico);
  if (body.cargaReparo) params.set('cargaReparo', body.cargaReparo);
  if (body.percentualInstalacao) params.set('percentualInstalacao', body.percentualInstalacao);
  if (body.percentualJanela1Instalacao) params.set('percentualJanela1Instalacao', body.percentualJanela1Instalacao);
  if (body.percentualJanela2Instalacao) params.set('percentualJanela2Instalacao', body.percentualJanela2Instalacao);
  if (body.percentualJanela3Instalacao) params.set('percentualJanela3Instalacao', body.percentualJanela3Instalacao);
  if (body.metaPuTecnicoInstalacao) params.set('metaPuTecnicoInstalacao', body.metaPuTecnicoInstalacao);
  if (body.cargaInstalacao) params.set('cargaInstalacao', body.cargaInstalacao);
  if (body.percentualServico) params.set('percentualServico', body.percentualServico);
  if (body.percentualJanela1Servico) params.set('percentualJanela1Servico', body.percentualJanela1Servico);
  if (body.percentualJanela2Servico) params.set('percentualJanela2Servico', body.percentualJanela2Servico);
  if (body.percentualJanela3Servico) params.set('percentualJanela3Servico', body.percentualJanela3Servico);
  if (body.metaPuTecnicoServico) params.set('metaPuTecnicoServico', body.metaPuTecnicoServico);
  if (body.cargaServico) params.set('cargaServico', body.cargaServico);
  if (body.percentualMe) params.set('percentualMe', body.percentualMe);
  if (body.percentualJanela1Me) params.set('percentualJanela1Me', body.percentualJanela1Me);
  if (body.percentualJanela2Me) params.set('percentualJanela2Me', body.percentualJanela2Me);
  if (body.percentualJanela3Me) params.set('percentualJanela3Me', body.percentualJanela3Me);
  if (body.metaPuTecnicoMe) params.set('metaPuTecnicoMe', body.metaPuTecnicoMe);
  if (body.cargaMe) params.set('cargaMe', body.cargaMe);
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
    const cargaReparo = normalizarPu(query.cargaReparo, CARGA_REPARO_PADRAO);
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
    const cargaInstalacao = normalizarPu(query.cargaInstalacao, CARGA_INSTALACAO_PADRAO);

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
    const cargaServico = normalizarPu(query.cargaServico, CARGA_SERVICO_PADRAO);

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
    const cargaMe = normalizarPu(query.cargaMe, CARGA_ME_PADRAO);

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
      instalacoesUpload: req.query.instalacoesUpload,
      instalacoesUploadLinhas: req.query.instalacoesUploadLinhas,
      instalacoesUploadErro: req.query.instalacoesUploadErro,
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
