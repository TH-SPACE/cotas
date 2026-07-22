// Testa o parser + upload no MariaDB LOCAL, sem precisar do Puppeteer nem do Elos.
// Usa fixtures/backlog-sample.csv (uma fatia real de um export do Elos) e sobe
// para um banco de teste separado (nao mexe no seu banco `indicadores` de verdade).
require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');

const TEST_DB = process.env.TEST_DB_NAME || 'elos_scraper_test';

async function garantirBancoDeTeste() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\``);
  await conn.end();
}

async function main() {
  await garantirBancoDeTeste();

  // Aponta DB_NAME para o banco de teste ANTES de carregar os modulos que
  // abrem a conexao (db.js/importBacklog.js leem process.env na hora do require).
  process.env.DB_NAME = TEST_DB;

  // setup-db.js roda e sai (process.exit) sozinho, entao criamos a tabela aqui
  // reaproveitando uma conexao direta, igual ao setup-db.js faz.
  const setupConn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: TEST_DB
  });
  const { criarTabelaBacklog } = require('./schema');
  await criarTabelaBacklog(setupConn, process.env.BACKLOG_TABLE || 'backlog_elos');
  await setupConn.end();

  const { importarArquivo, DB_COLUMNS, REGIOES_VALIDAS } = require('./importBacklog');
  const conn = require('./db');

  const arquivoFixture = path.join(__dirname, 'fixtures', 'backlog-sample.csv');
  console.log(`Banco de teste: ${TEST_DB}`);
  console.log(`Regioes filtradas: ${REGIOES_VALIDAS.join(', ')}`);
  console.log(`Colunas mapeadas: ${DB_COLUMNS.length}`);
  console.log('Importando fixture...');

  const stats = await importarArquivo(arquivoFixture);
  console.log('Resultado da importacao:', stats);

  const table = process.env.BACKLOG_TABLE || 'backlog_elos';
  const [[{ total }]] = await (await conn).query(`SELECT COUNT(*) as total FROM \`${table}\``);
  const [porRegional] = await (await conn).query(
    `SELECT REGIONAL, COUNT(*) as total FROM \`${table}\` GROUP BY REGIONAL`
  );
  const [[amostra]] = await (await conn).query(
    `SELECT COD_SS, REGIONAL, DETAIL, DATA_ABERTURA, STATUS_GOPER FROM \`${table}\` LIMIT 1`
  );

  console.log(`\nTotal de linhas na tabela ${table}: ${total}`);
  console.log('Distribuicao por REGIONAL:', porRegional);
  console.log('Exemplo de registro (confira acentuacao em DETAIL):', amostra);

  await (await conn).end();
}

main().catch((err) => {
  console.error('Erro no teste:', err);
  process.exit(1);
});
