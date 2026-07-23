const pool = require('../db');

// backlog_elos mora em outro banco (indicadores), compartilhado com outro
// aplicativo -- ver comentário equivalente em bucketService.js.
const TABELA_BACKLOG_ELOS = `${process.env.DB_NAME_INDICADORES || 'indicadores'}.backlog_elos`;

// Ordem e nomes exatos do cabeçalho do export de Reparos do ELOS (pipe-delimited,
// ISO-8859-1/latin1) -- mesma lista de colunas usada pela raspagem automática
// (elos-backlog-scraper/importBacklog.js). Se o ELOS mudar o layout, a
// importação falha cedo (ver parseCsv) em vez de gravar dado desalinhado.
//
// Diferença importante em relação à raspagem automática: aqui é upload manual
// (TRUNCATE + INSERT, substitui tudo), não upsert por COD_SS -- decisão do
// usuário, ciente de que backlog_elos é compartilhada com outro sistema.
const COLUNAS = [
  'COD_SS', 'STATUS', 'STATUS_REASON', 'DATA_STATUS', 'ARMARIO', 'STREETNAME',
  'STATEORPROVINCE', 'POSTCODE', 'CNL', 'NEIGHBORDHOOD', 'CATEGORIZES_TYPE',
  'SPECIFICATION_TYPE', 'SPECIFICATION_PRODUCT', 'DETAIL', 'DATA_ABERTURA',
  'DATA_VENCIMENTO', 'TIME_SLOT', 'PHYSICALRESOURCESUMMARY', 'TELEPHONENUMERIC',
  'DESIGNATOR', 'CITY', 'CLUSTER_', 'FABRICA', 'REGIONAL', 'CUSTOMER_DOCUMENTNUMERIC',
  'CUSTOMER_NAME', 'EXECUTEDBYLOGIN', 'EXECUTEDBYNAME', 'NOTDONEREASON', 'PRIORITY',
  'SCHEDULEPROFILE', 'CUSTOMER_SEGMENT', 'DATA_AGENDADA', 'REDESPACHO',
  'CONTEXTO_SIEBEL', 'TOTAL_REPETIDO_30D_PL', 'TECNICO_CHECKLIST',
  'SERVICE_TECHNOLOGY', 'VELOCIDADEADSL', 'REPETIDO_PRODUTO_30D',
  'REGISTRADO_CHECKLIST', 'CUSTOMER_RANK', 'SEGMENTACAO', 'DESIGNADOR_TV', 'REDE',
  'MICROAREA', 'TELEPHONIC_AREA', 'CENTRAL_OFFICE', 'PHYSICAL_LINK_MEDIA_TYPE',
  'FLAG_RECENTE', 'EXECUTOR_BA', 'TEC_ANTERIOR', 'PRIMEIRO_AGENDAMENTO',
  'CABO_PRIMARIO', 'PAR_PRIMARIO', 'CABO_SECUNDARIO', 'PAR_SECUNDARIO',
  'LATERAL_PRIMARIO', 'LATERAL', 'NUMERO_CAIXA', 'NOME_MSAN', 'NP', 'DATA_CARGA',
  'DATA_LAST_UPDATE_PLWO', 'ID_FIBRA', 'OLT', 'OLT_PORTA', 'OLT_SLOT',
  'SPLITTER_FIBRA_L2', 'ORIGEM_CONTATO', 'ABERTURA_TIPO2_SIEBEL', 'LATITUDE',
  'LONGITUDE', 'CLIENTE_GOAS', 'MARCACAO_VIA_CHAT', 'PLATFORM', 'IND_CRITICOS',
  'IND_DISPONIBILIDADE_FIBRA', 'SAS_BUSINESSID', 'SAS_STATUSREASON', 'SASEVEN_CODE',
  'SASEVEN_VIVO1_ID', 'SASEVEN_DATA_INICIO', 'SASEVEN_FLAG_ATIVO',
  'SASEVEN_DATA_PREVISAO', 'SASEVEN_DATA_FECHAMENTO', 'SASEVEN_LEVEL',
  'SASEVEN_CREATOR', 'SASCAUSA_NOME', 'XA_FAULT_REASON', 'XA_OPERATOR_ID',
  'XA_API_CANCEL_REASON', 'NOM_SISTEMA_ORIGEM', 'FLAG_ICMCOE', 'DESIGNADOR_ACESSO',
  'FLAG_CASAINTELIGENTE', 'PARENT1', 'PARENT2', 'PARENT3', 'PARENT4', 'AURA_CASO',
  'AURA_DAT_ENVIO', 'AURA_DAT_CONF', 'AURA_RETORNO', 'IFI', 'IFI_GERADOR', 'IRR',
  'IRR_GERADOR',
];

// Vem como 'DD/MM/YYYY HH:mm' no CSV -- a tabela real (criada pela raspagem
// automática) usa DATETIME nessas colunas, então precisa virar 'YYYY-MM-DD HH:mm:ss'
// antes do INSERT (string solta no formato do ELOS não é aceita).
const COLUNAS_DATA = new Set(['DATA_STATUS', 'DATA_ABERTURA', 'DATA_VENCIMENTO']);

// Únicas colunas usadas em filtro/JOIN hoje (ver bucketService.js) -- ficam
// VARCHAR curto pelo mesmo motivo de backlog_instalacoes (limite de row size
// do InnoDB com muitas colunas). Resto vira TEXT.
const COLUNAS_VARCHAR_CURTO = new Set([
  'COD_SS', 'ARMARIO', 'CLUSTER_', 'REGIONAL', 'STATUS', 'SPECIFICATION_TYPE', 'PHYSICAL_LINK_MEDIA_TYPE',
]);

function tipoColuna(nome) {
  if (COLUNAS_DATA.has(nome)) return 'DATETIME NULL';
  return COLUNAS_VARCHAR_CURTO.has(nome) ? 'VARCHAR(30)' : 'TEXT';
}

const BATCH_SIZE = 500;

// Só entra em jogo se a tabela ainda não existir (em produção ela já existe,
// criada pela raspagem automática -- CREATE TABLE IF NOT EXISTS é só uma rede
// de segurança, igual instalacoesService.js faz para backlog_instalacoes).
function montarCreateTableSql() {
  const colunasSql = COLUNAS
    .map(nome => `\`${nome}\` ${tipoColuna(nome)}`)
    .join(',\n    ');

  return `
    CREATE TABLE IF NOT EXISTS ${TABELA_BACKLOG_ELOS} (
      ${colunasSql},
      STATUS_GOPER VARCHAR(20),
      PRIMARY KEY (COD_SS),
      KEY idx_armario (ARMARIO),
      KEY idx_cluster (CLUSTER_),
      KEY idx_status (STATUS),
      KEY idx_specification_type (SPECIFICATION_TYPE)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `;
}

function reformatarData(valor) {
  const bruto = (valor || '').trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(bruto);
  if (!m) return null;
  const [, dia, mes, ano, hora, minuto, segundo] = m;
  return `${ano}-${mes}-${dia} ${hora}:${minuto}:${segundo || '00'}`;
}

// O export do ELOS vem em ISO-8859-1 (acentos quebram se lido como utf8).
function parseCsv(buffer) {
  const texto = buffer.toString('latin1');
  const linhas = texto.split(/\r?\n/).filter(linha => linha.trim().length > 0);

  if (linhas.length === 0) {
    throw new Error('Arquivo vazio.');
  }

  // Busca cada coluna esperada PELO NOME, não pela posição -- o export de
  // Reparos do ELOS já apareceu com colunas extras no fim (o ELOS foi adicionando
  // campos novos ao longo do tempo), então travar por contagem exata rejeitava
  // arquivos válidos. Colunas extras no arquivo (que não estão em COLUNAS) são
  // ignoradas -- mesmo comportamento da raspagem automática (importBacklog.js).
  const cabecalho = linhas[0].split('|').map(v => v.trim());
  const indiceHeader = new Map();
  cabecalho.forEach((nome, i) => indiceHeader.set(nome, i));

  const faltando = COLUNAS.filter(nome => !indiceHeader.has(nome));
  if (faltando.length > 0) {
    throw new Error(
      `Cabeçalho do arquivo não tem ${faltando.length} coluna(s) esperada(s): ${faltando.join(', ')}. ` +
      'O ELOS pode ter mudado o formato do export — confira o cabeçalho do CSV.'
    );
  }

  return linhas.slice(1).map(linha => {
    const campos = linha.split('|');
    return COLUNAS.map(nome => {
      const idx = indiceHeader.get(nome);
      const valor = campos[idx] !== undefined ? campos[idx] : '';
      return COLUNAS_DATA.has(nome) ? reformatarData(valor) : valor;
    });
  });
}

async function inserirBatch(conn, tabela, linhas) {
  const colunasSql = COLUNAS.map(c => `\`${c}\``).join(',');
  const placeholderLinha = '(' + Array(COLUNAS.length).fill('?').join(',') + ", 'NA BASE')";
  const placeholders = Array(linhas.length).fill(placeholderLinha).join(',');
  const valores = linhas.flat();

  await conn.query(
    `INSERT INTO ${tabela} (${colunasSql}, STATUS_GOPER) VALUES ${placeholders}`,
    valores
  );
}

// A tabela real já existe há tempo e pode ter sido criada por uma versão mais
// antiga do schema (ex.: PHYSICALRESOURCESUMMARY é VARCHAR(255) na tabela real,
// não TEXT como o schema.js da raspagem automática define hoje -- os dois
// divergiram). Em vez de confiar no tipo que QUALQUER código python assume,
// lê o tamanho real de cada coluna no banco e corta o valor pra caber, evitando
// o erro "Data too long" que já aconteceu aqui uma vez.
async function obterTamanhosColunas(conn) {
  const [dbName, tabela] = TABELA_BACKLOG_ELOS.split('.');
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ?`,
    [dbName, tabela]
  );

  const mapa = {};
  rows.forEach(r => { mapa[r.COLUMN_NAME] = r.CHARACTER_MAXIMUM_LENGTH; });
  return mapa;
}

function truncarParaCaber(linhas, tamanhos) {
  return linhas.map(linha => linha.map((valor, i) => {
    const max = tamanhos[COLUNAS[i]];
    return (max != null && typeof valor === 'string' && valor.length > max)
      ? valor.slice(0, max)
      : valor;
  }));
}

// Importa pra uma tabela "staging" à parte e só troca de nome com a tabela real
// (RENAME TABLE, atômico no MySQL/MariaDB) depois que TODA a importação deu
// certo. Necessário porque TRUNCATE é DDL e "comita" sozinho mesmo dentro de uma
// transação -- um erro no meio dos INSERTs (já aconteceu: campo maior que a
// coluna) deixava a tabela truncada sem jeito de desfazer com rollback. Com
// staging, se algum INSERT falhar, backlog_elos real nem chega a ser tocada.
async function importarReparos(buffer) {
  const linhas = parseCsv(buffer);

  const conn = await pool.getConnection();
  const tabelaStaging = `${TABELA_BACKLOG_ELOS}_staging_upload`;
  const tabelaBackup = `${TABELA_BACKLOG_ELOS}_backup_upload`;
  try {
    // Rede de segurança: só cria de verdade se backlog_elos ainda não existir
    // (banco novo/dev). Em produção já existe, isso vira um no-op.
    await conn.query(montarCreateTableSql());

    const tamanhos = await obterTamanhosColunas(conn);
    const linhasAjustadas = truncarParaCaber(linhas, tamanhos);

    await conn.query(`DROP TABLE IF EXISTS ${tabelaStaging}`);
    await conn.query(`CREATE TABLE ${tabelaStaging} LIKE ${TABELA_BACKLOG_ELOS}`);

    for (let i = 0; i < linhasAjustadas.length; i += BATCH_SIZE) {
      await inserirBatch(conn, tabelaStaging, linhasAjustadas.slice(i, i + BATCH_SIZE));
    }

    await conn.query(`DROP TABLE IF EXISTS ${tabelaBackup}`);
    await conn.query(
      `RENAME TABLE ${TABELA_BACKLOG_ELOS} TO ${tabelaBackup}, ${tabelaStaging} TO ${TABELA_BACKLOG_ELOS}`
    );
    await conn.query(`DROP TABLE IF EXISTS ${tabelaBackup}`);

    return { totalLinhas: linhasAjustadas.length };
  } catch (err) {
    await conn.query(`DROP TABLE IF EXISTS ${tabelaStaging}`).catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { importarReparos, parseCsv, COLUNAS };
