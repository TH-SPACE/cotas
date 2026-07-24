const zlib = require('zlib');
const pool = require('../db');

// Cotas do ELOS por tipo. Cada tipo tem sua própria tabela (mesmo padrão do resto do
// app: backlog_instalacoes, depara_pu_produto/_servico/_me...), todas com o mesmo
// layout do Excel "Export". Tabelas próprias do banco `cotas`, não compartilhadas.
const TABELAS = {
  instalacao: 'cotas_instalacao',
  servico: 'cotas_servico',
  me: 'cotas_me',
  reparo: 'cotas_reparo',
};
const TIPOS = Object.keys(TABELAS);

function tabelaDoTipo(tipo) {
  const tabela = TABELAS[tipo];
  if (!tabela) throw new Error(`Tipo de cotas inválido: ${tipo}. Use um de: ${TIPOS.join(', ')}.`);
  return tabela;
}

// Colunas do export "Export" de cotas do ELOS. O casamento é por NOME (não por
// posição): o arquivo pode ganhar colunas novas que a gente ignora, desde que estas
// continuem existindo. Se alguma sumir, o import falha cedo.
const COLUNA_REGIONAL = 'Regional';
const COLUNA_CLUSTER = 'Cluster';
const COLUNA_BUCKET = 'Bucket';
const COLUNA_TECNOLOGIA = 'Tecnologia';
const COLUNA_AGE = 'Age';
const COLUNA_CAPACITY = 'Capacity Category';
const COLUNA_TIME_SLOT = 'Time Slot';
const COLUNA_STATUS = 'Status';
const COLUNA_COTA_ABERTA = 'Cota Aberta';
const COLUNA_COTA_USADA = 'Cota Usada';
const COLUNA_COTA_CADASTRADA = 'Cota Cadastrada';

// Sem estas o cálculo (bucket × janela × D0) não faz sentido — falha o upload.
const COLUNAS_OBRIGATORIAS = [
  COLUNA_BUCKET, COLUNA_AGE, COLUNA_TIME_SLOT, COLUNA_STATUS, COLUNA_COTA_ABERTA,
];

const BATCH_SIZE = 500;

// --- Leitura de .xlsx sem dependência externa -------------------------------
// Um .xlsx é um ZIP de XMLs. Como o resto do app é lean (5 deps), em vez de puxar
// uma lib de planilha a gente lê o ZIP na mão (só o End Of Central Directory +
// Central Directory pra achar as entradas) e infla o deflate com o zlib nativo.

function lerZip(buffer) {
  // Acha o EOCD (assinatura 0x06054b50) varrendo de trás pra frente.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('Arquivo não é um .xlsx válido (ZIP sem EOCD).');

  const totalEntradas = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  const arquivos = new Map();
  for (let e = 0; e < totalEntradas; e++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const metodo = buffer.readUInt16LE(offset + 10);
    const tamComprimido = buffer.readUInt32LE(offset + 20);
    const nomeLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const comentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nome = buffer.toString('utf8', offset + 46, offset + 46 + nomeLen);

    // O local header pode ter name/extra len diferentes do central — recalcula.
    const localNomeLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const inicioDados = localOffset + 30 + localNomeLen + localExtraLen;
    const dados = buffer.subarray(inicioDados, inicioDados + tamComprimido);

    arquivos.set(nome, metodo === 8 ? zlib.inflateRawSync(dados) : Buffer.from(dados));
    offset += 46 + nomeLen + extraLen + comentLen;
  }
  return arquivos;
}

function decodeXmlEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&');
}

// Devolve uma matriz linhas[][] de strings. Lida com células inline (t="inlineStr"),
// sharedStrings (t="s") e numéricas. Localiza a 1ª worksheet via workbook rels, com
// fallback pra sheet1.xml.
function parseXlsx(buffer) {
  const arquivos = lerZip(buffer);

  let shared = [];
  const ssBuf = arquivos.get('xl/sharedStrings.xml');
  if (ssBuf) {
    const ssXml = ssBuf.toString('utf8');
    shared = [...ssXml.matchAll(/<(?:x:)?si>([\s\S]*?)<\/(?:x:)?si>/g)].map(m => {
      const txt = [...m[1].matchAll(/<(?:x:)?t[^>]*>([\s\S]*?)<\/(?:x:)?t>/g)].map(t => t[1]).join('');
      return decodeXmlEntities(txt);
    });
  }

  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wbBuf = arquivos.get('xl/workbook.xml');
  const relsBuf = arquivos.get('xl/_rels/workbook.xml.rels');
  if (wbBuf && relsBuf) {
    const primeiroSheet = wbBuf.toString('utf8').match(/<(?:x:)?sheet\b[^>]*r:id="([^"]+)"/);
    if (primeiroSheet) {
      const rel = relsBuf.toString('utf8').match(
        new RegExp(`<Relationship[^>]*Id="${primeiroSheet[1]}"[^>]*Target="([^"]+)"`)
      );
      if (rel) sheetPath = 'xl/' + rel[1].replace(/^\/?xl\//, '').replace(/^\//, '');
    }
  }
  const sheetBuf = arquivos.get(sheetPath) || arquivos.get('xl/worksheets/sheet1.xml');
  if (!sheetBuf) throw new Error('Planilha não encontrada dentro do .xlsx.');
  const sheetXml = sheetBuf.toString('utf8');

  const linhas = [];
  const rowRe = /<(?:x:)?row\b[^>]*>([\s\S]*?)<\/(?:x:)?row>/g;
  let rm;
  while ((rm = rowRe.exec(sheetXml)) !== null) {
    const cells = [];
    const cellRe = /<(?:x:)?c\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:x:)?c>)/g;
    let cm;
    while ((cm = cellRe.exec(rm[1])) !== null) {
      const attrs = cm[1] || '';
      const inner = cm[2] || '';
      const tipo = (attrs.match(/\bt="([^"]+)"/) || [])[1];
      let valor = '';
      if (tipo === 'inlineStr') {
        valor = decodeXmlEntities(
          [...inner.matchAll(/<(?:x:)?t[^>]*>([\s\S]*?)<\/(?:x:)?t>/g)].map(t => t[1]).join('')
        );
      } else if (tipo === 's') {
        const vm = inner.match(/<(?:x:)?v>([\s\S]*?)<\/(?:x:)?v>/);
        valor = vm ? (shared[Number(vm[1])] ?? '') : '';
      } else {
        const vm = inner.match(/<(?:x:)?v>([\s\S]*?)<\/(?:x:)?v>/);
        valor = vm ? decodeXmlEntities(vm[1]) : '';
      }
      cells.push(valor);
    }
    linhas.push(cells);
  }
  return linhas;
}

// --- Tabela / import --------------------------------------------------------

// Tabelas próprias do app (banco `cotas`, não compartilhadas), então TRUNCATE +
// INSERT simples é seguro — cada upload substitui tudo daquele tipo, igual
// backlog_instalacoes.
function createTableSql(tabela) {
  return `
    CREATE TABLE IF NOT EXISTS \`${tabela}\` (
      ID INT AUTO_INCREMENT PRIMARY KEY,
      REGIONAL VARCHAR(60),
      CLUSTER VARCHAR(60),
      BUCKET VARCHAR(80),
      TECNOLOGIA VARCHAR(40),
      AGE VARCHAR(10),
      CAPACITY_CATEGORY VARCHAR(60),
      TIME_SLOT VARCHAR(20),
      STATUS VARCHAR(20),
      COTA_ABERTA INT,
      COTA_USADA INT,
      COTA_CADASTRADA VARCHAR(10),
      IMPORTADO_EM DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_bucket_slot_age (BUCKET, TIME_SLOT, AGE)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `;
}

async function criarTabela(tabela, conn = pool) {
  await conn.query(createTableSql(tabela));
}

function paraInteiro(valor) {
  const n = parseInt(String(valor).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

// Monta a lista de objetos-linha a partir da matriz do xlsx, casando as colunas por
// nome (não por posição). Ignora linhas sem bucket (rodapé/vazias do export).
function extrairLinhas(matriz) {
  if (matriz.length === 0) throw new Error('Planilha vazia.');

  const cabecalho = matriz[0].map(c => String(c).trim());
  const indice = {};
  cabecalho.forEach((nome, i) => { if (!(nome in indice)) indice[nome] = i; });

  const faltando = COLUNAS_OBRIGATORIAS.filter(nome => !(nome in indice));
  if (faltando.length > 0) {
    throw new Error(
      `Layout do arquivo não confere: faltam as colunas ${faltando.join(', ')}. ` +
      'Confira se é o export de Cotas do ELOS (aba Export).'
    );
  }

  const pega = (linha, nome) => (indice[nome] !== undefined ? (linha[indice[nome]] ?? '') : '');

  return matriz.slice(1)
    .map(linha => ({
      regional: String(pega(linha, COLUNA_REGIONAL)).trim(),
      cluster: String(pega(linha, COLUNA_CLUSTER)).trim(),
      bucket: String(pega(linha, COLUNA_BUCKET)).trim(),
      tecnologia: String(pega(linha, COLUNA_TECNOLOGIA)).trim(),
      age: String(pega(linha, COLUNA_AGE)).trim(),
      capacity: String(pega(linha, COLUNA_CAPACITY)).trim(),
      timeSlot: String(pega(linha, COLUNA_TIME_SLOT)).trim(),
      status: String(pega(linha, COLUNA_STATUS)).trim(),
      cotaAberta: paraInteiro(pega(linha, COLUNA_COTA_ABERTA)),
      cotaUsada: paraInteiro(pega(linha, COLUNA_COTA_USADA)),
      cotaCadastrada: String(pega(linha, COLUNA_COTA_CADASTRADA)).trim(),
    }))
    .filter(l => l.bucket);
}

async function inserirBatch(conn, tabela, linhas) {
  const placeholderLinha = '(' + Array(11).fill('?').join(',') + ')';
  const placeholders = Array(linhas.length).fill(placeholderLinha).join(',');
  const valores = linhas.flatMap(l => [
    l.regional, l.cluster, l.bucket, l.tecnologia, l.age, l.capacity,
    l.timeSlot, l.status, l.cotaAberta, l.cotaUsada, l.cotaCadastrada,
  ]);

  await conn.query(
    `INSERT INTO \`${tabela}\`
       (REGIONAL, CLUSTER, BUCKET, TECNOLOGIA, AGE, CAPACITY_CATEGORY, TIME_SLOT, STATUS, COTA_ABERTA, COTA_USADA, COTA_CADASTRADA)
     VALUES ${placeholders}`,
    valores
  );
}

async function importarCotas(buffer, tipo) {
  const tabela = tabelaDoTipo(tipo);
  const linhas = extrairLinhas(parseXlsx(buffer));

  const conn = await pool.getConnection();
  try {
    await criarTabela(tabela, conn);
    await conn.beginTransaction();
    await conn.query(`TRUNCATE TABLE \`${tabela}\``);

    for (let i = 0; i < linhas.length; i += BATCH_SIZE) {
      await inserirBatch(conn, tabela, linhas.slice(i, i + BATCH_SIZE));
    }

    await conn.commit();
    return { totalLinhas: linhas.length };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Cotas do dia (Age = D0) por bucket + janela de um tipo: a COTAS D0 e o Status da
// tela vêm daqui. Agrega (SUM/MAX) por segurança caso um bucket tenha mais de uma
// linha D0 na mesma janela (ex.: tecnologias diferentes) — pros 14 buckets de
// GOIANIA hoje é 1 linha só, então a agregação é inofensiva.
async function getCotasD0(tipo) {
  const tabela = tabelaDoTipo(tipo);
  await criarTabela(tabela);
  const [rows] = await pool.query(
    `SELECT BUCKET AS bucket, TIME_SLOT AS timeSlot,
            MAX(STATUS) AS status,
            SUM(COTA_ABERTA) AS cotaAberta,
            SUM(COTA_USADA) AS cotaUsada
     FROM \`${tabela}\`
     WHERE AGE = 'D0'
     GROUP BY BUCKET, TIME_SLOT`
  );
  return rows;
}

// Consumo de hoje: soma as ordens de backlog_instalacoes AGENDADAS para hoje.
// Atenção ao nome da coluna: apesar de se chamar DATA_VENCIMENTO, ela guarda a
// data do AGENDAMENTO da ordem -- não é prazo/vencimento. Não descreva como
// "vencendo hoje" na tela (já foi corrigido uma vez).
// Filtra por DATA_VENCIMENTO começando por DD/MM/YYYY (o CSV do ELOS grava
// "DD/MM/YYYY HH:MM:SS", então usamos LIKE),
// multiplicadas pelo tempo de instalação do bucket (depara_tempo_bucket.INSTALACAO),
// agrupado por bucket (via depara_bucket) e TIME_SLOT.
// Retorna linhas { bucket, timeSlot, consumo } onde consumo = COUNT * minutos.
async function getConsumoHoje() {
  const hoje = new Date();
  const dd = String(hoje.getDate()).padStart(2, '0');
  const mm = String(hoje.getMonth() + 1).padStart(2, '0');
  const yyyy = hoje.getFullYear();
  const prefixoHoje = `${dd}/${mm}/${yyyy}%`;

  const [rows] = await pool.query(
    `SELECT
       COALESCE(d.BKT, 'BKT_GOIANIA') AS bucket,
       i.TIME_SLOT AS timeSlot,
       COUNT(i.ID) AS qtdOrdens,
       COUNT(i.ID) * COALESCE(t.INSTALACAO, 0) AS consumo
     FROM backlog_instalacoes i
     LEFT JOIN depara_bucket d ON d.ARMARIO = i.ARMARIO
     LEFT JOIN depara_tempo_bucket t ON t.BUCKET = COALESCE(d.BKT, 'BKT_GOIANIA')
     WHERE i.DATA_VENCIMENTO LIKE ?
       AND i.CLUSTER_ = 'GOIANIA'
       AND i.SPECIFICATION_TYPE = 'INSTALAÇÃO'
     GROUP BY COALESCE(d.BKT, 'BKT_GOIANIA'), i.TIME_SLOT, t.INSTALACAO`,
    [prefixoHoje]
  );
  return rows;
}

// { instalacao, servico, me, reparo } -> última IMPORTADO_EM (string 'YYYY-...' ou
// null) de cada tipo, pra mostrar "atualizado em X" ao lado de cada botão de upload.
async function getDatasCargaCotas() {
  const entradas = await Promise.all(TIPOS.map(async tipo => {
    const tabela = tabelaDoTipo(tipo);
    await criarTabela(tabela);
    const [rows] = await pool.query(`SELECT MAX(IMPORTADO_EM) AS dataCarga FROM \`${tabela}\``);
    return [tipo, rows[0].dataCarga];
  }));
  return Object.fromEntries(entradas);
}

module.exports = {
  importarCotas,
  getCotasD0,
  getConsumoHoje,
  getDatasCargaCotas,
  parseXlsx,
  TIPOS,
};
