const pool = require('../db');

// depara_tempo_bucket é UMA tabela só (1 linha por bucket, colunas INSTALACAO/
// SERVICO/ALTERACAO/REPARO) -- antes cada painel (Instalação/Serviço/ME/Reparo)
// lia e gravava só a própria coluna, com uma query separada repetindo os mesmos
// buckets 4x na página de Configurações. Aqui é uma leitura e uma gravação só,
// reaproveitada pelas 4 seções.
async function getTemposBucket() {
  const [rows] = await pool.query(
    `SELECT ALIADA AS aliada, BUCKET AS bucket,
            INSTALACAO AS instalacao, SERVICO AS servico, ALTERACAO AS alteracao, REPARO AS reparo
     FROM depara_tempo_bucket
     ORDER BY ALIADA, BUCKET`
  );

  return rows;
}

// Atualiza por BUCKET (não pelo par ALIADA+BUCKET) porque o nome do bucket já é
// único na tabela e a ALIADA de origem pode divergir de depara_bucket (ex.: BKT_ITABERAI).
async function atualizarTemposBucket(atualizacoes) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const { bucket, instalacao, servico, alteracao, reparo } of atualizacoes) {
      await conn.query(
        `UPDATE depara_tempo_bucket SET INSTALACAO = ?, SERVICO = ?, ALTERACAO = ?, REPARO = ? WHERE BUCKET = ?`,
        [instalacao, servico, alteracao, reparo, bucket]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { getTemposBucket, atualizarTemposBucket };
