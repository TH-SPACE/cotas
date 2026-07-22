require('dotenv').config();
const fs = require('fs');
const path = require('path');
const conn = require('./db');

const TABLE = process.env.INSTALACOES_TABLE || 'backlog_instalacoes';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '500', 10);
const MIN_LINHAS = parseInt(process.env.MIN_LINHAS || '1000', 10);
const REGIOES_VALIDAS = (process.env.REGIOES_VALIDAS || 'CENTRO OESTE,NORTE')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);

// Colunas da tabela (exceto ID/ARQUIVO_ORIGEM/IMPORTADO_EM, que sao geridas a
// parte), na mesma ordem em que serao inseridas. Mapeadas pelo NOME do
// cabecalho do CSV (nao pela posicao), igual ao importBacklog.js.
// NUMERO_OS sozinho NAO e unico no export de Instalacoes (uma OS pode ter varias
// linhas, uma por produto/atividade) e a tabela real (copiada como referencia)
// nao tem nenhuma chave natural -- por isso a carga aqui e "snapshot": a cada
// importacao a tabela e truncada e recarregada do zero, em vez de upsert.
const DB_COLUMNS = [
  'NUMERO_OS', 'STATUS', 'STATUS_REASON', 'DATA_STATUS', 'ARMARIO', 'STREETNAME',
  'STATEORPROVINCE', 'POSTCODE', 'CNL', 'NEIGHBORDHOOD', 'CATEGORIZES_TYPE',
  'SPECIFICATION_TYPE', 'SPECIFICATION_PRODUCT', 'DETAIL', 'DATA_ABERTURA',
  'DATA_VENCIMENTO', 'TIME_SLOT', 'PHYSICALRESOURCESUMMARY', 'TELEPHONENUMERIC',
  'DESIGNATOR', 'CIDADE', 'CLUSTER_', 'REGIONAL', 'CUSTOMER_DOCUMENTNUMERIC',
  'CUSTOMER_NAME', 'EXECUTEDBYLOGIN', 'EXECUTEDBYNAME', 'NOTDONEREASON', 'PRIORITY',
  'SCHEDULEPROFILE', 'CUSTOMER_SEGMENT', 'CUSTOMER_TEMPERATURE', 'CUSTOMER_RANK',
  'SEGMENTACAO', 'SERVICE_TECHNOLOGY', 'SPECIFICATION_ACRONYM', 'PORTABILITY_STATUS',
  'PORTABILITY_START', 'PORTABILITY_END', 'REDESPACHO', 'DATEOFSTATUSPORTABILITY',
  'DATEOFSTATUSEXECUTION', 'CONTRACTOR', 'PON', 'RPON', 'AGENDADO_NA_VENDA',
  'VELOCIDADEADSL', 'DATA_AGENDADA', 'DTH_PURO', 'TOTAL_PONTO_ADICIONAL', 'PACOTE_TV',
  'FLAG_GPON', 'DATA_CANCELAMENTO', 'LOGIN_CANCELAMENTO', 'MOTIVO_DE_CANCELAMENTO',
  'OBSERVACAO', 'REDE', 'MICROAREA', 'TELEPHONIC_AREA', 'CENTRAL_OFFICE',
  'TECNOLOGIA_ACESSO', 'DESIGNADOR_TV', 'DTH_CONECTADO', 'PRODUTOS_ADICIONAR',
  'PRODUTOS_MODIFICAR', 'PRODUTOS_ATIVO', 'PRODUTOS_DESCONECTAR', 'DATA_CARGA',
  'DATA_LAST_UPDATE_PLWO', 'TECNOLOGIA_TV', 'LATITUDE', 'LONGITUDE', 'CLIENTE_GOAS',
  'MARCACAO_VIA_CHAT', 'PLATFORM', 'EXCECAO_ATUAL', 'EXCECAO_ATUAL_ATIVIDADE',
  'EXCECAO_ATUAL_GRUPO', 'RECUSA_ANTECIPAR', 'DATA_COMPROMISSO', 'DATA_PRIMEIRA_AGENDA',
  'DESC_GRUPO_RESPONSABILIDADE', 'DESC_CANAL', 'DESC_GRUPO_CANAL',
  'FLAG_CANAL_ATENDIMENTO', 'FLAG_VENDE_INSTALA', 'CLIENTES_V_SAV',
  'NOM_SISTEMA_ORIGEM', 'FLAG_MATRIX', 'FLAG_EVEREST', 'FLAG_MT24H', 'FLAG_PRD_ALTA',
  'ID_PRD_ULT_DESC', 'DESIGNADOR_ACESSO', 'FLAG_CASAINTELIGENTE', 'PARENT1', 'PARENT2',
  'PARENT3', 'PARENT4', 'FLAG_FIBRATODOS', 'FLAG_ANATEL', 'FLAG_RIFAINA'
];

function parseHeader(headerLine) {
  const nomes = headerLine.split('|').map((n) => n.trim());
  const indice = new Map();
  nomes.forEach((nome, i) => indice.set(nome, i));
  return indice;
}

function montarLinha(campos, indiceHeader) {
  const REGIONAL = (campos[indiceHeader.get('REGIONAL')] || '').trim();
  if (!REGIOES_VALIDAS.includes(REGIONAL)) return null;

  return DB_COLUMNS.map((coluna) => {
    const idx = indiceHeader.get(coluna);
    return idx === undefined ? '' : (campos[idx] || '').trim();
  });
}

async function inserirBatch(rows, nomeArquivo) {
  if (rows.length === 0) return;

  const cols = DB_COLUMNS.join(',');
  const placeholderRow = '(' + Array(DB_COLUMNS.length).fill('?').join(',') + ', ?, NOW())';
  const placeholders = Array(rows.length).fill(placeholderRow).join(',');
  const values = rows.flatMap((row) => [...row, nomeArquivo]);

  const sql = `INSERT INTO \`${TABLE}\` (${cols}, ARQUIVO_ORIGEM, IMPORTADO_EM) VALUES ${placeholders}`;
  await (await conn).query(sql, values);
}

// Recebe o caminho do CSV (pipe-delimited, com cabecalho) baixado do Elos e
// recarrega a backlog_instalacoes do zero (trunca e reinsere). Retorna
// estatisticas do que foi feito.
async function importarArquivo(filePath) {
  const csvData = await fs.promises.readFile(filePath, { encoding: 'latin1' });
  const lines = csvData.split('\n').filter((l) => l.trim().length > 0);

  if (lines.length < MIN_LINHAS) {
    throw new Error(
      `Arquivo com apenas ${lines.length} linhas (minimo esperado: ${MIN_LINHAS}). Abortando para nao apagar dados por engano.`
    );
  }

  const indiceHeader = parseHeader(lines[0]);
  if (!indiceHeader.has('NUMERO_OS') || !indiceHeader.has('REGIONAL')) {
    throw new Error('Cabecalho do CSV nao contem NUMERO_OS/REGIONAL. Formato do export de Instalacoes do Elos pode ter mudado.');
  }

  const nomeArquivo = path.basename(filePath);
  await (await conn).query(`TRUNCATE TABLE \`${TABLE}\``);

  let totalImportadas = 0;
  const batchRows = [];

  for (let i = 1; i < lines.length; i++) {
    const campos = lines[i].split('|');
    const row = montarLinha(campos, indiceHeader);
    if (!row) continue;

    batchRows.push(row);
    totalImportadas++;

    if (batchRows.length >= BATCH_SIZE) {
      await inserirBatch(batchRows, nomeArquivo);
      batchRows.length = 0;
    }
  }
  if (batchRows.length > 0) {
    await inserirBatch(batchRows, nomeArquivo);
  }

  return {
    totalLinhas: lines.length - 1,
    totalImportadas
  };
}

module.exports = { importarArquivo, DB_COLUMNS, REGIOES_VALIDAS };
