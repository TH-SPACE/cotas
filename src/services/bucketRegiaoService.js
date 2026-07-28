const pool = require('../db');

// Classificação de cada bucket como CAPITAL ou INTERIOR -- usada pra dar
// configuração (Previsto/Carga/Janela/Meta PU) separada por região DENTRO de
// uma mesma aliada (ver configAliadaRegiaoService.js). Bucket sem linha aqui
// é INTERIOR por padrão -- só precisa marcar a(s) exceção(ões) capital, não
// classificar tudo. Chave é só BUCKET (não ALIADA+BUCKET), mesmo motivo do
// depara_tempo_bucket: o nome do bucket já é único e pode divergir da aliada
// de origem em depara_bucket (ex.: BKT_ITABERAI).
const REGIAO_PADRAO = 'INTERIOR';

let tabelaGarantida = false;
async function criarTabela() {
  if (tabelaGarantida) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bucket_regiao (
      BUCKET VARCHAR(50) NOT NULL,
      REGIAO VARCHAR(20) NOT NULL,
      ATUALIZADO_EM DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (BUCKET)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
  tabelaGarantida = true;
}

// Buckets "reais" (com armário mapeado) disponíveis pra classificar -- exclui
// a VIVO, que é o bucket curinga (BKT_GOIANIA, sem armário próprio) e não
// aparece em depara_bucket.
async function getBucketsClassificaveis() {
  const [rows] = await pool.query(
    'SELECT DISTINCT ALIADA AS aliada, BKT AS bucket FROM depara_bucket ORDER BY ALIADA, BKT'
  );
  return rows;
}

// Mapa BUCKET -> 'CAPITAL'|'INTERIOR', só dos buckets classificados.
async function getBucketRegiao() {
  await criarTabela();
  const [rows] = await pool.query('SELECT BUCKET, REGIAO FROM bucket_regiao');

  const mapa = {};
  rows.forEach(r => { mapa[r.BUCKET] = r.REGIAO; });
  return mapa;
}

// Bucket sem classificação cai em INTERIOR.
function regiaoDoBucket(bucket, mapaRegiao) {
  return mapaRegiao[bucket] || REGIAO_PADRAO;
}

// Upsert em lote -- `atualizacoes` = [{ bucket, regiao }].
async function salvarBucketRegiao(atualizacoes) {
  await criarTabela();

  const lista = (atualizacoes || []).filter(a => a && a.bucket && a.regiao);
  if (lista.length === 0) return;

  const placeholders = lista.map(() => '(?, ?)').join(',');
  const params = lista.flatMap(({ bucket, regiao }) => [bucket, regiao]);

  await pool.query(
    `INSERT INTO bucket_regiao (BUCKET, REGIAO) VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE REGIAO = VALUES(REGIAO)`,
    params
  );
}

module.exports = {
  REGIAO_PADRAO,
  getBucketsClassificaveis,
  getBucketRegiao,
  regiaoDoBucket,
  salvarBucketRegiao,
};
