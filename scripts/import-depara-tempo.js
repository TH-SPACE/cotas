require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/db');

const FILE_PATH = path.join(__dirname, '..', 'data', 'deparatempo.txt');

// Mesma collation de depara_bucket (utf8mb4_general_ci) para permitir JOIN futuro por
// BUCKET/ALIADA sem "Illegal mix of collations" — o default do banco é utf8mb4_uca1400_ai_ci.
const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS depara_tempo_bucket (
    ALIADA VARCHAR(50) NOT NULL,
    BUCKET VARCHAR(100) NOT NULL,
    INSTALACAO INT NOT NULL,
    ALTERACAO INT NOT NULL,
    REPARO INT NOT NULL,
    SERVICO INT NOT NULL,
    ATUALIZADO_EM DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (ALIADA, BUCKET)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
`;

function parseTempoFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(line => line.trim().length > 0);
  const [, ...dataLines] = lines; // drop header (ALIADA / BUCKET / INSTALAÇÃO / ALTERAÇÃO / REPARO / SERVIÇO)

  return dataLines.map(line => {
    const [aliada, bucket, instalacao, alteracao, reparo, servico] = line.split('\t').map(v => (v || '').trim());
    return {
      aliada,
      bucket,
      instalacao: Number(instalacao),
      alteracao: Number(alteracao),
      reparo: Number(reparo),
      servico: Number(servico),
    };
  }).filter(row => row.aliada && row.bucket);
}

async function importDeparaTempo() {
  const rows = parseTempoFile(FILE_PATH);
  console.log(`Lidas ${rows.length} linhas de ${path.basename(FILE_PATH)}`);

  const conn = await pool.getConnection();
  try {
    await conn.query(CREATE_TABLE_SQL);

    await conn.beginTransaction();
    let upserted = 0;
    for (const row of rows) {
      await conn.query(
        `INSERT INTO depara_tempo_bucket (ALIADA, BUCKET, INSTALACAO, ALTERACAO, REPARO, SERVICO)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           INSTALACAO = VALUES(INSTALACAO),
           ALTERACAO = VALUES(ALTERACAO),
           REPARO = VALUES(REPARO),
           SERVICO = VALUES(SERVICO)`,
        [row.aliada, row.bucket, row.instalacao, row.alteracao, row.reparo, row.servico]
      );
      upserted += 1;
    }
    await conn.commit();
    console.log(`Importação concluída: ${upserted} linhas gravadas em depara_tempo_bucket.`);

    const [[{ total }]] = await conn.query('SELECT COUNT(*) as total FROM depara_tempo_bucket');
    console.log(`Total atual na tabela depara_tempo_bucket: ${total}`);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  importDeparaTempo()
    .then(() => pool.end())
    .catch(err => {
      console.error('Falha na importação:', err);
      process.exit(1);
    });
}

module.exports = { importDeparaTempo, parseTempoFile };
