require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/db');

const FILE_PATH = path.join(__dirname, '..', 'data', 'deparabucket.txt');

// Collation alinhada com backlog_elos.ARMARIO (utf8mb4_general_ci) para permitir JOIN
// sem erro "Illegal mix of collations" — o default do banco é utf8mb4_uca1400_ai_ci.
const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS depara_bucket (
    ARMARIO VARCHAR(50) NOT NULL,
    BKT VARCHAR(100) NOT NULL,
    ALIADA VARCHAR(50) NOT NULL,
    ATUALIZADO_EM DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (ARMARIO),
    KEY idx_bkt (BKT),
    KEY idx_aliada (ALIADA)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
`;

function parseDeparaFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(line => line.trim().length > 0);
  const [, ...dataLines] = lines; // drop header row (ARMARIO / BKT / ALIADA)

  return dataLines.map(line => {
    const [armario, bkt, aliada] = line.split('\t').map(v => (v || '').trim());
    return { armario, bkt, aliada };
  }).filter(row => row.armario);
}

async function importDepara() {
  const rows = parseDeparaFile(FILE_PATH);
  console.log(`Lidas ${rows.length} linhas de ${path.basename(FILE_PATH)}`);

  const conn = await pool.getConnection();
  try {
    await conn.query(CREATE_TABLE_SQL);

    await conn.beginTransaction();
    let upserted = 0;
    for (const row of rows) {
      await conn.query(
        `INSERT INTO depara_bucket (ARMARIO, BKT, ALIADA) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE BKT = VALUES(BKT), ALIADA = VALUES(ALIADA)`,
        [row.armario, row.bkt, row.aliada]
      );
      upserted += 1;
    }
    await conn.commit();
    console.log(`Importação concluída: ${upserted} armários gravados em depara_bucket.`);

    const [[{ total }]] = await conn.query('SELECT COUNT(*) as total FROM depara_bucket');
    console.log(`Total atual na tabela depara_bucket: ${total}`);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  importDepara()
    .then(() => pool.end())
    .catch(err => {
      console.error('Falha na importação:', err);
      process.exit(1);
    });
}

module.exports = { importDepara, parseDeparaFile };
