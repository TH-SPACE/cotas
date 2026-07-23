const pool = require('../db');

// Mesmo escopo dos outros painéis de backlog_instalacoes.
const CLUSTER_ESCOPO = 'GOIANIA';

// "ME" (Mudança de Endereço) aqui = qualquer linha cujo SPECIFICATION_PRODUCT
// contenha "MUDANÇA DE ENDEREÇO" — aparecem tanto em SPECIFICATION_TYPE ALTERAÇÃO
// quanto DESCONEXÃO (um par de linhas pro mesmo NUMERO_OS: uma desconecta o
// endereço antigo, outra instala/altera no novo). Diferente de Serviços, aqui NÃO
// há restrição de SPECIFICATION_TYPE — as duas linhas contam, cada uma é uma
// visita técnica separada. Esse recorte não é selecionável no front — só STATUS,
// STATUS_REASON e TECNOLOGIA_ACESSO são.
const SPECIFICATION_PRODUCT_CONTEM_TEXTO = 'MUDANÇA DE ENDEREÇO';
const SPECIFICATION_PRODUCT_CONTEM = `%${SPECIFICATION_PRODUCT_CONTEM_TEXTO}%`;

// Valores pré-marcados nos filtros do front na primeira carga (mesma convenção dos
// outros painéis: fora CANCELADA/ENCERRADA/EXECUCAO, fora motivo ENRIQUECIMENTO, só GPON).
const STATUS_EXCLUIDOS_PADRAO = ['CANCELADA', 'ENCERRADA', 'EXECUCAO'];
const STATUS_REASON_EXCLUIDOS_PADRAO = ['ENRIQUECIMENTO'];
const TECNOLOGIA_ACESSO_PADRAO = ['GPON'];

// Mesmo bucket "curinga" dos outros painéis: ARD (ARMARIO) sem linha em
// depara_bucket cai na VIVO / BKT_GOIANIA.
const ALIADA_CURINGA = 'VIVO';
const BUCKET_CURINGA = 'BKT_GOIANIA';

const ESCOPO_SQL = `CLUSTER_ = ? AND SPECIFICATION_PRODUCT LIKE ?`;
const ESCOPO_PARAMS_BASE = [CLUSTER_ESCOPO, SPECIFICATION_PRODUCT_CONTEM];

// Valores distintos de STATUS/STATUS_REASON/TECNOLOGIA_ACESSO hoje na base (escopo
// de ME), para montar os filtros no front sem hardcodar os valores.
async function getFiltrosDisponiveisMe() {
  const [statusRows] = await pool.query(
    `SELECT DISTINCT STATUS AS valor FROM backlog_instalacoes WHERE ${ESCOPO_SQL} ORDER BY STATUS`,
    ESCOPO_PARAMS_BASE
  );
  const [statusReasonRows] = await pool.query(
    `SELECT DISTINCT STATUS_REASON AS valor FROM backlog_instalacoes WHERE ${ESCOPO_SQL} ORDER BY STATUS_REASON`,
    ESCOPO_PARAMS_BASE
  );
  const [tecnologiaRows] = await pool.query(
    `SELECT DISTINCT TECNOLOGIA_ACESSO AS valor FROM backlog_instalacoes WHERE ${ESCOPO_SQL} AND TECNOLOGIA_ACESSO <> '' ORDER BY TECNOLOGIA_ACESSO`,
    ESCOPO_PARAMS_BASE
  );

  return {
    status: statusRows.map(r => r.valor),
    statusReason: statusReasonRows.map(r => r.valor),
    tecnologiaAcesso: tecnologiaRows.map(r => r.valor),
  };
}

async function getResumoBucketsMe(filtros) {
  const { status, statusReason, tecnologiaAcesso } = filtros;

  // Mesmo raciocínio de Instalações/Serviços: PU vem do peso por
  // SPECIFICATION_PRODUCT (depara_pu_produto_me), somado ticket-a-ticket em
  // puBrutoTotal; tempo por bucket usa a coluna ALTERACAO de depara_tempo_bucket.
  const [rows] = await pool.query(
    `SELECT aliada, bucket, backlogMe, puBrutoTotal, tempoMeMinutos FROM (
       SELECT
         d.ALIADA AS aliada,
         d.BKT AS bucket,
         COUNT(i.ID) AS backlogMe,
         COALESCE(SUM(p.PU), 0) AS puBrutoTotal,
         COALESCE(t.ALTERACAO, 0) AS tempoMeMinutos
       FROM depara_bucket d
       LEFT JOIN backlog_instalacoes i
         ON i.ARMARIO = d.ARMARIO
         AND i.CLUSTER_ = ?
         AND i.SPECIFICATION_PRODUCT LIKE ?
         AND i.STATUS IN (?)
         AND i.STATUS_REASON IN (?)
         AND i.TECNOLOGIA_ACESSO IN (?)
       LEFT JOIN depara_pu_produto_me p ON p.SPECIFICATION_PRODUCT = i.SPECIFICATION_PRODUCT
       LEFT JOIN depara_tempo_bucket t
         ON t.BUCKET = d.BKT
       GROUP BY d.ALIADA, d.BKT, t.ALTERACAO

       UNION ALL

       SELECT
         ? AS aliada,
         ? AS bucket,
         COUNT(i.ID) AS backlogMe,
         COALESCE(SUM(p.PU), 0) AS puBrutoTotal,
         COALESCE(MAX(t.ALTERACAO), 0) AS tempoMeMinutos
       FROM backlog_instalacoes i
       LEFT JOIN depara_bucket d ON d.ARMARIO = i.ARMARIO
       LEFT JOIN depara_pu_produto_me p ON p.SPECIFICATION_PRODUCT = i.SPECIFICATION_PRODUCT
       LEFT JOIN depara_tempo_bucket t ON t.BUCKET = ?
       WHERE d.ARMARIO IS NULL
         AND i.CLUSTER_ = ?
         AND i.SPECIFICATION_PRODUCT LIKE ?
         AND i.STATUS IN (?)
         AND i.STATUS_REASON IN (?)
         AND i.TECNOLOGIA_ACESSO IN (?)
         AND i.ARMARIO IS NOT NULL AND i.ARMARIO <> ''
     ) resumo
     ORDER BY aliada, bucket`,
    [
      CLUSTER_ESCOPO, SPECIFICATION_PRODUCT_CONTEM, status, statusReason, tecnologiaAcesso,
      ALIADA_CURINGA, BUCKET_CURINGA, BUCKET_CURINGA,
      CLUSTER_ESCOPO, SPECIFICATION_PRODUCT_CONTEM, status, statusReason, tecnologiaAcesso,
    ]
  );

  const totalGeral = rows.reduce((acc, row) => acc + row.backlogMe, 0);

  return { linhas: rows, totalGeral };
}

async function getPuProdutosMe() {
  const [rows] = await pool.query(
    `SELECT SPECIFICATION_PRODUCT AS produto, PU AS pu
     FROM depara_pu_produto_me
     ORDER BY SPECIFICATION_PRODUCT`
  );

  return rows;
}

async function atualizarPuProdutosMe(atualizacoes) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const { produto, pu } of atualizacoes) {
      await conn.query(
        `UPDATE depara_pu_produto_me SET PU = ? WHERE SPECIFICATION_PRODUCT = ?`,
        [pu, produto]
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

module.exports = {
  getResumoBucketsMe,
  getFiltrosDisponiveisMe,
  getPuProdutosMe,
  atualizarPuProdutosMe,
  STATUS_EXCLUIDOS_PADRAO,
  STATUS_REASON_EXCLUIDOS_PADRAO,
  TECNOLOGIA_ACESSO_PADRAO,
  CLUSTER_ESCOPO,
  SPECIFICATION_PRODUCT_CONTEM,
  SPECIFICATION_PRODUCT_CONTEM_TEXTO,
};
