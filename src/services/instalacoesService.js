const pool = require('../db');
const { CLUSTER_ESCOPO, SPECIFICATION_TYPE_INSTALACAO } = require('./instalacaoBucketService');
const {
  SPECIFICATION_TYPE_EXCLUIDOS: SERVICO_SPECIFICATION_TYPE_EXCLUIDOS,
  SPECIFICATION_PRODUCT_PREFIXO_EXCLUIDO_TEXTO: SERVICO_SPECIFICATION_PRODUCT_PREFIXO_EXCLUIDO_TEXTO,
} = require('./servicoBucketService');
const { SPECIFICATION_PRODUCT_CONTEM_TEXTO: ME_SPECIFICATION_PRODUCT_CONTEM_TEXTO } = require('./meBucketService');

// Ordem e nomes exatos do cabeçalho do export diário do ELOS (BackLogDiario_*.csv,
// pipe-delimited, ISO-8859-1/latin1). Se o ELOS mudar o layout, a importação falha
// cedo (ver parseCsv) em vez de gravar dado desalinhado.
const COLUNAS = [
  'NUMERO_OS', 'STATUS', 'STATUS_REASON', 'DATA_STATUS', 'ARMARIO', 'STREETNAME', 'STATEORPROVINCE', 'POSTCODE', 'CNL', 'NEIGHBORDHOOD',
  'CATEGORIZES_TYPE', 'SPECIFICATION_TYPE', 'SPECIFICATION_PRODUCT', 'DETAIL', 'DATA_ABERTURA', 'DATA_VENCIMENTO', 'TIME_SLOT', 'PHYSICALRESOURCESUMMARY', 'TELEPHONENUMERIC', 'DESIGNATOR',
  'CIDADE', 'CLUSTER_', 'REGIONAL', 'CUSTOMER_DOCUMENTNUMERIC', 'CUSTOMER_NAME', 'EXECUTEDBYLOGIN', 'EXECUTEDBYNAME', 'NOTDONEREASON', 'PRIORITY', 'SCHEDULEPROFILE',
  'CUSTOMER_SEGMENT', 'CUSTOMER_TEMPERATURE', 'CUSTOMER_RANK', 'SEGMENTACAO', 'SERVICE_TECHNOLOGY', 'SPECIFICATION_ACRONYM', 'PORTABILITY_STATUS', 'PORTABILITY_START', 'PORTABILITY_END', 'REDESPACHO',
  'DATEOFSTATUSPORTABILITY', 'DATEOFSTATUSEXECUTION', 'CONTRACTOR', 'PON', 'RPON', 'AGENDADO_NA_VENDA', 'VELOCIDADEADSL', 'DATA_AGENDADA', 'DTH_PURO', 'TOTAL_PONTO_ADICIONAL',
  'PACOTE_TV', 'FLAG_GPON', 'DATA_CANCELAMENTO', 'LOGIN_CANCELAMENTO', 'MOTIVO_DE_CANCELAMENTO', 'OBSERVACAO', 'REDE', 'MICROAREA', 'TELEPHONIC_AREA', 'CENTRAL_OFFICE',
  'TECNOLOGIA_ACESSO', 'DESIGNADOR_TV', 'DTH_CONECTADO', 'PRODUTOS_ADICIONAR', 'PRODUTOS_MODIFICAR', 'PRODUTOS_ATIVO', 'PRODUTOS_DESCONECTAR', 'DATA_CARGA', 'DATA_LAST_UPDATE_PLWO', 'TECNOLOGIA_TV',
  'LATITUDE', 'LONGITUDE', 'CLIENTE_GOAS', 'MARCACAO_VIA_CHAT', 'PLATFORM', 'EXCECAO_ATUAL', 'EXCECAO_ATUAL_ATIVIDADE', 'EXCECAO_ATUAL_GRUPO', 'RECUSA_ANTECIPAR', 'DATA_COMPROMISSO',
  'DATA_PRIMEIRA_AGENDA', 'DESC_GRUPO_RESPONSABILIDADE', 'DESC_CANAL', 'DESC_GRUPO_CANAL', 'FLAG_CANAL_ATENDIMENTO', 'FLAG_VENDE_INSTALA', 'CLIENTES_V_SAV', 'NOM_SISTEMA_ORIGEM', 'FLAG_MATRIX', 'FLAG_EVEREST',
  'FLAG_MT24H', 'FLAG_PRD_ALTA', 'ID_PRD_ULT_DESC', 'DESIGNADOR_ACESSO', 'FLAG_CASAINTELIGENTE', 'PARENT1', 'PARENT2', 'PARENT3', 'PARENT4', 'FLAG_FIBRATODOS',
  'FLAG_ANATEL', 'FLAG_RIFAINA',
];

// Únicas colunas usadas em filtro/JOIN por enquanto (ver KEYs abaixo) — ficam
// VARCHAR curto. Todo o resto vira TEXT: com 102 colunas, mesmo VARCHAR(50) em
// todas estourava o limite de row size do InnoDB (colunas VARCHAR pequenas ficam
// inline na linha; só TEXT tem 0 bytes de prefixo inline, ou seja, sempre pode ir
// para página de overflow — é a própria recomendação do erro do MariaDB).
const COLUNAS_VARCHAR_CURTO = new Set([
  'NUMERO_OS', 'ARMARIO', 'CLUSTER_', 'REGIONAL', 'STATUS', 'SPECIFICATION_TYPE',
]);

function tipoColuna(nome) {
  return COLUNAS_VARCHAR_CURTO.has(nome) ? 'VARCHAR(30)' : 'TEXT';
}

const BATCH_SIZE = 500;

// NUMERO_OS não é único no arquivo (ex.: Mudança de Endereço gera 2 linhas com a
// mesma OS — uma de DESCONEXAO e outra de INSTALACAO/ALTERACAO), então a tabela usa
// ID auto-increment como chave. Collation utf8mb4_general_ci para permitir JOIN
// futuro com backlog_elos/depara_bucket sem erro de mix de collations.
function montarCreateTableSql() {
  const colunasSql = COLUNAS
    .map(nome => `\`${nome}\` ${tipoColuna(nome)}`)
    .join(',\n    ');

  return `
    CREATE TABLE IF NOT EXISTS backlog_instalacoes (
      ID INT AUTO_INCREMENT PRIMARY KEY,
      ${colunasSql},
      ARQUIVO_ORIGEM VARCHAR(255) NOT NULL,
      IMPORTADO_EM DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_numero_os (NUMERO_OS),
      KEY idx_armario (ARMARIO),
      KEY idx_cluster (CLUSTER_),
      KEY idx_regional (REGIONAL),
      KEY idx_status (STATUS),
      KEY idx_specification_type (SPECIFICATION_TYPE)
    ) ENGINE=InnoDB ROW_FORMAT=DYNAMIC DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `;
}

// O export do ELOS vem em ISO-8859-1 (acentos quebram se lido como utf8).
function parseCsv(buffer) {
  const texto = buffer.toString('latin1');
  const linhas = texto.split(/\r?\n/).filter(linha => linha.trim().length > 0);

  if (linhas.length === 0) {
    throw new Error('Arquivo vazio.');
  }

  const cabecalho = linhas[0].split('|').map(v => v.trim());
  const cabecalhoValido =
    cabecalho.length === COLUNAS.length &&
    cabecalho.every((nome, i) => nome === COLUNAS[i]);

  if (!cabecalhoValido) {
    throw new Error(
      `Layout do arquivo não confere com o esperado (${cabecalho.length} colunas encontradas, ${COLUNAS.length} esperadas). ` +
      'O ELOS pode ter mudado o formato do export — confira o cabeçalho do CSV.'
    );
  }

  return linhas.slice(1).map(linha => {
    const campos = linha.split('|');
    return COLUNAS.map((_, i) => (campos[i] !== undefined ? campos[i] : ''));
  });
}

// Peso de PU por SPECIFICATION_PRODUCT (ex.: BANDA LARGA, LINHA + BANDA...) — cada
// produto pesa diferente no cálculo de PU/Técnicos do painel de Instalações, ao
// contrário do painel de Reparos que usa um PU único pra tudo.
const CREATE_TABLE_PU_PRODUTO_SQL = `
  CREATE TABLE IF NOT EXISTS depara_pu_produto (
    SPECIFICATION_PRODUCT VARCHAR(100) NOT NULL,
    PU DECIMAL(6,2) NOT NULL DEFAULT 0,
    ATUALIZADO_EM DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (SPECIFICATION_PRODUCT)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
`;

// Mesma ideia da tabela acima, só que pro recorte de Serviços (peso de PU pode ser
// diferente do mesmo produto usado em Instalações — ex.: "BANDA LARGA" nova
// instalação normalmente exige mais esforço que "BANDA LARGA" como alteração).
const CREATE_TABLE_PU_PRODUTO_SERVICO_SQL = `
  CREATE TABLE IF NOT EXISTS depara_pu_produto_servico (
    SPECIFICATION_PRODUCT VARCHAR(100) NOT NULL,
    PU DECIMAL(6,2) NOT NULL DEFAULT 0,
    ATUALIZADO_EM DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (SPECIFICATION_PRODUCT)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
`;

// Mesma ideia, pro recorte de ME (Mudança de Endereço).
const CREATE_TABLE_PU_PRODUTO_ME_SQL = `
  CREATE TABLE IF NOT EXISTS depara_pu_produto_me (
    SPECIFICATION_PRODUCT VARCHAR(100) NOT NULL,
    PU DECIMAL(6,2) NOT NULL DEFAULT 0,
    ATUALIZADO_EM DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (SPECIFICATION_PRODUCT)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
`;

const INDICE_SPECIFICATION_PRODUCT = COLUNAS.indexOf('SPECIFICATION_PRODUCT');
const INDICE_SPECIFICATION_TYPE = COLUNAS.indexOf('SPECIFICATION_TYPE');
const INDICE_CLUSTER = COLUNAS.indexOf('CLUSTER_');

// Cadastra com PU=0 (== "ainda não configurado") qualquer SPECIFICATION_PRODUCT que
// apareça no arquivo e ainda não tenha linha em depara_pu_produto. O aviso de "quem
// está com PU=0 agora" não depende deste momento do upload — a página recalcula isso
// toda vez que carrega, a partir da tabela (ver views/index.ejs), pra não sumir depois
// que o usuário navega pra longe do redirect do upload.
// Só olha o recorte que o painel de Instalações realmente usa (GOIANIA + INSTALAÇÃO):
// os outros SPECIFICATION_TYPE do mesmo CSV (ALTERAÇÃO/DESCONEXÃO/...) não entram no
// cálculo de PU de instalações, então não faz sentido pedir PU pra eles aqui.
async function sincronizarPuProdutos(conn, linhas) {
  await conn.query(CREATE_TABLE_PU_PRODUTO_SQL);

  const produtosNoArquivo = [...new Set(
    linhas
      .filter(linha =>
        linha[INDICE_CLUSTER] === CLUSTER_ESCOPO &&
        linha[INDICE_SPECIFICATION_TYPE] === SPECIFICATION_TYPE_INSTALACAO
      )
      .map(linha => linha[INDICE_SPECIFICATION_PRODUCT])
      .filter(Boolean)
  )];

  for (const produto of produtosNoArquivo) {
    await conn.query(
      'INSERT IGNORE INTO depara_pu_produto (SPECIFICATION_PRODUCT, PU) VALUES (?, 0)',
      [produto]
    );
  }
}

// Mesma lógica de sincronizarPuProdutos, só que pro recorte de Serviços: tudo que
// não é INSTALAÇÃO nem DESCONEXÃO, excluindo produtos de Mudança de Endereço.
async function sincronizarPuProdutosServicos(conn, linhas) {
  await conn.query(CREATE_TABLE_PU_PRODUTO_SERVICO_SQL);

  const produtosNoArquivo = [...new Set(
    linhas
      .filter(linha =>
        linha[INDICE_CLUSTER] === CLUSTER_ESCOPO &&
        !SERVICO_SPECIFICATION_TYPE_EXCLUIDOS.includes(linha[INDICE_SPECIFICATION_TYPE]) &&
        !linha[INDICE_SPECIFICATION_PRODUCT].startsWith(SERVICO_SPECIFICATION_PRODUCT_PREFIXO_EXCLUIDO_TEXTO)
      )
      .map(linha => linha[INDICE_SPECIFICATION_PRODUCT])
      .filter(Boolean)
  )];

  for (const produto of produtosNoArquivo) {
    await conn.query(
      'INSERT IGNORE INTO depara_pu_produto_servico (SPECIFICATION_PRODUCT, PU) VALUES (?, 0)',
      [produto]
    );
  }
}

// Mesma lógica de sincronizarPuProdutos, só que pro recorte de ME: qualquer
// SPECIFICATION_PRODUCT que contenha "MUDANÇA DE ENDEREÇO" (sem restrição de
// SPECIFICATION_TYPE — ALTERAÇÃO e DESCONEXÃO contam as duas).
async function sincronizarPuProdutosMe(conn, linhas) {
  await conn.query(CREATE_TABLE_PU_PRODUTO_ME_SQL);

  const produtosNoArquivo = [...new Set(
    linhas
      .filter(linha =>
        linha[INDICE_CLUSTER] === CLUSTER_ESCOPO &&
        linha[INDICE_SPECIFICATION_PRODUCT].includes(ME_SPECIFICATION_PRODUCT_CONTEM_TEXTO)
      )
      .map(linha => linha[INDICE_SPECIFICATION_PRODUCT])
      .filter(Boolean)
  )];

  for (const produto of produtosNoArquivo) {
    await conn.query(
      'INSERT IGNORE INTO depara_pu_produto_me (SPECIFICATION_PRODUCT, PU) VALUES (?, 0)',
      [produto]
    );
  }
}

async function inserirBatch(conn, nomeArquivo, linhas) {
  const colunasSql = COLUNAS.map(c => `\`${c}\``).join(',');
  const placeholderLinha = '(' + Array(COLUNAS.length + 1).fill('?').join(',') + ')';
  const placeholders = Array(linhas.length).fill(placeholderLinha).join(',');
  const valores = linhas.flatMap(linha => [...linha, nomeArquivo]);

  await conn.query(
    `INSERT INTO backlog_instalacoes (${colunasSql}, ARQUIVO_ORIGEM) VALUES ${placeholders}`,
    valores
  );
}

async function importarInstalacoes(buffer, nomeArquivo) {
  const linhas = parseCsv(buffer);

  const conn = await pool.getConnection();
  try {
    await conn.query(montarCreateTableSql());

    await conn.beginTransaction();
    await conn.query('TRUNCATE TABLE backlog_instalacoes');

    for (let i = 0; i < linhas.length; i += BATCH_SIZE) {
      await inserirBatch(conn, nomeArquivo, linhas.slice(i, i + BATCH_SIZE));
    }

    await sincronizarPuProdutos(conn, linhas);
    await sincronizarPuProdutosServicos(conn, linhas);
    await sincronizarPuProdutosMe(conn, linhas);

    await conn.commit();
    return { totalLinhas: linhas.length };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Data da última carga do ELOS pro backlog_instalacoes inteiro (mesma coluna
// DATA_CARGA do export, compartilhada pelos painéis de Instalações e Serviços já
// que os dois leem da mesma tabela/upload).
async function getDataCargaInstalacoes() {
  const [rows] = await pool.query(
    `SELECT MAX(STR_TO_DATE(DATA_CARGA, '%d/%m/%Y %H:%i:%s')) AS dataCarga FROM backlog_instalacoes`
  );
  return rows[0].dataCarga;
}

module.exports = { importarInstalacoes, parseCsv, COLUNAS, getDataCargaInstalacoes };
