require('dotenv').config();
const fs = require('fs');
const moment = require('moment');
const conn = require('./db');

const TABLE = process.env.BACKLOG_TABLE || 'backlog_elos';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '500', 10);
const MIN_LINHAS = parseInt(process.env.MIN_LINHAS || '1000', 10);
const REGIOES_VALIDAS = (process.env.REGIOES_VALIDAS || 'CENTRO OESTE,NORTE')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);

// Colunas da tabela, na mesma ordem em que serao inseridas.
// Cada nome aqui deve bater com o cabecalho do CSV exportado pelo Elos
// (o parser busca a coluna pelo NOME, nao pela posicao, porque o Elos
// já mudou o numero/ordem de colunas do export ao longo do tempo).
const DB_COLUMNS = [
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
  'IRR_GERADOR'
];

// Colunas que vem como 'DD/MM/YYYY HH:mm' no CSV e precisam virar 'YYYY-MM-DD HH:mm'.
const DATE_COLUMNS = new Set(['DATA_STATUS', 'DATA_ABERTURA', 'DATA_VENCIMENTO']);

function parseHeader(headerLine) {
  const nomes = headerLine.split('|').map((n) => n.trim());
  const indice = new Map();
  nomes.forEach((nome, i) => indice.set(nome, i));
  return indice;
}

function montarLinha(campos, indiceHeader) {
  const REGIONAL = (campos[indiceHeader.get('REGIONAL')] || '').trim();
  if (!REGIOES_VALIDAS.includes(REGIONAL)) return null;

  const row = DB_COLUMNS.map((coluna) => {
    const idx = indiceHeader.get(coluna);
    let valor = idx === undefined ? '' : (campos[idx] || '').trim();

    if (DATE_COLUMNS.has(coluna)) {
      if (!valor) return null;
      const m = moment(valor, 'DD/MM/YYYY HH:mm');
      return m.isValid() ? m.format('YYYY-MM-DD HH:mm') : null;
    }
    return valor;
  });

  return row;
}

async function inserirBatch(rows) {
  if (rows.length === 0) return;

  const cols = DB_COLUMNS.join(',');
  const placeholderRow = '(' + Array(DB_COLUMNS.length).fill('?').join(',') + ",'NA BASE')";
  const placeholders = Array(rows.length).fill(placeholderRow).join(',');
  const values = rows.flat();

  const onDup = DB_COLUMNS
    .filter((c) => c !== 'COD_SS')
    .map((c) => `${c}=VALUES(${c})`)
    .join(',');

  const sql = `INSERT INTO \`${TABLE}\` (${cols}, STATUS_GOPER) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${onDup}, STATUS_GOPER='NA BASE'`;

  await (await conn).query(sql, values);
}

// Recebe o caminho do CSV (pipe-delimited, com cabecalho) baixado do Elos
// e faz o upsert em backlog_elos. Retorna estatisticas do que foi feito.
async function importarArquivo(filePath) {
  const csvData = await fs.promises.readFile(filePath, { encoding: 'latin1' });
  const lines = csvData.split('\n').filter((l) => l.trim().length > 0);

  if (lines.length < MIN_LINHAS) {
    throw new Error(
      `Arquivo com apenas ${lines.length} linhas (minimo esperado: ${MIN_LINHAS}). Abortando para nao apagar dados por engano.`
    );
  }

  const indiceHeader = parseHeader(lines[0]);
  if (!indiceHeader.has('COD_SS') || !indiceHeader.has('REGIONAL')) {
    throw new Error('Cabecalho do CSV nao contem COD_SS/REGIONAL. Formato do export do Elos pode ter mudado.');
  }

  await (await conn).query(`UPDATE \`${TABLE}\` SET STATUS_GOPER='FORA BASE'`);

  let totalImportadas = 0;
  const batchRows = [];

  for (let i = 1; i < lines.length; i++) {
    const campos = lines[i].split('|');
    const row = montarLinha(campos, indiceHeader);
    if (!row) continue;

    batchRows.push(row);
    totalImportadas++;

    if (batchRows.length >= BATCH_SIZE) {
      await inserirBatch(batchRows);
      batchRows.length = 0;
    }
  }
  if (batchRows.length > 0) {
    await inserirBatch(batchRows);
  }

  const [resultado] = await (await conn).query(
    `DELETE FROM \`${TABLE}\` WHERE STATUS_GOPER='FORA BASE'`
  );

  return {
    totalLinhas: lines.length - 1,
    totalImportadas,
    totalRemovidas: resultado.affectedRows
  };
}

module.exports = { importarArquivo, DB_COLUMNS, REGIOES_VALIDAS };
