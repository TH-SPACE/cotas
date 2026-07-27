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
const TIPO_LABEL = {
  instalacao: 'Instalação',
  servico: 'Serviço',
  me: 'ME',
  reparo: 'Reparos',
};

function tabelaDoTipo(tipo) {
  const tabela = TABELAS[tipo];
  if (!tabela) throw new Error(`Tipo de cotas inválido: ${tipo}. Use um de: ${TIPOS.join(', ')}.`);
  return tabela;
}

// Trava de segurança pro upload em /cotas-planejadas: como as 4 planilhas do
// ETA têm exatamente o mesmo layout de colunas, um Excel de Serviço passa liso
// nas validações de coluna do botão de Instalação (e vice-versa) -- e cada
// upload faz TRUNCATE na tabela do tipo escolhido, então o arquivo errado
// sobrescreve dados bons sem aviso nenhum. A coluna "Capacity Category" (já
// importada, mas sem uso em nenhum cálculo) traz um valor que identifica o
// tipo -- substring informada pelo usuário (o valor real do ETA parece vir com
// prefixo/sufixo junto, por isso é `includes`, não igualdade exata).
const CAPACITY_CATEGORY_ESPERADA = {
  instalacao: 'INS',
  servico: 'SERVICO',
  me: 'MUD_END',
  reparo: 'REPAROS',
};

// Só barra quando há evidência clara de tipo errado (algum valor preenchido, e
// nenhum bate) -- se a coluna vier vazia no arquivo (ETA nem sempre preenche
// tudo), não dá pra validar, então deixa passar em vez de bloquear upload
// legítimo por falta de dado.
function validarCapacityCategory(linhas, tipo) {
  const esperado = CAPACITY_CATEGORY_ESPERADA[tipo];
  if (!esperado) return;
  const preenchidos = linhas.map(l => l.capacity).filter(Boolean);
  if (preenchidos.length === 0) return;
  const bate = preenchidos.some(v => v.toUpperCase().includes(esperado));
  if (!bate) {
    throw new Error(
      `Este arquivo não parece ser de ${TIPO_LABEL[tipo]}: a coluna "Capacity Category" não contém "${esperado}" em nenhuma linha. Confira se o arquivo certo foi selecionado.`
    );
  }
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
  validarCapacityCategory(linhas, tipo);

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

// O rótulo AGE (D0..D7) de um arquivo do ETA é relativo ao dia em que o PRÓPRIO
// relatório foi gerado -- não se recalcula sozinho com o calendário. Se o upload
// de hoje não for refeito amanhã, o AGE=D0 do arquivo continua sendo o dia em que
// ele foi importado, não o dia de hoje (usuário reportou isso na prática: upload
// de 24/07, sem reenviar, D0 "deveria" ser D3 três dias depois). `diasDesdeCarga`
// mede esse atraso (dias entre IMPORTADO_EM e hoje); `ageEfetivo` soma esse atraso
// ao offset REAL pedido (0 = hoje, 1..7 = D1..D7 da projeção) pra achar qual AGE
// do arquivo representa aquele dia de verdade. Se cair fora de D0..D7 (base nunca
// enviada, ou velha demais pro offset pedido), não existe dado -- melhor não
// mostrar nada do que mostrar a linha errada.
async function diasDesdeCarga(tabela) {
  const [rows] = await pool.query(`SELECT MAX(IMPORTADO_EM) AS dataCarga FROM \`${tabela}\``);
  const dataCarga = rows[0].dataCarga;
  if (!dataCarga) return null;
  const dataParte = dataCarga.split(' ')[0];
  const hoje = new Date();
  const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  return Math.round((Date.parse(hojeIso) - Date.parse(dataParte)) / 86400000);
}

function ageEfetivo(diasAtraso, offsetReal) {
  if (diasAtraso == null) return null;
  const n = diasAtraso + offsetReal;
  return n >= 0 && n <= 7 ? `D${n}` : null;
}

// { instalacao, servico, me, reparo } -> dias desde a última carga (null se nunca
// enviado) -- exposto pra rota avisar na tela quando a base está desatualizada,
// usando a MESMA conta que ageEfetivo usa por baixo (uma só fonte de verdade).
async function getDiasAtrasoCotas() {
  const entradas = await Promise.all(TIPOS.map(async tipo => {
    const tabela = tabelaDoTipo(tipo);
    await criarTabela(tabela);
    return [tipo, await diasDesdeCarga(tabela)];
  }));
  return Object.fromEntries(entradas);
}

// Cotas de "hoje de verdade" por bucket + janela de um tipo: a COTAS D0 e o
// Status da tela vêm daqui. Em vez de fixar AGE='D0', usa `ageEfetivo` pra achar
// a linha do arquivo que representa o dia de hoje mesmo se a base estiver
// atrasada (ver comentário acima). Agrega (SUM/MAX) por segurança caso um bucket
// tenha mais de uma linha na mesma janela (ex.: tecnologias diferentes) — pros 14
// buckets de GOIANIA hoje é 1 linha só, então a agregação é inofensiva.
async function getCotasD0(tipo) {
  const tabela = tabelaDoTipo(tipo);
  await criarTabela(tabela);
  const age = ageEfetivo(await diasDesdeCarga(tabela), 0);
  if (!age) return [];
  const [rows] = await pool.query(
    `SELECT BUCKET AS bucket, TIME_SLOT AS timeSlot,
            MAX(STATUS) AS status,
            SUM(COTA_ABERTA) AS cotaAberta,
            SUM(COTA_USADA) AS cotaUsada
     FROM \`${tabela}\`
     WHERE AGE = ?
     GROUP BY BUCKET, TIME_SLOT`,
    [age]
  );
  return rows;
}

// Cotas dos 7 dias reais seguintes (D1..D7 de verdade, não do arquivo) por bucket
// + janela + dia: alimenta a página de projeção /projecao-d1-d7. Pra cada offset
// real 1..7, acha o AGE do arquivo que representa aquele dia (`ageEfetivo`) e já
// devolve `age` REESCRITO pro rótulo real (D1..D7 relativo a hoje) -- assim a rota
// (que agrupa por `r.age`) não precisa saber nada sobre o atraso da carga. Se o
// atraso empurrar um offset pra fora de D0..D7, aquele dia simplesmente não entra
// no resultado (sem dado, em vez de dado errado). Ao contrário de getCotasD0, NÃO
// agrega por bucket sozinho -- devolve uma linha por bucket+janela+dia pra rota
// decidir como resumir (ex.: status pode divergir entre janelas do mesmo bucket).
async function getCotasD1aD7(tipo) {
  const tabela = tabelaDoTipo(tipo);
  await criarTabela(tabela);
  const atraso = await diasDesdeCarga(tabela);
  if (atraso == null) return [];

  const offsetPorAge = {};
  for (let offsetReal = 1; offsetReal <= 7; offsetReal++) {
    const age = ageEfetivo(atraso, offsetReal);
    if (age) offsetPorAge[age] = offsetReal;
  }
  const ages = Object.keys(offsetPorAge);
  if (ages.length === 0) return [];

  const [rows] = await pool.query(
    `SELECT BUCKET AS bucket, TIME_SLOT AS timeSlot, AGE AS age,
            MAX(STATUS) AS status,
            SUM(COTA_ABERTA) AS cotaAberta,
            SUM(COTA_USADA) AS cotaUsada
     FROM \`${tabela}\`
     WHERE AGE IN (${ages.map(() => '?').join(',')})
     GROUP BY BUCKET, TIME_SLOT, AGE`,
    ages
  );
  return rows.map(r => ({ ...r, age: `D${offsetPorAge[r.age]}` }));
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
  getCotasD1aD7,
  getDatasCargaCotas,
  getDiasAtrasoCotas,
  parseXlsx,
  TIPOS,
};
