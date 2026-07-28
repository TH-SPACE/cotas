const express = require('express');
const multer = require('multer');
const {
  getResumoBuckets,
  getOrdensBacklog,
  getTecnologiasDisponiveis,
  TECNOLOGIA_PADRAO,
  getFiltrosDisponiveisReparo,
  getDataCargaReparo,
  STATUS_EXCLUIDOS_PADRAO: STATUS_EXCLUIDOS_PADRAO_REPARO,
  STATUS_REASON_INCLUIDOS_PADRAO: STATUS_REASON_INCLUIDOS_PADRAO_REPARO,
} = require('../services/bucketService');
const {
  getResumoBucketsInstalacoes,
  getOrdensBacklogInstalacoes,
  getFiltrosDisponiveisInstalacoes,
  getPuProdutos,
  atualizarPuProdutos,
  STATUS_EXCLUIDOS_PADRAO: STATUS_EXCLUIDOS_PADRAO_INSTALACAO,
  STATUS_REASON_INCLUIDOS_PADRAO: STATUS_REASON_INCLUIDOS_PADRAO_INSTALACAO,
  TECNOLOGIA_ACESSO_PADRAO,
} = require('../services/instalacaoBucketService');
const {
  getResumoBucketsServicos,
  getOrdensBacklogServicos,
  getFiltrosDisponiveisServicos,
  getPuProdutosServicos,
  atualizarPuProdutosServicos,
  STATUS_EXCLUIDOS_PADRAO: STATUS_EXCLUIDOS_PADRAO_SERVICO,
  STATUS_REASON_INCLUIDOS_PADRAO: STATUS_REASON_INCLUIDOS_PADRAO_SERVICO,
  TECNOLOGIA_ACESSO_PADRAO: TECNOLOGIA_ACESSO_PADRAO_SERVICO,
} = require('../services/servicoBucketService');
const {
  getResumoBucketsMe,
  getOrdensBacklogMe,
  getFiltrosDisponiveisMe,
  getPuProdutosMe,
  atualizarPuProdutosMe,
  STATUS_EXCLUIDOS_PADRAO: STATUS_EXCLUIDOS_PADRAO_ME,
  STATUS_REASON_INCLUIDOS_PADRAO: STATUS_REASON_INCLUIDOS_PADRAO_ME,
  TECNOLOGIA_ACESSO_PADRAO: TECNOLOGIA_ACESSO_PADRAO_ME,
} = require('../services/meBucketService');
const { importarInstalacoes, getDataCargaInstalacoes } = require('../services/instalacoesService');
const { paraCsv } = require('../services/csvUtils');
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
  calcularSecaoPorAliadaRegiao,
  construirMapaCoresAliada,
} = require('../services/calculoBacklogService');
const { getConfiguracoesGerais, salvarConfiguracoesGerais } = require('../services/configGeralService');
const { getConfiguracoesAliada, salvarConfiguracaoAliada, limparConfiguracaoAliada } = require('../services/configAliadaService');
const {
  getConfiguracoesAliadaRegiao,
  salvarConfiguracaoAliadaRegiao,
  limparConfiguracaoAliadaRegiao,
} = require('../services/configAliadaRegiaoService');
const {
  getBucketsClassificaveis,
  getBucketRegiao,
  regiaoDoBucket,
  salvarBucketRegiao,
} = require('../services/bucketRegiaoService');
const { getElosCredenciais, salvarElosCredenciais } = require('../services/elosCredenciaisService');
const { getStatusRaspagem, solicitarExecucaoManual } = require('../services/raspagemStatusService');
const { memoTTL } = require('../services/cacheUtil');

// As OPÇÕES de filtro (status/statusReason/tecnologia) varrem backlog_instalacoes/
// backlog_elos (colunas TEXT, sem índice) e só mudam quando um novo backlog é
// carregado -- cacheadas por 15s pra não pagar ~60ms de DISTINCT em TODA página.
// Os NÚMEROS (getResumoBuckets*) continuam sempre frescos, sem cache. Staleness de
// até 15s numa lista de checkbox de filtro é irrelevante.
const FILTROS_TTL_MS = 15000;
const getFiltrosReparoCache = memoTTL(getFiltrosDisponiveisReparo, FILTROS_TTL_MS);
const getFiltrosInstalacoesCache = memoTTL(getFiltrosDisponiveisInstalacoes, FILTROS_TTL_MS);
const getFiltrosServicosCache = memoTTL(getFiltrosDisponiveisServicos, FILTROS_TTL_MS);
const getFiltrosMeCache = memoTTL(getFiltrosDisponiveisMe, FILTROS_TTL_MS);

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

// `formEnviado` diferencia "usuário nunca tocou nesse filtro" (undefined, cai no
// padrão) de "usuário desmarcou tudo de propósito" (form foi submetido, mas
// checkbox desmarcado não viaja na query string -- sem essa flag, os dois casos
// seriam indistinguíveis e o filtro voltaria sozinho pro padrão).
function normalizarTecnologias(valor, formEnviado) {
  const lista = [].concat(valor || []).filter(Boolean);
  if (lista.length > 0) return lista;
  return formEnviado ? [] : TECNOLOGIA_PADRAO;
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
// `formEnviado` tem o mesmo papel de normalizarTecnologias: sem ela, desmarcar
// todos os checkboxes de um grupo (nenhum viaja na query) é indistinguível de
// nunca ter tocado no filtro, e o grupo "ressuscitava" sozinho no padrão.
function normalizarListaComPadrao(valor, padrao, formEnviado) {
  if (valor !== undefined) return [].concat(valor);
  return formEnviado ? [] : padrao;
}

// Reconstrói a query string de estado (só os FILTROS dos quatro painéis) para os
// redirects de POST /config/*, que não mexem no valor enviado, só no que originou o
// post. Previsto/Janelas/Meta de PU/Carga não entram mais aqui -- persistem em
// configuracoes_gerais (ver configGeralService.js), não na URL.
function montarQueryStringEstado(body) {
  const params = new URLSearchParams();
  [].concat(body.aliada || []).forEach(v => params.append('aliada', v));
  if (body.formReparoEnviado !== undefined) params.append('formReparoEnviado', '1');
  if (body.formInstalacaoEnviado !== undefined) params.append('formInstalacaoEnviado', '1');
  if (body.formServicoEnviado !== undefined) params.append('formServicoEnviado', '1');
  if (body.formMeEnviado !== undefined) params.append('formMeEnviado', '1');
  normalizarTecnologias(body.tecnologia, body.formReparoEnviado !== undefined).forEach(t => params.append('tecnologia', t));
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
  const [configGeral, configAliada, configAliadaRegiao, bucketRegiaoMap, bucketsClassificaveis] = await Promise.all([
    getConfiguracoesGerais(),
    getConfiguracoesAliada(),
    getConfiguracoesAliadaRegiao(),
    getBucketRegiao(),
    getBucketsClassificaveis(),
  ]);

  // Resolve um campo em camadas: override da aliada -> global -> default de
  // código. É o coração da config por aliada -- cada aliada trabalha diferente,
  // então o mesmo campo pode ter valor próprio por aliada; quem não tem override
  // herda o global (comportamento de antes desta feature). `normalizar` valida
  // (percentual 0-100, carga/pu >= 0, meta > 0).
  const resolverAliada = (aliada, chave, normalizar, padrao) => {
    const override = configAliada[aliada];
    const bruto = (override && override[chave] !== undefined) ? override[chave] : configGeral[chave];
    return normalizar(bruto, padrao);
  };
  // true quando a aliada tem valor PRÓPRIO para o campo (não está herdando o
  // global) -- a faixa da home usa isso pra marcar "próprio" vs "herda padrão".
  const temOverride = (aliada, chave) => !!(configAliada[aliada] && configAliada[aliada][chave] !== undefined);

  // Camada MAIS específica, por cima da de aliada: override de (aliada,região)
  // -> override da aliada inteira -> global -> default. Existe pra dar
  // Previsto/Carga/%janela/Meta de PU diferente entre os buckets do interior e
  // os da capital de uma mesma aliada (ver configAliadaRegiaoService.js /
  // bucketRegiaoService.js). Os overrides de aliada já configurados continuam
  // valendo como camada intermediária -- nada se perde.
  const resolverAliadaRegiao = (aliada, regiao, chave, normalizar, padrao) => {
    const overrideRegiao = configAliadaRegiao[aliada] && configAliadaRegiao[aliada][regiao];
    if (overrideRegiao && overrideRegiao[chave] !== undefined) return normalizar(overrideRegiao[chave], padrao);
    return resolverAliada(aliada, chave, normalizar, padrao);
  };
  // true só quando essa (aliada,região) EXATA tem valor próprio -- diferente de
  // "herda da aliada" ou "herda do global", que contam como herdado pra badge.
  const temOverrideRegiao = (aliada, regiao, chave) => {
    const overrideRegiao = configAliadaRegiao[aliada] && configAliadaRegiao[aliada][regiao];
    return !!(overrideRegiao && overrideRegiao[chave] !== undefined);
  };

  // Config efetiva por aliada de uma seção, no formato que a faixa de edição da
  // home consome (1 objeto por aliada, com o valor resolvido + se é override).
  // `janelas` são as chaves das janelas EDITÁVEIS da seção (1 em Reparos, 3 nos
  // outros); a última janela nunca é editável (é sempre o restante).
  const construirConfigPorAliada = (aliadas, spec) => {
    const mapa = {};
    aliadas.forEach(aliada => {
      mapa[aliada] = {
        percentual: resolverAliada(aliada, spec.percentualChave, normalizarPercentual, spec.percentualPadrao),
        overridePercentual: temOverride(aliada, spec.percentualChave),
        carga: resolverAliada(aliada, spec.cargaChave, normalizarPu, spec.cargaPadrao),
        overrideCarga: temOverride(aliada, spec.cargaChave),
        metaPu: resolverAliada(aliada, spec.metaChave, normalizarMetaPuTecnico, spec.metaPadrao),
        overrideMetaPu: temOverride(aliada, spec.metaChave),
        janelasEditaveis: spec.janelas.map(j => ({ nome: j.nome, valor: resolverAliada(aliada, j.nome, normalizarPercentual, j.padrao) })),
        overrideJanelas: spec.janelas.some(j => temOverride(aliada, j.nome)),
      };
    });
    return mapa;
  };

  // Extrai os pares (aliada,região) realmente presentes nas linhas JÁ filtradas
  // de uma seção (não um produto cartesiano) -- preserva a ordem de aparição.
  const paresAliadaRegiao = (linhasSecao) => {
    const vistos = new Set();
    const pares = [];
    linhasSecao.forEach(l => {
      const chave = `${l.aliada}::${l.regiao}`;
      if (!vistos.has(chave)) { vistos.add(chave); pares.push({ aliada: l.aliada, regiao: l.regiao }); }
    });
    return pares;
  };

  // Config efetiva por (aliada,região) de uma seção -- mapa ANINHADO
  // {aliada: {regiao: {...}}}. A view usa `Object.keys(mapa[aliada]).length > 1`
  // pra saber se aquela aliada tem split (mostra "— Capital"/"— Interior") ou
  // continua com 1 faixa só (rótulo genérico, comportamento de antes).
  const construirConfigPorAliadaRegiao = (pares, spec) => {
    const mapa = {};
    pares.forEach(({ aliada, regiao }) => {
      const porAliada = mapa[aliada] || (mapa[aliada] = {});
      porAliada[regiao] = {
        percentual: resolverAliadaRegiao(aliada, regiao, spec.percentualChave, normalizarPercentual, spec.percentualPadrao),
        overridePercentual: temOverrideRegiao(aliada, regiao, spec.percentualChave),
        carga: resolverAliadaRegiao(aliada, regiao, spec.cargaChave, normalizarPu, spec.cargaPadrao),
        overrideCarga: temOverrideRegiao(aliada, regiao, spec.cargaChave),
        metaPu: resolverAliadaRegiao(aliada, regiao, spec.metaChave, normalizarMetaPuTecnico, spec.metaPadrao),
        overrideMetaPu: temOverrideRegiao(aliada, regiao, spec.metaChave),
        janelasEditaveis: spec.janelas.map(j => ({ nome: j.nome, valor: resolverAliadaRegiao(aliada, regiao, j.nome, normalizarPercentual, j.padrao) })),
        overrideJanelas: spec.janelas.some(j => temOverrideRegiao(aliada, regiao, j.nome)),
      };
    });
    return mapa;
  };

  const percentual = normalizarPercentual(configGeral.percentual, PERCENTUAL_PADRAO);
  const percentualJanela = normalizarPercentual(configGeral.percentualJanela, PERCENTUAL_JANELA_PADRAO);
  const puReparo = normalizarPu(configGeral.puReparo, PU_REPARO_PADRAO);
  const metaPuTecnico = normalizarMetaPuTecnico(configGeral.metaPuTecnico, META_PU_TECNICO_PADRAO);
  const cargaReparo = normalizarPu(configGeral.cargaReparo, CARGA_REPARO_PADRAO);

  // Marcadores de "esse form de filtro foi submetido" (ver normalizarListaComPadrao)
  // -- precisam ser lidos antes de resolver qualquer filtro dos 4 painéis.
  const formReparoEnviado = query.formReparoEnviado !== undefined;
  const formInstalacaoEnviado = query.formInstalacaoEnviado !== undefined;
  const formServicoEnviado = query.formServicoEnviado !== undefined;
  const formMeEnviado = query.formMeEnviado !== undefined;

  const tecnologiasSelecionadas = normalizarTecnologias(query.tecnologia, formReparoEnviado);

  // Os 4 conjuntos de filtros disponíveis (status/statusReason/tecnologia por
  // seção) são independentes entre si -> buscados em PARALELO num único lote, em
  // vez de 4 esperas em série antes do lote principal. Cada um só depende do que
  // existe hoje na base daquela seção (backlog_elos / backlog_instalacoes).
  const [
    filtrosDisponiveisReparo,
    filtrosDisponiveisInstalacoes,
    filtrosDisponiveisServicos,
    filtrosDisponiveisMe,
  ] = await Promise.all([
    getFiltrosReparoCache(),
    getFiltrosInstalacoesCache(),
    getFiltrosServicosCache(),
    getFiltrosMeCache(),
  ]);

  const statusReparoSelecionados = normalizarListaComPadrao(
    query.statusReparo,
    filtrosDisponiveisReparo.status.filter(v => !STATUS_EXCLUIDOS_PADRAO_REPARO.includes(v)),
    formReparoEnviado
  );
  const statusReasonReparoSelecionados = normalizarListaComPadrao(
    query.statusReasonReparo,
    filtrosDisponiveisReparo.statusReason.filter(v => STATUS_REASON_INCLUIDOS_PADRAO_REPARO.includes(v)),
    formReparoEnviado
  );

  const percentualInstalacao = normalizarPercentual(configGeral.percentualInstalacao, PERCENTUAL_INSTALACAO_PADRAO);
  const percentualJanela1Instalacao = normalizarPercentual(configGeral.percentualJanela1Instalacao, PERCENTUAL_JANELA1_INSTALACAO_PADRAO);
  const percentualJanela2Instalacao = normalizarPercentual(configGeral.percentualJanela2Instalacao, PERCENTUAL_JANELA2_INSTALACAO_PADRAO);
  const percentualJanela3Instalacao = normalizarPercentual(configGeral.percentualJanela3Instalacao, PERCENTUAL_JANELA3_INSTALACAO_PADRAO);
  const metaPuTecnicoInstalacao = normalizarMetaPuTecnico(configGeral.metaPuTecnicoInstalacao, META_PU_TECNICO_INSTALACAO_PADRAO);
  const cargaInstalacao = normalizarPu(configGeral.cargaInstalacao, CARGA_INSTALACAO_PADRAO);

  const statusInstalacaoSelecionados = normalizarListaComPadrao(
    query.statusInstalacao,
    filtrosDisponiveisInstalacoes.status.filter(v => !STATUS_EXCLUIDOS_PADRAO_INSTALACAO.includes(v)),
    formInstalacaoEnviado
  );
  const statusReasonInstalacaoSelecionados = normalizarListaComPadrao(
    query.statusReasonInstalacao,
    filtrosDisponiveisInstalacoes.statusReason.filter(v => STATUS_REASON_INCLUIDOS_PADRAO_INSTALACAO.includes(v)),
    formInstalacaoEnviado
  );
  const tecnologiaAcessoSelecionadas = normalizarListaComPadrao(query.tecnologiaAcesso, TECNOLOGIA_ACESSO_PADRAO, formInstalacaoEnviado);

  const percentualServico = normalizarPercentual(configGeral.percentualServico, PERCENTUAL_SERVICO_PADRAO);
  const percentualJanela1Servico = normalizarPercentual(configGeral.percentualJanela1Servico, PERCENTUAL_JANELA1_SERVICO_PADRAO);
  const percentualJanela2Servico = normalizarPercentual(configGeral.percentualJanela2Servico, PERCENTUAL_JANELA2_SERVICO_PADRAO);
  const percentualJanela3Servico = normalizarPercentual(configGeral.percentualJanela3Servico, PERCENTUAL_JANELA3_SERVICO_PADRAO);
  const metaPuTecnicoServico = normalizarMetaPuTecnico(configGeral.metaPuTecnicoServico, META_PU_TECNICO_SERVICO_PADRAO);
  const cargaServico = normalizarPu(configGeral.cargaServico, CARGA_SERVICO_PADRAO);

  const statusServicoSelecionados = normalizarListaComPadrao(
    query.statusServico,
    filtrosDisponiveisServicos.status.filter(v => !STATUS_EXCLUIDOS_PADRAO_SERVICO.includes(v)),
    formServicoEnviado
  );
  const statusReasonServicoSelecionados = normalizarListaComPadrao(
    query.statusReasonServico,
    filtrosDisponiveisServicos.statusReason.filter(v => STATUS_REASON_INCLUIDOS_PADRAO_SERVICO.includes(v)),
    formServicoEnviado
  );
  const tecnologiaAcessoServicoSelecionadas = normalizarListaComPadrao(query.tecnologiaAcessoServico, TECNOLOGIA_ACESSO_PADRAO_SERVICO, formServicoEnviado);

  const percentualMe = normalizarPercentual(configGeral.percentualMe, PERCENTUAL_ME_PADRAO);
  const percentualJanela1Me = normalizarPercentual(configGeral.percentualJanela1Me, PERCENTUAL_JANELA1_ME_PADRAO);
  const percentualJanela2Me = normalizarPercentual(configGeral.percentualJanela2Me, PERCENTUAL_JANELA2_ME_PADRAO);
  const percentualJanela3Me = normalizarPercentual(configGeral.percentualJanela3Me, PERCENTUAL_JANELA3_ME_PADRAO);
  const metaPuTecnicoMe = normalizarMetaPuTecnico(configGeral.metaPuTecnicoMe, META_PU_TECNICO_ME_PADRAO);
  const cargaMe = normalizarPu(configGeral.cargaMe, CARGA_ME_PADRAO);

  const statusMeSelecionados = normalizarListaComPadrao(
    query.statusMe,
    filtrosDisponiveisMe.status.filter(v => !STATUS_EXCLUIDOS_PADRAO_ME.includes(v)),
    formMeEnviado
  );
  const statusReasonMeSelecionados = normalizarListaComPadrao(
    query.statusReasonMe,
    filtrosDisponiveisMe.statusReason.filter(v => STATUS_REASON_INCLUIDOS_PADRAO_ME.includes(v)),
    formMeEnviado
  );
  const tecnologiaAcessoMeSelecionadas = normalizarListaComPadrao(query.tecnologiaAcessoMe, TECNOLOGIA_ACESSO_PADRAO_ME, formMeEnviado);

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

  // Atribui a região (CAPITAL/INTERIOR) de cada bucket (ver bucketRegiaoService.js;
  // sem classificação = INTERIOR) e reordena por (aliada, região, bucket) -- os
  // buckets de cada (aliada,região) precisam ficar CONTÍGUOS pra faixa de
  // configuração da home e o cálculo por grupo funcionarem; `ORDER BY aliada,
  // bucket` do SQL não garante isso sozinho (ex.: em ONDACOM, BKT_APARECIDA_GOIANIA
  // vem alfabeticamente antes de BKT_GOIANIA_ONDACOM, que normalmente é a capital).
  const aplicarRegiao = (linhasSecao) => {
    linhasSecao.forEach(l => { l.regiao = regiaoDoBucket(l.bucket, bucketRegiaoMap); });
    linhasSecao.sort((a, b) =>
      a.aliada.localeCompare(b.aliada) || a.regiao.localeCompare(b.regiao) || a.bucket.localeCompare(b.bucket)
    );
    return linhasSecao;
  };
  aplicarRegiao(linhas);
  aplicarRegiao(linhasInstalacoes);
  aplicarRegiao(linhasServicos);
  aplicarRegiao(linhasMe);

  // Config efetiva por (aliada,região) de cada seção (para a faixa de edição da
  // home). As MESMAS chaves de configuracoes_gerais, resolvidas em camadas.
  const configPorAliadaReparos = construirConfigPorAliadaRegiao(paresAliadaRegiao(linhas), {
    percentualChave: 'percentual', percentualPadrao: PERCENTUAL_PADRAO,
    cargaChave: 'cargaReparo', cargaPadrao: CARGA_REPARO_PADRAO,
    metaChave: 'metaPuTecnico', metaPadrao: META_PU_TECNICO_PADRAO,
    janelas: [{ nome: 'percentualJanela', padrao: PERCENTUAL_JANELA_PADRAO }],
  });
  const configPorAliadaInstalacoes = construirConfigPorAliadaRegiao(paresAliadaRegiao(linhasInstalacoes), {
    percentualChave: 'percentualInstalacao', percentualPadrao: PERCENTUAL_INSTALACAO_PADRAO,
    cargaChave: 'cargaInstalacao', cargaPadrao: CARGA_INSTALACAO_PADRAO,
    metaChave: 'metaPuTecnicoInstalacao', metaPadrao: META_PU_TECNICO_INSTALACAO_PADRAO,
    janelas: [
      { nome: 'percentualJanela1Instalacao', padrao: PERCENTUAL_JANELA1_INSTALACAO_PADRAO },
      { nome: 'percentualJanela2Instalacao', padrao: PERCENTUAL_JANELA2_INSTALACAO_PADRAO },
      { nome: 'percentualJanela3Instalacao', padrao: PERCENTUAL_JANELA3_INSTALACAO_PADRAO },
    ],
  });
  const configPorAliadaServicos = construirConfigPorAliadaRegiao(paresAliadaRegiao(linhasServicos), {
    percentualChave: 'percentualServico', percentualPadrao: PERCENTUAL_SERVICO_PADRAO,
    cargaChave: 'cargaServico', cargaPadrao: CARGA_SERVICO_PADRAO,
    metaChave: 'metaPuTecnicoServico', metaPadrao: META_PU_TECNICO_SERVICO_PADRAO,
    janelas: [
      { nome: 'percentualJanela1Servico', padrao: PERCENTUAL_JANELA1_SERVICO_PADRAO },
      { nome: 'percentualJanela2Servico', padrao: PERCENTUAL_JANELA2_SERVICO_PADRAO },
      { nome: 'percentualJanela3Servico', padrao: PERCENTUAL_JANELA3_SERVICO_PADRAO },
    ],
  });
  const configPorAliadaMe = construirConfigPorAliadaRegiao(paresAliadaRegiao(linhasMe), {
    percentualChave: 'percentualMe', percentualPadrao: PERCENTUAL_ME_PADRAO,
    cargaChave: 'cargaMe', cargaPadrao: CARGA_ME_PADRAO,
    metaChave: 'metaPuTecnicoMe', metaPadrao: META_PU_TECNICO_ME_PADRAO,
    janelas: [
      { nome: 'percentualJanela1Me', padrao: PERCENTUAL_JANELA1_ME_PADRAO },
      { nome: 'percentualJanela2Me', padrao: PERCENTUAL_JANELA2_ME_PADRAO },
      { nome: 'percentualJanela3Me', padrao: PERCENTUAL_JANELA3_ME_PADRAO },
    ],
  });

  // Adaptador: config por (aliada,região) -> shape que o orquestrador de cálculo
  // espera. `chaveGrupo` = "ALIADA::REGIAO" (ver calcularSecaoPorAliadaRegiao).
  // Reparos tem `pu` (peso fixo, continua só por aliada -- não faz parte do
  // pedido de split por região); os outros usam campoPuBruto (peso por
  // Specification Product, independente de aliada/região).
  const configDeReparo = (chaveGrupo) => {
    const [aliada, regiao] = chaveGrupo.split('::');
    const c = configPorAliadaReparos[aliada][regiao];
    return { percentual: c.percentual, carga: c.carga, metaPuTecnico: c.metaPu,
      percentuaisJanela: c.janelasEditaveis.map(j => j.valor),
      pu: resolverAliada(aliada, 'puReparo', normalizarPu, PU_REPARO_PADRAO) };
  };
  const configDeSecao = (mapa) => (chaveGrupo) => {
    const [aliada, regiao] = chaveGrupo.split('::');
    const c = mapa[aliada][regiao];
    return { percentual: c.percentual, carga: c.carga, metaPuTecnico: c.metaPu,
      percentuaisJanela: c.janelasEditaveis.map(j => j.valor) };
  };

  const { linhas: linhasComPrevisto, totais } = calcularSecaoPorAliadaRegiao(linhas, {
    campoBacklog: 'backlogReparos', campoTempo: 'tempoReparoMinutos',
    numJanelas: JANELAS_REPARO.length, configDe: configDeReparo,
  });

  const { linhas: linhasInstalacoesComPrevisto, totais: totaisInstalacoes } = calcularSecaoPorAliadaRegiao(linhasInstalacoes, {
    campoBacklog: 'backlogInstalacoes', campoTempo: 'tempoInstalacaoMinutos', campoPuBruto: 'puBrutoTotal',
    numJanelas: JANELAS_INSTALACAO.length, configDe: configDeSecao(configPorAliadaInstalacoes),
  });
  const totalSugestaoInstalacoes = totaisInstalacoes.totalSugestao;

  const { linhas: linhasServicosComPrevisto, totais: totaisServicos } = calcularSecaoPorAliadaRegiao(linhasServicos, {
    campoBacklog: 'backlogServicos', campoTempo: 'tempoServicoMinutos', campoPuBruto: 'puBrutoTotal',
    numJanelas: JANELAS_SERVICO.length, configDe: configDeSecao(configPorAliadaServicos),
  });
  const totalSugestaoServicos = totaisServicos.totalSugestao;

  const { linhas: linhasMeComPrevisto, totais: totaisMe } = calcularSecaoPorAliadaRegiao(linhasMe, {
    campoBacklog: 'backlogMe', campoTempo: 'tempoMeMinutos', campoPuBruto: 'puBrutoTotal',
    numJanelas: JANELAS_ME.length, configDe: configDeSecao(configPorAliadaMe),
  });
  const totalSugestaoMe = totaisMe.totalSugestao;

  // Enriquece o mapa de config por (aliada,região) com o exemplo REAL daquele
  // grupo (usado na fórmula dentro dos modais de Carga/Meta): Previsto total DO
  // GRUPO (denominador da Sugestão, já que a Carga é redistribuída dentro do
  // grupo) + o 1º bucket dele.
  const enriquecerExemplos = (mapa, linhasCalc) => {
    const agg = {};
    linhasCalc.forEach(l => {
      const chave = `${l.aliada}::${l.regiao}`;
      const a = agg[chave] || (agg[chave] = {
        totalPrevisto: 0, primeiroBucket: l.bucket, primeiroPrevisto: l.previstoResolucao, primeiroPu: l.pu,
      });
      a.totalPrevisto += l.previstoResolucao;
    });
    Object.keys(mapa).forEach(aliada => {
      Object.keys(mapa[aliada]).forEach(regiao => {
        const a = agg[`${aliada}::${regiao}`];
        mapa[aliada][regiao].exemploTotal = a ? a.totalPrevisto : 0;
        mapa[aliada][regiao].exemploNome = a ? a.primeiroBucket : '';
        mapa[aliada][regiao].exemploPrevisto = a ? a.primeiroPrevisto : 0;
        mapa[aliada][regiao].exemploPu = a ? a.primeiroPu : 0;
      });
    });
  };
  enriquecerExemplos(configPorAliadaReparos, linhasComPrevisto);
  enriquecerExemplos(configPorAliadaInstalacoes, linhasInstalacoesComPrevisto);
  enriquecerExemplos(configPorAliadaServicos, linhasServicosComPrevisto);
  enriquecerExemplos(configPorAliadaMe, linhasMeComPrevisto);

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
    configPorAliadaReparos,
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
    configPorAliadaInstalacoes,
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
    configPorAliadaServicos,
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
    configPorAliadaMe,
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

    // Região por bucket (CAPITAL/INTERIOR, ver bucketRegiaoService.js) -- tabela
    // admin na página de Configurações. `bucketsClassificaveis` é a lista de
    // buckets "reais" (com armário mapeado; a VIVO/BKT_GOIANIA não entra, é o
    // curinga); `bucketRegiaoMap` é a classificação salva (bucket sem entrada
    // aqui é INTERIOR por padrão).
    bucketsClassificaveis,
    bucketRegiaoMap,
    aliadaCoresBucketsClassificaveis: construirMapaCoresAliada(ALIADA_COR_QTD, bucketsClassificaveis),

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
    const queryEstado = montarQueryStringEstado(req.query).toString();
    const linkExportarReparo = `/backlog/exportar/reparo?${queryEstado}`;
    const linkExportarInstalacao = `/backlog/exportar/instalacao?${queryEstado}`;
    const linkExportarServico = `/backlog/exportar/servico?${queryEstado}`;
    const linkExportarMe = `/backlog/exportar/me?${queryEstado}`;

    res.render('index', {
      ...dados,
      linkResumoCotas,
      linkConfiguracoes,
      linkCotasPlanejadas,
      linkProjecaoD1D7,
      linkExportarReparo,
      linkExportarInstalacao,
      linkExportarServico,
      linkExportarMe,
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
      // Mesmo flash de upload da cotas-planejadas (ver comentário lá) -- desde
      // 2026-07-27 o botão "Upload de cotas" também aparece aqui.
      cotasUpload: req.query.cotasUpload,
      cotasUploadTipo: req.query.cotasUploadTipo,
      cotasUploadLinhas: req.query.cotasUploadLinhas,
      cotasUploadErro: req.query.cotasUploadErro,
      aliadasDisponiveis: dados.aliadasDisponiveis,
      aliadasSelecionadas: dados.aliadasSelecionadas,
      pathAtual: req.path,
      queryAtual: req.query,
    });
  } catch (err) {
    next(err);
  }
});

// O <dialog> de upload de cotas vive tanto em cotas-planejadas quanto (desde
// 2026-07-27) em projecao-d1-d7 -- cada form manda de onde veio em `voltarPara`
// (ver hidden-query-estado.ejs) pra voltar pra mesma página com os mesmos
// filtros em vez de sempre cair em cotas-planejadas. Só aceita as 2 origens
// conhecidas (com ou sem querystring própria) pra não virar open redirect via
// campo de formulário adulterado.
const ORIGENS_UPLOAD_COTAS = ['/cotas-planejadas', '/projecao-d1-d7'];
function origemUploadCotasSegura(voltarPara) {
  const valor = typeof voltarPara === 'string' ? voltarPara : '';
  const base = valor.split('?')[0];
  return ORIGENS_UPLOAD_COTAS.includes(base) ? valor : '/cotas-planejadas';
}
function redirectComFlashCotas(origem, params) {
  const separador = origem.includes('?') ? '&' : '?';
  return origem + separador + new URLSearchParams(params).toString();
}

// Upload manual do Excel de cotas do ELOS (data (*).xlsx) por tipo (instalacao/
// servico/me/reparo) -> tabela própria daquele tipo (banco cotas, não compartilhada),
// TRUNCATE + INSERT substitui tudo. Um botão por tipo na página.
router.post('/cotas/upload/:tipo', upload.single('arquivo'), async (req, res, next) => {
  const tipo = req.params.tipo;
  const origem = origemUploadCotasSegura(req.body && req.body.voltarPara);
  try {
    if (!TIPOS_COTAS.includes(tipo)) {
      return res.redirect(redirectComFlashCotas(origem, { cotasUpload: 'erro', cotasUploadErro: 'Tipo de cotas inválido.' }));
    }
    if (!req.file) {
      return res.redirect(redirectComFlashCotas(origem, { cotasUpload: 'erro', cotasUploadTipo: tipo, cotasUploadErro: 'Nenhum arquivo selecionado.' }));
    }

    const { totalLinhas } = await importarCotas(req.file.buffer, tipo);

    res.redirect(redirectComFlashCotas(origem, { cotasUpload: 'ok', cotasUploadTipo: tipo, cotasUploadLinhas: totalLinhas }));
  } catch (err) {
    res.redirect(redirectComFlashCotas(origem, { cotasUpload: 'erro', cotasUploadTipo: tipo, cotasUploadErro: err.message }));
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

    // `aliadaConfig` (qual aliada editar) é distinto de `aliada` (o filtro global,
    // que viaja no estado via hidden-config-estado) -- sem aliadaConfig, grava o
    // padrão global de sempre. `regiaoConfig` (CAPITAL/INTERIOR) é a camada mais
    // específica: toda faixa visível na home hoje corresponde a um (aliada,região)
    // exato, então quando os dois vêm preenchidos grava/limpa SEMPRE nessa camada
    // (nunca mais a de "aliada inteira", que vira só leitura/fallback a partir daqui).
    const aliada = typeof req.body.aliadaConfig === 'string' && req.body.aliadaConfig.trim()
      ? req.body.aliadaConfig.trim() : null;
    const regiao = typeof req.body.regiaoConfig === 'string' && req.body.regiaoConfig.trim()
      ? req.body.regiaoConfig.trim() : null;

    if (req.body.reset && aliada && regiao) {
      await limparConfiguracaoAliadaRegiao(aliada, regiao, [cfg.chave]); // volta a herdar aliada/global
    } else if (req.body.reset && aliada) {
      await limparConfiguracaoAliada(aliada, [cfg.chave]);
    } else {
      const valor = grupo.normalizar(req.body.valor, cfg.padrao);
      if (aliada && regiao) await salvarConfiguracaoAliadaRegiao(aliada, regiao, { [cfg.chave]: valor });
      else if (aliada) await salvarConfiguracaoAliada(aliada, { [cfg.chave]: valor });
      else await salvarConfiguracoesGerais({ [cfg.chave]: valor });
    }

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
    const aliada = typeof req.body.aliadaConfig === 'string' && req.body.aliadaConfig.trim()
      ? req.body.aliadaConfig.trim() : null;
    const regiao = typeof req.body.regiaoConfig === 'string' && req.body.regiaoConfig.trim()
      ? req.body.regiaoConfig.trim() : null;

    if (req.body.reset && (aliada || regiao)) {
      // Volta a herdar o nível de baixo em todas as janelas editáveis da seção enviadas.
      const chaves = Object.keys(JANELA_CAMPOS_PADRAO).filter(campo => req.body[campo] !== undefined);
      if (chaves.length > 0) {
        if (aliada && regiao) await limparConfiguracaoAliadaRegiao(aliada, regiao, chaves);
        else if (aliada) await limparConfiguracaoAliada(aliada, chaves);
      }
      return res.redirect(`/?${montarQueryStringEstado(req.body).toString()}`);
    }

    const valores = {};
    Object.keys(JANELA_CAMPOS_PADRAO).forEach((campo) => {
      if (req.body[campo] !== undefined) {
        valores[campo] = normalizarPercentual(req.body[campo], JANELA_CAMPOS_PADRAO[campo]);
      }
    });

    if (Object.keys(valores).length > 0) {
      if (aliada && regiao) await salvarConfiguracaoAliadaRegiao(aliada, regiao, valores);
      else if (aliada) await salvarConfiguracaoAliada(aliada, valores);
      else await salvarConfiguracoesGerais(valores);
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

// Classificação CAPITAL/INTERIOR de cada bucket (ver bucketRegiaoService.js) --
// usada pra dar config (Previsto/Carga/Janela/Meta PU) separada por região
// dentro de uma mesma aliada. Bucket sem linha salva aqui continua INTERIOR.
router.post('/config/bucket-regiao', async (req, res, next) => {
  try {
    const buckets = [].concat(req.body.bucket || []);
    const regioes = [].concat(req.body.regiao || []);

    const atualizacoes = buckets
      .map((bucket, i) => ({ bucket, regiao: regioes[i] }))
      .filter(item => item.bucket && (item.regiao === 'CAPITAL' || item.regiao === 'INTERIOR'));

    await salvarBucketRegiao(atualizacoes);

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

// Colunas do CSV de export por tipo -- rótulo (cabeçalho) + nome do campo nas
// linhas devolvidas por getOrdensBacklog*.
const COLUNAS_EXPORT_BASE = [
  { rotulo: 'Aliada', campo: 'aliada' },
  { rotulo: 'Bucket', campo: 'bucket' },
  { rotulo: 'Código', campo: 'codigo' },
  { rotulo: 'Armário', campo: 'armario' },
  { rotulo: 'Status', campo: 'status' },
  { rotulo: 'Status Reason', campo: 'statusReason' },
  { rotulo: 'Tecnologia', campo: 'tecnologia' },
];
const COLUNAS_EXPORT_ESPECIFICACAO = [
  { rotulo: 'Specification Type', campo: 'especificacaoTipo' },
  { rotulo: 'Specification Product', campo: 'especificacaoProduto' },
];
const COLUNAS_EXPORT_FINAL = [
  { rotulo: 'Data Agendamento', campo: 'dataAgendamento' },
  { rotulo: 'Time Slot', campo: 'timeSlot' },
];

// Clique no número do Total geral (Backlog) na home -- baixa em CSV as ordens
// individuais que compõem aquele total, com os MESMOS filtros aplicados na tela
// (tecnologia/status/statusReason/tecnologiaAcesso/aliada), pra o usuário
// conferir contra o ELOS. Reaproveita carregarDadosPainel só pra resolver a
// seleção de filtros (mesma fonte de verdade da tela), sem duplicar a lógica de
// normalizarListaComPadrao/normalizarTecnologias aqui.
router.get('/backlog/exportar/:tipo', async (req, res, next) => {
  try {
    const tipo = req.params.tipo;
    const dados = await carregarDadosPainel(req.query);

    let linhas;
    let nomeArquivo;
    let colunas;
    if (tipo === 'reparo') {
      linhas = await getOrdensBacklog(dados.tecnologiasSelecionadas, {
        status: dados.statusReparoSelecionados,
        statusReason: dados.statusReasonReparoSelecionados,
      });
      nomeArquivo = 'backlog_reparos';
      colunas = [...COLUNAS_EXPORT_BASE, ...COLUNAS_EXPORT_FINAL];
    } else if (tipo === 'instalacao') {
      linhas = await getOrdensBacklogInstalacoes({
        status: dados.statusInstalacaoSelecionados,
        statusReason: dados.statusReasonInstalacaoSelecionados,
        tecnologiaAcesso: dados.tecnologiaAcessoSelecionadas,
      });
      nomeArquivo = 'backlog_instalacao';
      colunas = [...COLUNAS_EXPORT_BASE, ...COLUNAS_EXPORT_FINAL];
    } else if (tipo === 'servico') {
      linhas = await getOrdensBacklogServicos({
        status: dados.statusServicoSelecionados,
        statusReason: dados.statusReasonServicoSelecionados,
        tecnologiaAcesso: dados.tecnologiaAcessoServicoSelecionadas,
      });
      nomeArquivo = 'backlog_servico';
      colunas = [...COLUNAS_EXPORT_BASE, ...COLUNAS_EXPORT_ESPECIFICACAO, ...COLUNAS_EXPORT_FINAL];
    } else if (tipo === 'me') {
      linhas = await getOrdensBacklogMe({
        status: dados.statusMeSelecionados,
        statusReason: dados.statusReasonMeSelecionados,
        tecnologiaAcesso: dados.tecnologiaAcessoMeSelecionadas,
      });
      nomeArquivo = 'backlog_me';
      colunas = [...COLUNAS_EXPORT_BASE, ...COLUNAS_EXPORT_ESPECIFICACAO, ...COLUNAS_EXPORT_FINAL];
    } else {
      return res.status(404).send('Tipo de backlog inválido.');
    }

    // Mesmo filtro de Aliada da tela -- aplicado aqui (não no SQL) porque a
    // coluna "aliada" das queries de getOrdensBacklog* já vem resolvida via
    // COALESCE(d.ALIADA, curinga), igual ao que carregarDadosPainel faz pras
    // linhas agregadas.
    const linhasFiltradas = linhas.filter(l => dados.aliadasSelecionadas.includes(l.aliada));

    const hoje = new Date();
    const dataArquivo = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    const csv = paraCsv(linhasFiltradas, colunas);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}_${dataArquivo}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.carregarDadosPainel = carregarDadosPainel;
