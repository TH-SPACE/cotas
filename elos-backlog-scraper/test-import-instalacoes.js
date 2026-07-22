// Testa o parser + upload de Instalacoes no MariaDB LOCAL, sem precisar do
// Puppeteer nem do Elos. Usa fixtures/instalacoes-sample.csv (uma fatia real de
// um export do Elos) e sobe para um banco de teste separado (nao mexe no seu
// banco `indicadores` de verdade).
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

  process.env.DB_NAME = TEST_DB;

  const setupConn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: TEST_DB
  });
  const { criarTabelaInstalacoes } = require('./schema');
  const table = process.env.INSTALACOES_TABLE || 'backlog_instalacoes';
  await criarTabelaInstalacoes(setupConn, table);
  await setupConn.end();

  const { importarArquivo, DB_COLUMNS, REGIOES_VALIDAS } = require('./importInstalacoes');
  const conn = require('./db');

  const arquivoFixture = path.join(__dirname, 'fixtures', 'instalacoes-sample.csv');
  console.log(`Banco de teste: ${TEST_DB}`);
  console.log(`Regioes filtradas: ${REGIOES_VALIDAS.join(', ')}`);
  console.log(`Colunas mapeadas: ${DB_COLUMNS.length}`);
  console.log('Importando fixture...');

  const stats = await importarArquivo(arquivoFixture);
  console.log('Resultado da importacao:', stats);

  const [[{ total }]] = await (await conn).query(`SELECT COUNT(*) as total FROM \`${table}\``);
  const [porRegional] = await (await conn).query(
    `SELECT REGIONAL, COUNT(*) as total FROM \`${table}\` GROUP BY REGIONAL`
  );
  const [duplicadosChave] = await (await conn).query(
    `SELECT NUMERO_OS, RPON, COUNT(*) as total FROM \`${table}\` GROUP BY NUMERO_OS, RPON HAVING total > 1 LIMIT 5`
  );
  const [[amostra]] = await (await conn).query(
    `SELECT NUMERO_OS, RPON, REGIONAL, DETAIL, DATA_ABERTURA, ARQUIVO_ORIGEM, IMPORTADO_EM FROM \`${table}\` LIMIT 1`
  );

  console.log(`\nTotal de linhas na tabela ${table}: ${total}`);
  console.log('Distribuicao por REGIONAL:', porRegional);
  console.log('Linhas com NUMERO_OS+RPON repetido (deveria ser vazio):', duplicadosChave);
  console.log('Exemplo de registro (confira acentuacao em DETAIL):', amostra);

  await (await conn).end();
}

main().catch((err) => {
  console.error('Erro no teste:', err);
  process.exit(1);
});
