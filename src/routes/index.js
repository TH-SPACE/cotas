const express = require('express');
const multer = require('multer');
const {
  getResumoBuckets,
  getTecnologiasDisponiveis,
  TECNOLOGIA_PADRAO,
  getFiltrosDisponiveisReparo,
  getDataCargaReparo,
  STATUS_EXCLUIDOS_PADRAO: STATUS_EXCLUIDOS_PADRAO_REPARO,
  STATUS_REASON_INCLUIDOS_PADRAO: STATUS_REASON_INCLUIDOS_PADRAO_REPARO,
} = require('../services/bucketService');
const {
  getResumoBucketsInstalacoes,
  getFiltrosDisponiveisInstalacoes,
  getPuProdutos,
  atualizarPuProdutos,
  STATUS_EXCLUIDOS_PADRAO: STATUS_EXCLUIDOS_PADRAO_INSTALACAO,
  STATUS_REASON_INCLUIDOS_PADRAO: STATUS_REASON_INCLUIDOS_PADRAO_INSTALACAO,
  TECNOLOGIA_ACESSO_PADRAO,
} = require('../services/instalacaoBucketService');
const {
  getResumoBucketsServicos,
  getFiltrosDisponiveisServicos,
  getPuProdutosServicos,
  atualizarPuProdutosServicos,
  STATUS_EXCLUIDOS_PADRAO: STATUS_EXCLUIDOS_PADRAO_SERVICO,
  STATUS_REASON_INCLUIDOS_PADRAO: STATUS_REASON_INCLUIDOS_PADRAO_SERVICO,
  TECNOLOGIA_ACESSO_PADRAO: TECNOLOGIA_ACESSO_PADRAO_SERVICO,
} = require('../services/servicoBucketService');
const {
  getResumoBucketsMe,
  getFiltrosDisponiveisMe,
  getPuProdutosMe,
  atualizarPuProdutosMe,
  STATUS_EXCLUIDOS_PADRAO: STATUS_EXCLUIDOS_PADRAO_ME,
  STATUS_REASON_INCLUIDOS_PADRAO: STATUS_REASON_INCLUIDOS_PADRAO_ME,
  TECNOLOGIA_ACESSO_PADRAO: TECNOLOGIA_ACESSO_PADRAO_ME,
} = require('../services/meBucketService');
const { importarInstalacoes, getDataCargaInstalacoes } = require('../services/instalacoesService');
const { importarReparos } = require('../services/reparosUploadService');
const {
  importarCotas,
  getCotasD0,
  getCotasD1aD7,
  getDatasCargaCotas,
  getDiasAtrasoCotas,
  TIPOS: TIPOS_COTAS,
} = require('../services/cotasService');
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

// Mapas tipo -> chave/padrão usados pelos botões "Previsto (X%)" e "Sugestão"
// da home (edição rápida de 1 campo só, sem precisar abrir a página de
// Configurações inteira) -- ver POST /config/rapido, mais abaixo.
const PERCENTUAL_CONFIG_POR_TIPO = {
  reparo: { chave: 'percentual', padrao: PERCENTUAL_PADRAO },
  instalacao: { chave: 'percentualInstalacao', padrao: PERCENTUAL_INSTALACAO_PADRAO },
  servico: { chave: 'percentualServico', padrao: PERCENTUAL_SERVICO_PADRAO },
  me: { chave: 'percentualMe', padrao: PERCENTUAL_ME_PADRAO },
};

const CARGA_CONFIG_POR_TIPO = {
  reparo: { chave: 'cargaReparo', padrao: CARGA_REPARO_PADRAO },
  instalacao: { chave: 'cargaInstalacao', padrao: CARGA_INSTALACAO_PADRAO },
  servico: { chave: 'cargaServico', padrao: CARGA_SERVICO_PADRAO },
  me: { chave: 'cargaMe', padrao: CARGA_ME_PADRAO },
};

// Meta de PU por técnico -- ao contrário do peso de PU em si (fixo só em
// Reparos; Instalação/Serviço/ME usam PU por Specification Product, tabela
// própria que não cabe num campo só), a Meta É um valor único nas 4 seções.
// É o que o botão "PU" do cabeçalho edita (afeta a coluna Técnicos = PU ÷ Meta).
const META_PU_CONFIG_POR_TIPO = {
  reparo: { chave: 'metaPuTecnico', padrao: META_PU_TECNICO_PADRAO },
  instalacao: { chave: 'metaPuTecnicoInstalacao', padrao: META_PU_TECNICO_INSTALACAO_PADRAO },
  servico: { chave: 'metaPuTecnicoServico', padrao: META_PU_TECNICO_SERVICO_PADRAO },
  me: { chave: 'metaPuTecnicoMe', padrao: META_PU_TECNICO_ME_PADRAO },
};

// campo (do <select>/hidden do modal) -> qual mapa usar e qual normalizador
// (Previsto é 0-100%, Carga/Meta de PU são quantidades livres > 0).
const CONFIG_RAPIDO_POR_CAMPO = {
  previsto: { mapa: PERCENTUAL_CONFIG_POR_TIPO, normalizar: normalizarPercentual },
  carga: { mapa: CARGA_CONFIG_POR_TIPO, normalizar: normalizarPu },
  metaPu: { mapa: META_PU_CONFIG_POR_TIPO, normalizar: normalizarMetaPuTecnico },
};

// Todas as % de janela possíveis (as 10 chaves: 1 de Reparos + 3 de cada uma
// das outras 3 seções) -- usado pelo botão "ORDENS" no cabeçalho da home (edita
// as janelas de 1 seção por vez). A última janela de cada seção nunca aparece
// aqui: é sempre o restante (100 - as editáveis), calculado no cliente e no
// service (calculoBacklogService.js), nunca persistido.
const JANELA_CAMPOS_PADRAO = {
  percentualJanela: PERCENTUAL_JANELA_PADRAO,
  percentualJanela1Instalacao: PERCENTUAL_JANELA1_INSTALACAO_PADRAO,
  percentualJanela2Instalacao: PERCENTUAL_JANELA2_INSTALACAO_PADRAO,
  percentualJanela3Instalacao: PERCENTUAL_JANELA3_INSTALACAO_PADRAO,
  percentualJanela1Servico: PERCENTUAL_JANELA1_SERVICO_PADRAO,
  percentualJanela2Servico: PERCENTUAL_JANELA2_SERVICO_PADRAO,
  percentualJanela3Servico: PERCENTUAL_JANELA3_SERVICO_PADRAO,
  percentualJanela1Me: PERCENTUAL_JANELA1_ME_PADRAO,
  percentualJanela2Me: PERCENTUAL_JANELA2_ME_PADRAO,
  percentualJanela3Me: PERCENTUAL_JANELA3_ME_PADRAO,
};

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
  [].concat(body.aliada || []).forEach(v => params.append('aliada', v));
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
    filtrosDisponiveisReparo.statusReason.filter(v => STATUS_REASON_INCLUIDOS_PADRAO_REPARO.includes(v))
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
    filtrosDisponiveisInstalacoes.statusReason.filter(v => STATUS_REASON_INCLUIDOS_PADRAO_INSTALACAO.includes(v))
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
    filtrosDisponiveisServicos.statusReason.filter(v => STATUS_REASON_INCLUIDOS_PADRAO_SERVICO.includes(v))
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
    filtrosDisponiveisMe.statusReason.filter(v => STATUS_REASON_INCLUIDOS_PADRAO_ME.includes(v))
  );
  const tecnologiaAcessoMeSelecionadas = normalizarListaComPadrao(query.tecnologiaAcessoMe, TECNOLOGIA_ACESSO_PADRAO_ME);

  const [
    { linhas: linhasReparoBruto },
    temposBucket,
    tecnologiasDisponiveis,
    dataCargaReparo,
    { linhas: linhasInstalacoesBruto },
    puProdutos,
    dataCargaInstalacoes,
    { linhas: linhasServicosBruto },
    puProdutosServicos,
    { linhas: linhasMeBruto },
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

  // Filtro de Aliada: único filtro compartilhado pelos 4 painéis ao mesmo tempo
  // (diferente de tecnologia/status, que são por seção) -- widget global fica no
  // head.ejs, presente em toda página. Disponíveis = união do que aparece hoje
  // em qualquer um dos 4 painéis (normalmente ABILITY/ONDACOM/VIVO); aplica
  // ANTES de Previsto/Sugestão pra recalcular o total geral de cada painel só
  // com as aliadas selecionadas, igual aos outros filtros (não é só cosmético
  // na tabela).
  const aliadasDisponiveis = [...new Set([
    ...linhasReparoBruto.map(l => l.aliada),
    ...linhasInstalacoesBruto.map(l => l.aliada),
    ...linhasServicosBruto.map(l => l.aliada),
    ...linhasMeBruto.map(l => l.aliada),
  ])].sort();
  const aliadasSelecionadas = normalizarListaComPadrao(query.aliada, aliadasDisponiveis);

  const filtrarPorAliada = (linhasSecao, campoBacklog) => {
    const linhasFiltradas = linhasSecao.filter(l => aliadasSelecionadas.includes(l.aliada));
    const totalGeralFiltrado = linhasFiltradas.reduce((acc, l) => acc + l[campoBacklog], 0);
    return { linhas: linhasFiltradas, totalGeral: totalGeralFiltrado };
  };

  const { linhas, totalGeral } = filtrarPorAliada(linhasReparoBruto, 'backlogReparos');
  const { linhas: linhasInstalacoes, totalGeral: totalGeralInstalacoes } = filtrarPorAliada(linhasInstalacoesBruto, 'backlogInstalacoes');
  const { linhas: linhasServicos, totalGeral: totalGeralServicos } = filtrarPorAliada(linhasServicosBruto, 'backlogServicos');
  const { linhas: linhasMe, totalGeral: totalGeralMe } = filtrarPorAliada(linhasMeBruto, 'backlogMe');

  const linhasComPrevistoBruto = calcularPrevisto(linhas, { percentual, campoBacklog: 'backlogReparos' });
  const totalPrevistoReparo = calcularTotalPrevisto(totalGeral, percentual);
  const linhasComSugestaoReparo = calcularSugestao(linhasComPrevistoBruto, totalPrevistoReparo, cargaReparo);
  const linhasComPrevisto = calcularDistribuicaoPorSugestao(linhasComSugestaoReparo, {
    percentuaisJanela: [percentualJanela], pu: puReparo, metaPuTecnico,
    campoBacklog: 'backlogReparos', campoTempo: 'tempoReparoMinutos',
  });
  const totais = calcularTotais(linhasComPrevisto, {
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
  const totaisInstalacoes = calcularTotais(linhasInstalacoesComPrevisto, {
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
  const totaisServicos = calcularTotais(linhasServicosComPrevisto, {
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
  const totaisMe = calcularTotais(linhasMeComPrevisto, {
    percentuaisJanela: percentuaisJanelaMe, metaPuTecnico: metaPuTecnicoMe,
  });
  const totalSugestaoMe = totaisMe.totalSugestao;

  return {
    // Aliada: filtro global (compartilhado pelos 4 painéis), widget fica no
    // head.ejs e aparece em toda página.
    aliadasDisponiveis,
    aliadasSelecionadas,

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
    const linkCotasPlanejadas = `/cotas-planejadas?${montarQueryStringEstado(req.query).toString()}`;
    const linkProjecaoD1D7 = `/projecao-d1-d7?${montarQueryStringEstado(req.query).toString()}`;

    res.render('index', {
      ...dados,
      linkResumoCotas,
      linkConfiguracoes,
      linkCotasPlanejadas,
      linkProjecaoD1D7,
      pathAtual: req.path,
      queryAtual: req.query,
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
    const linkCotasPlanejadas = `/cotas-planejadas?${montarQueryStringEstado(req.query).toString()}`;
    const linkProjecaoD1D7 = `/projecao-d1-d7?${montarQueryStringEstado(req.query).toString()}`;

    res.render('configuracoes', {
      ...dados,
      linkVoltar,
      linkResumoCotas,
      linkConfiguracoes,
      linkCotasPlanejadas,
      linkProjecaoD1D7,
      instalacoesUpload: req.query.instalacoesUpload,
      instalacoesUploadLinhas: req.query.instalacoesUploadLinhas,
      instalacoesUploadErro: req.query.instalacoesUploadErro,
      reparosUpload: req.query.reparosUpload,
      reparosUploadLinhas: req.query.reparosUploadLinhas,
      reparosUploadErro: req.query.reparosUploadErro,
      pathAtual: req.path,
      queryAtual: req.query,
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
    const linkCotasPlanejadas = `/cotas-planejadas?${montarQueryStringEstado(req.query).toString()}`;
    const linkProjecaoD1D7 = `/projecao-d1-d7?${montarQueryStringEstado(req.query).toString()}`;

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
            instalacaoTecnicos: 0,
            meTecnicos: 0,
            servicoTecnicos: 0,
            reparoTecnicos: 0,
          });
        }
        const linhaBucket = porBucket.get(linha.bucket);
        linhaBucket[campo] = linha.minutos;
        linhaBucket[`${campo}Tecnicos`] = linha.tecnicos;
      });
    };
    acumularSecao(dados.linhasInstalacoes, 'instalacao', qtdJanelasInstalacao);
    acumularSecao(dados.linhasMe, 'me', qtdJanelasMe);
    acumularSecao(dados.linhasServicos, 'servico', qtdJanelasServico);
    acumularSecao(dados.linhas, 'reparo', qtdJanelasReparo);

    // Coluna Técnicos: por bucket, soma os 4 painéis (cada um já é PU ÷ Meta
    // arredondado pra cima daquele bucket especificamente -- ver
    // calcularDistribuicaoPorSugestao). Total geral do rodapé usa os totais já
    // arredondados por painel (dados.totalTecnicos*), não a soma da coluna --
    // evita que a tabela feche com um número diferente do "Técnicos" das outras
    // páginas por causa de arredondamento por bucket vs por painel.
    const linhasResumo = [...porBucket.values()]
      .map(linha => ({
        ...linha,
        totalTecnicos: linha.instalacaoTecnicos + linha.meTecnicos + linha.servicoTecnicos + linha.reparoTecnicos,
      }))
      .sort((a, b) => a.aliada.localeCompare(b.aliada) || a.bucket.localeCompare(b.bucket));

    const totalTecnicosGeral = dados.totalTecnicos + dados.totalTecnicosInstalacoes
      + dados.totalTecnicosServicos + dados.totalTecnicosMe;

    res.render('resumo-cotas', {
      linkVoltar,
      linkResumoCotas,
      linkConfiguracoes,
      linkCotasPlanejadas,
      linkProjecaoD1D7,
      linhasResumo,
      janelasInstalacaoLabels: dados.janelasInstalacaoLabels,
      janelasMeLabels: dados.janelasMeLabels,
      janelasServicoLabels: dados.janelasServicoLabels,
      janelasReparoLabels: dados.janelasReparoLabels,
      totalMinutosInstalacao: dados.totalMinutosInstalacoes,
      totalMinutosMe: dados.totalMinutosMe,
      totalMinutosServico: dados.totalMinutosServicos,
      totalMinutosReparo: dados.totalMinutos,
      totalTecnicosGeral,
      aliadaCores: construirMapaCoresAliada(ALIADA_COR_QTD, linhasResumo),
      elosCredenciais: dados.elosCredenciais,
      aliadasDisponiveis: dados.aliadasDisponiveis,
      aliadasSelecionadas: dados.aliadasSelecionadas,
      pathAtual: req.path,
      queryAtual: req.query,
    });
  } catch (err) {
    next(err);
  }
});

// Página nova de Cotas Planejadas: uma tabela por janela de horário, uma linha por
// bucket. "Planej." vem do snapshot salvo em D-1 (às 9h do dia anterior via cron),
// garantindo que o planejamento feito ontem não mude quando o backlog de hoje carregar.
// Se não houver snapshot de D-1 (ex.: primeiro dia em uso), cai no cálculo ao vivo
// como fallback, igual ao comportamento anterior.
// "Status" e "COTAS D0" vêm do upload do Excel de cotas do ELOS.
router.get('/cotas-planejadas', async (req, res, next) => {
  try {
    const dados = await carregarDadosPainel(req.query);
    const { getSnapshotD1 } = require('../services/snapshotService');
    const linkVoltar = `/?${montarQueryStringEstado(req.query).toString()}`;
    const linkResumoCotas = `/resumo-cotas?${montarQueryStringEstado(req.query).toString()}`;
    const linkConfiguracoes = `/configuracoes?${montarQueryStringEstado(req.query).toString()}`;
    const linkCotasPlanejadas = `/cotas-planejadas?${montarQueryStringEstado(req.query).toString()}`;
    const linkProjecaoD1D7 = `/projecao-d1-d7?${montarQueryStringEstado(req.query).toString()}`;

    // Normaliza o rótulo da janela tirando espaços porque o Excel usa "08:30-10:30"
    // e os labels do painel usam "08:30 - 10:30".
    const chaveJanela = (valor) => String(valor || '').replace(/\s/g, '');

    // bucket -> janela -> { status, cotaAberta, cotaUsada } da linha Age=D0.
    const montarMapaD0 = (linhas) => {
      const mapa = {};
      linhas.forEach(r => {
        (mapa[r.bucket] || (mapa[r.bucket] = {}))[chaveJanela(r.timeSlot)] = {
          status: r.status,
          cotaAberta: r.cotaAberta,
          cotaUsada: r.cotaUsada,
        };
      });
      return mapa;
    };

    // Snapshot D-1: { instalacao: { bucket: [{label,minutos,ordens},...] }, ... }
    // Se vazio (primeiro uso), linhasXxx do painel ao vivo servem de fallback.
    const snapshotD1 = await getSnapshotD1();
    const temSnapshotD1 = Object.keys(snapshotD1).length > 0;

    // Reconstrói as linhas no mesmo formato que o partial tabela-cotas espera
    // (linha.janelas[], linha.minutos[]), mas agora com dados do snapshot D-1.
    // Se não houver snapshot de D-1 para aquele tipo, Planej. fica tudo zero
    // (não usa cálculo ao vivo para não enganar).
    const linhasDeSnapshot = (tipo, linhasVivas, labels) => {
      const bucketSnap = temSnapshotD1 ? (snapshotD1[tipo] || {}) : {};
      return linhasVivas.map(linha => {
        const janSnap = bucketSnap[linha.bucket];
        const minutos = labels.map((_, j) => (janSnap && janSnap[j] ? janSnap[j].minutos : 0));
        const janelas = labels.map((_, j) => (janSnap && janSnap[j] ? janSnap[j].ordens : 0));
        return { ...linha, minutos, janelas };
      });
    };

    const linhasInstalacoesComPlanej = linhasDeSnapshot(
      'instalacao', dados.linhasInstalacoes, dados.janelasInstalacaoLabels
    );
    const linhasServicosComPlanej = linhasDeSnapshot(
      'servico', dados.linhasServicos, dados.janelasServicoLabels
    );
    const linhasMeComPlanej = linhasDeSnapshot(
      'me', dados.linhasMe, dados.janelasMeLabels
    );
    const linhasReparosComPlanej = linhasDeSnapshot(
      'reparo', dados.linhas, dados.janelasReparoLabels
    );

    const [cotasD0, cotasD0Servico, cotasD0Me, cotasD0Reparo] = await Promise.all([
      getCotasD0('instalacao'),
      getCotasD0('servico'),
      getCotasD0('me'),
      getCotasD0('reparo'),
    ]);
    const mapaCotasD0 = montarMapaD0(cotasD0);
    const mapaCotasD0Servico = montarMapaD0(cotasD0Servico);
    const mapaCotasD0Me = montarMapaD0(cotasD0Me);
    const mapaCotasD0Reparo = montarMapaD0(cotasD0Reparo);

    const datasCargaBrutas = await getDatasCargaCotas();
    const datasCargaCotas = {};
    Object.entries(datasCargaBrutas).forEach(([tipo, data]) => {
      datasCargaCotas[tipo] = data ? formatarDataCarga(data) : null;
    });
    // Dias desde a última carga por tipo -- quando > 0, o Status/D0 mostrado NÃO
    // é mais o AGE='D0' literal do arquivo (ver comentário em cotasService.js
    // ageEfetivo): já foi ajustado pra continuar representando hoje de verdade,
    // mas a tela avisa isso pra não passar a impressão de que a base está em dia.
    const diasAtrasoCotas = await getDiasAtrasoCotas();

    res.render('cotas-planejadas', {
      // Sinaliza pro head.ejs mostrar o botão "Upload de cotas" na navbar só aqui
      // (o <dialog> do upload mora nesta página).
      paginaAtual: 'cotas-planejadas',
      linkVoltar,
      linkResumoCotas,
      linkConfiguracoes,
      linkCotasPlanejadas,
      linkProjecaoD1D7,
      linhasInstalacoes: linhasInstalacoesComPlanej,
      janelasInstalacaoLabels: dados.janelasInstalacaoLabels,
      aliadaCoresInstalacoes: dados.aliadaCoresInstalacoes,
      mapaCotasD0,
      // Serviços: mesma estrutura, recorte/tempo próprios (depara_tempo_bucket.SERVICO).
      linhasServicos: linhasServicosComPlanej,
      janelasServicoLabels: dados.janelasServicoLabels,
      aliadaCoresServicos: dados.aliadaCoresServicos,
      mapaCotasD0Servico,
      // ME: mesma estrutura, recorte/tempo próprios (depara_tempo_bucket.ALTERACAO).
      linhasMe: linhasMeComPlanej,
      janelasMeLabels: dados.janelasMeLabels,
      aliadaCoresMe: dados.aliadaCoresMe,
      mapaCotasD0Me,
      // Reparos: único tipo em backlog_elos (não backlog_instalacoes); tempo
      // próprio (depara_tempo_bucket.REPARO), só 2 janelas (não 4).
      linhasReparos: linhasReparosComPlanej,
      janelasReparoLabels: dados.janelasReparoLabels,
      aliadaCoresReparos: dados.aliadaCores,
      mapaCotasD0Reparo,
      datasCargaCotas,
      diasAtrasoCotas,
      // Indica ao template se o Planej. vem do histórico (D-1) ou do cálculo ao vivo.
      planejadoDeHistorico: temSnapshotD1,
      cotasUpload: req.query.cotasUpload,
      cotasUploadTipo: req.query.cotasUploadTipo,
      cotasUploadLinhas: req.query.cotasUploadLinhas,
      cotasUploadErro: req.query.cotasUploadErro,
      elosCredenciais: dados.elosCredenciais,
      aliadasDisponiveis: dados.aliadasDisponiveis,
      aliadasSelecionadas: dados.aliadasSelecionadas,
      pathAtual: req.path,
      queryAtual: req.query,
    });
  } catch (err) {
    next(err);
  }
});

// Projeção D1-D7: por bucket, o Status/Cota Aberta (rótulo AGE do próprio arquivo
// do ETA -- pode estar desatualizado se a base não for reenviada, ver
// datasCargaCotas) e o Consumo (calculado por data de calendário real, D1..D7 a
// partir de hoje) de cada um dos 4 tipos. Status/Cota Aberta são agregados por
// bucket somando/contando todas as janelas daquele bucket no dia (um bucket pode
// ter janelas com Status diferentes no mesmo dia -- daí "Parcial").
router.get('/projecao-d1-d7', async (req, res, next) => {
  try {
    const dados = await carregarDadosPainel(req.query);
    const linkVoltar = `/?${montarQueryStringEstado(req.query).toString()}`;
    const linkResumoCotas = `/resumo-cotas?${montarQueryStringEstado(req.query).toString()}`;
    const linkConfiguracoes = `/configuracoes?${montarQueryStringEstado(req.query).toString()}`;
    const linkCotasPlanejadas = `/cotas-planejadas?${montarQueryStringEstado(req.query).toString()}`;
    const linkProjecaoD1D7 = `/projecao-d1-d7?${montarQueryStringEstado(req.query).toString()}`;

    // 7 dias à frente de hoje, com data de calendário real -- ao contrário do AGE
    // do arquivo do ETA (que é o rótulo que o próprio relatório trouxe, e pode
    // estar desatualizado se ninguém reenviar a base), essa data aqui é sempre
    // recalculada a partir de "agora".
    const hoje = new Date();
    const dias = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(hoje);
      d.setDate(d.getDate() + i + 1);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return { age: `D${i + 1}`, dataIso: `${d.getFullYear()}-${mm}-${dd}`, dataLabel: `${dd}/${mm}` };
    });
    // Normaliza o rótulo da janela tirando espaços (Excel usa "08:30-10:30", os
    // labels do painel usam "08:30 - 10:30") -- mesmo truque da rota /cotas-planejadas.
    const chaveJanela = (valor) => String(valor || '').replace(/\s/g, '');

    // Filtro opcional por janela (TIME_SLOT), um por tipo -- só filtra o que já
    // vem calculado, não refaz nenhum cálculo. `?janelaInstalacao=1` etc. (índice
    // em janelasXxxLabels); ausente ou 'todas' = soma todas as janelas do bucket
    // (comportamento padrão, "Total" continua igual a antes).
    const janelaSelecionadaDe = (valorQuery, labels) => {
      if (valorQuery === undefined || valorQuery === 'todas') return null;
      const indice = Number(valorQuery);
      if (!Number.isInteger(indice) || indice < 0 || indice >= labels.length) return null;
      return { indice, chave: chaveJanela(labels[indice]) };
    };
    const janelaInstalacaoSel = janelaSelecionadaDe(req.query.janelaInstalacao, dados.janelasInstalacaoLabels);
    const janelaServicoSel = janelaSelecionadaDe(req.query.janelaServico, dados.janelasServicoLabels);
    const janelaMeSel = janelaSelecionadaDe(req.query.janelaMe, dados.janelasMeLabels);
    const janelaReparoSel = janelaSelecionadaDe(req.query.janelaReparo, dados.janelasReparoLabels);

    // bucket -> age -> { statusAberto, statusTotal, cotaAberta, cotaUsada }.
    // `chaveFiltro`, se vier, restringe a soma a uma única janela (quando só sobra
    // uma janela contribuindo, statusAberto sempre bate com statusTotal ou zera --
    // "Parcial" só aparece mesmo quando várias janelas do bucket estão somadas).
    const montarMapaCotasPorDia = (linhas, chaveFiltro) => {
      const mapa = {};
      linhas.forEach(r => {
        if (chaveFiltro && chaveJanela(r.timeSlot) !== chaveFiltro) return;
        const porBucket = mapa[r.bucket] || (mapa[r.bucket] = {});
        const acc = porBucket[r.age] || (porBucket[r.age] = {
          statusAberto: 0, statusTotal: 0, cotaAberta: 0, cotaUsada: 0,
        });
        acc.statusTotal += 1;
        if (r.status === 'Aberto') acc.statusAberto += 1;
        acc.cotaAberta += Number(r.cotaAberta) || 0;
        acc.cotaUsada += Number(r.cotaUsada) || 0;
      });
      return mapa;
    };

    // bucket -> age -> [{ rotulo: <janela>, status, cotaAberta }] com o status e a
    // Cota Aberta de CADA janela que entrou na soma daquele bucket+dia -- alimenta
    // o popover de detalhe ao passar o mouse num "n/total" (Parcial) na tabela.
    // `labels` traduz o TIME_SLOT cru do arquivo ("08:30-10:30") pro rótulo bonito
    // da tela ("08:30 - 10:30"), igual ao resto da rota.
    const montarMapaDetalheJanela = (linhas, labels, chaveFiltro) => {
      const rotuloPorChave = Object.fromEntries(labels.map(l => [chaveJanela(l), l]));
      const mapa = {};
      linhas.forEach(r => {
        const chave = chaveJanela(r.timeSlot);
        if (chaveFiltro && chave !== chaveFiltro) return;
        const porBucket = mapa[r.bucket] || (mapa[r.bucket] = {});
        const porAge = porBucket[r.age] || (porBucket[r.age] = []);
        porAge.push({ rotulo: rotuloPorChave[chave] || r.timeSlot, status: r.status, cotaAberta: Number(r.cotaAberta) || 0 });
      });
      return mapa;
    };

    // Monta as opções de botão "Todas as janelas" + uma por janela do tipo, cada
    // uma um link que recarrega a página só trocando o parâmetro daquele tipo
    // (preserva os filtros de tecnologia/status dos outros painéis e a janela
    // escolhida nos OUTROS 3 tipos).
    const paramsComEstadoEJanelas = () => {
      const params = new URLSearchParams(montarQueryStringEstado(req.query).toString());
      if (janelaInstalacaoSel) params.set('janelaInstalacao', String(janelaInstalacaoSel.indice));
      if (janelaServicoSel) params.set('janelaServico', String(janelaServicoSel.indice));
      if (janelaMeSel) params.set('janelaMe', String(janelaMeSel.indice));
      if (janelaReparoSel) params.set('janelaReparo', String(janelaReparoSel.indice));
      return params;
    };
    const construirOpcoesJanela = (paramTipo, labels, selecionado) => {
      const base = paramsComEstadoEJanelas();
      const linkSemParam = () => {
        const p = new URLSearchParams(base);
        p.delete(paramTipo);
        return `/projecao-d1-d7?${p.toString()}`;
      };
      const opcaoTodas = { rotulo: 'Todas as janelas', ativo: !selecionado, href: linkSemParam() };
      const opcoesJanela = labels.map((label, i) => {
        const p = new URLSearchParams(base);
        p.set(paramTipo, String(i));
        return { rotulo: label, ativo: !!selecionado && selecionado.indice === i, href: `/projecao-d1-d7?${p.toString()}` };
      });
      return [opcaoTodas, ...opcoesJanela];
    };

    const [cotasInstalacao, cotasServico, cotasMe, cotasReparo] = await Promise.all([
      getCotasD1aD7('instalacao'),
      getCotasD1aD7('servico'),
      getCotasD1aD7('me'),
      getCotasD1aD7('reparo'),
    ]);

    const datasCargaBrutas = await getDatasCargaCotas();
    const datasCargaCotas = {};
    Object.entries(datasCargaBrutas).forEach(([tipo, data]) => {
      datasCargaCotas[tipo] = data ? formatarDataCarga(data) : null;
    });
    // Dias desde a última carga por tipo -- Status/Cota Aberta já vêm ajustados
    // pelo atraso (ver ageEfetivo em cotasService.js), mas a tela avisa isso pra
    // não passar a impressão de que a base está em dia quando não está.
    const diasAtrasoCotas = await getDiasAtrasoCotas();

    res.render('projecao-d1-d7', {
      paginaAtual: 'projecao-d1-d7',
      linkVoltar,
      linkResumoCotas,
      linkConfiguracoes,
      linkCotasPlanejadas,
      linkProjecaoD1D7,
      dias,
      linhasInstalacoes: dados.linhasInstalacoes,
      aliadaCoresInstalacoes: dados.aliadaCoresInstalacoes,
      mapaCotasInstalacao: montarMapaCotasPorDia(cotasInstalacao, janelaInstalacaoSel && janelaInstalacaoSel.chave),
      mapaDetalheInstalacao: montarMapaDetalheJanela(cotasInstalacao, dados.janelasInstalacaoLabels, janelaInstalacaoSel && janelaInstalacaoSel.chave),
      opcoesJanelaInstalacao: construirOpcoesJanela('janelaInstalacao', dados.janelasInstalacaoLabels, janelaInstalacaoSel),
      linhasServicos: dados.linhasServicos,
      aliadaCoresServicos: dados.aliadaCoresServicos,
      mapaCotasServico: montarMapaCotasPorDia(cotasServico, janelaServicoSel && janelaServicoSel.chave),
      mapaDetalheServico: montarMapaDetalheJanela(cotasServico, dados.janelasServicoLabels, janelaServicoSel && janelaServicoSel.chave),
      opcoesJanelaServico: construirOpcoesJanela('janelaServico', dados.janelasServicoLabels, janelaServicoSel),
      linhasMe: dados.linhasMe,
      aliadaCoresMe: dados.aliadaCoresMe,
      mapaCotasMe: montarMapaCotasPorDia(cotasMe, janelaMeSel && janelaMeSel.chave),
      mapaDetalheMe: montarMapaDetalheJanela(cotasMe, dados.janelasMeLabels, janelaMeSel && janelaMeSel.chave),
      opcoesJanelaMe: construirOpcoesJanela('janelaMe', dados.janelasMeLabels, janelaMeSel),
      linhasReparos: dados.linhas,
      aliadaCoresReparos: dados.aliadaCores,
      mapaCotasReparo: montarMapaCotasPorDia(cotasReparo, janelaReparoSel && janelaReparoSel.chave),
      mapaDetalheReparo: montarMapaDetalheJanela(cotasReparo, dados.janelasReparoLabels, janelaReparoSel && janelaReparoSel.chave),
      opcoesJanelaReparo: construirOpcoesJanela('janelaReparo', dados.janelasReparoLabels, janelaReparoSel),
      datasCargaCotas,
      diasAtrasoCotas,
      aliadasDisponiveis: dados.aliadasDisponiveis,
      aliadasSelecionadas: dados.aliadasSelecionadas,
      pathAtual: req.path,
      queryAtual: req.query,
    });
  } catch (err) {
    next(err);
  }
});

// Upload manual do Excel de cotas do ELOS (data (*).xlsx) por tipo (instalacao/
// servico/me/reparo) -> tabela própria daquele tipo (banco cotas, não compartilhada),
// TRUNCATE + INSERT substitui tudo. Um botão por tipo na página.
router.post('/cotas/upload/:tipo', upload.single('arquivo'), async (req, res, next) => {
  const tipo = req.params.tipo;
  try {
    if (!TIPOS_COTAS.includes(tipo)) {
      return res.redirect('/cotas-planejadas?cotasUpload=erro&cotasUploadErro=' + encodeURIComponent('Tipo de cotas inválido.'));
    }
    if (!req.file) {
      return res.redirect(`/cotas-planejadas?cotasUpload=erro&cotasUploadTipo=${tipo}&cotasUploadErro=` + encodeURIComponent('Nenhum arquivo selecionado.'));
    }

    const { totalLinhas } = await importarCotas(req.file.buffer, tipo);

    res.redirect(`/cotas-planejadas?cotasUpload=ok&cotasUploadTipo=${tipo}&cotasUploadLinhas=${totalLinhas}`);
  } catch (err) {
    res.redirect(`/cotas-planejadas?cotasUpload=erro&cotasUploadTipo=${tipo}&cotasUploadErro=` + encodeURIComponent(err.message));
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

// Edição rápida de 1 só campo (Previsto % ou Carga), pelos botões "Previsto (X%)"
// e "Sugestão" no cabeçalho da tabela da home -- evita ter que abrir
// Configurações só pra mudar um desses dois. `campo` escolhe o mapa/normalizador
// certo (Previsto é percentual 0-100, Carga é uma quantidade livre >= 0).
// Reaproveita salvarConfiguracoesGerais (upsert por chave), então não mexe nos
// outros campos de configuracoes_gerais.
router.post('/config/rapido', async (req, res, next) => {
  try {
    const grupo = CONFIG_RAPIDO_POR_CAMPO[req.body.campo];
    const cfg = grupo && grupo.mapa[req.body.tipo];
    if (!cfg) return res.redirect('/');

    const valor = grupo.normalizar(req.body.valor, cfg.padrao);
    await salvarConfiguracoesGerais({ [cfg.chave]: valor });

    res.redirect(`/?${montarQueryStringEstado(req.body).toString()}`);
  } catch (err) {
    next(err);
  }
});

// Edição rápida das % de janela de 1 seção por vez, pelo botão "ORDENS" no
// cabeçalho da tabela da home. O modal só manda as janelas EDITÁVEIS daquela
// seção (ex.: percentualJanela1Instalacao/2/3, nunca a 4ª) -- grava só as
// chaves que vieram no body, ignorando as outras 7 de JANELA_CAMPOS_PADRAO
// (não precisa de `tipo` pra saber quais são: os nomes dos campos já dizem).
router.post('/config/janelas', async (req, res, next) => {
  try {
    const valores = {};
    Object.keys(JANELA_CAMPOS_PADRAO).forEach((campo) => {
      if (req.body[campo] !== undefined) {
        valores[campo] = normalizarPercentual(req.body[campo], JANELA_CAMPOS_PADRAO[campo]);
      }
    });

    if (Object.keys(valores).length > 0) {
      await salvarConfiguracoesGerais(valores);
    }

    res.redirect(`/?${montarQueryStringEstado(req.body).toString()}`);
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

// Salva o planejamento atual no histórico manualmente (mesma lógica do cron das 9h).
// Sempre sobrescreve o snapshot de hoje (ON DUPLICATE KEY UPDATE no snapshotService),
// então pode ser chamado mais de uma vez no mesmo dia sem duplicar.
// Resposta JSON porque é chamado via fetch pelo botão "Salvar planejamento".
router.post('/api/snapshot-manual', async (req, res, next) => {
  try {
    const { salvarSnapshot } = require('../services/snapshotService');
    const dados = await carregarDadosPainel({});
    await salvarSnapshot(dados, new Date());
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.carregarDadosPainel = carregarDadosPainel;
