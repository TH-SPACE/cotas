const pool = require('../db');

// Mesmo escopo dos painéis de Reparos/Instalações.
const CLUSTER_ESCOPO = 'GOIANIA';

// "Serviço" aqui = tudo em backlog_instalacoes que NÃO é instalação nem desconexão
// (sobra ALTERAÇÃO/UPGRADE/DOWNGRADE), excluindo também qualquer produto de
// Mudança de Endereço (que é ALTERAÇÃO/DESCONEXÃO só por causa da troca de
// endereço, não um serviço de verdade). Esse recorte não é selecionável no front —
// só STATUS, STATUS_REASON e TECNOLOGIA_ACESSO são.
const SPECIFICATION_TYPE_EXCLUIDOS = ['INSTALAÇÃO', 'DESCONEXÃO'];
// Prefixo puro (pra checagem em JS, ex.: String.startsWith) e a versão com
// curinga SQL (pra cláusula LIKE) — mesma ideia, dois formatos de uso.
const SPECIFICATION_PRODUCT_PREFIXO_EXCLUIDO_TEXTO = 'MUDANÇA DE ENDEREÇO';
const SPECIFICATION_PRODUCT_PREFIXO_EXCLUIDO = `${SPECIFICATION_PRODUCT_PREFIXO_EXCLUIDO_TEXTO}%`;

// Valores pré-marcados nos filtros do front na primeira carga (mesma convenção de
// Instalações: fora CANCELADA/ENCERRADA/EXECUCAO, fora motivo ENRIQUECIMENTO, só GPON).
const STATUS_EXCLUIDOS_PADRAO = ['CANCELADA', 'ENCERRADA', 'EXECUCAO'];
const STATUS_REASON_EXCLUIDOS_PADRAO = ['ENRIQUECIMENTO'];
const TECNOLOGIA_ACESSO_PADRAO = ['GPON'];

// Mesmo bucket "curinga" dos outros painéis: ARD (ARMARIO) sem linha em
// depara_bucket cai na VIVO / BKT_GOIANIA.
const ALIADA_CURINGA = 'VIVO';
const BUCKET_CURINGA = 'BKT_GOIANIA';

const ESCOPO_SQL = `
  CLUSTER_ = ?
  AND SPECIFICATION_TYPE NOT IN (?, ?)
  AND SPECIFICATION_PRODUCT NOT LIKE ?
`;
const ESCOPO_PARAMS_BASE = [CLUSTER_ESCOPO, ...SPECIFICATION_TYPE_EXCLUIDOS, SPECIFICATION_PRODUCT_PREFIXO_EXCLUIDO];

// Valores distintos de STATUS/STATUS_REASON/TECNOLOGIA_ACESSO hoje na base (escopo
// de Serviços), para montar os filtros no front sem hardcodar os valores.
async function getFiltrosDisponiveisServicos() {
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

async function getResumoBucketsServicos(filtros) {
  const { status, statusReason, tecnologiaAcesso } = filtros;

  // Mesmo raciocínio de Instalações: PU vem do peso por SPECIFICATION_PRODUCT
  // (depara_pu_produto_servico), somado ticket-a-ticket em puBrutoTotal.
  const [rows] = await pool.query(
    `SELECT aliada, bucket, backlogServicos, puBrutoTotal, tempoServicoMinutos FROM (
       SELECT
         d.ALIADA AS aliada,
         d.BKT AS bucket,
         COUNT(i.ID) AS backlogServicos,
         COALESCE(SUM(p.PU), 0) AS puBrutoTotal,
         COALESCE(t.SERVICO, 0) AS tempoServicoMinutos
       FROM depara_bucket d
       LEFT JOIN backlog_instalacoes i
         ON i.ARMARIO = d.ARMARIO
         AND i.CLUSTER_ = ?
         AND i.SPECIFICATION_TYPE NOT IN (?, ?)
         AND i.SPECIFICATION_PRODUCT NOT LIKE ?
         AND i.STATUS IN (?)
         AND i.STATUS_REASON IN (?)
         AND i.TECNOLOGIA_ACESSO IN (?)
       LEFT JOIN depara_pu_produto_servico p ON p.SPECIFICATION_PRODUCT = i.SPECIFICATION_PRODUCT
       LEFT JOIN depara_tempo_bucket t
         ON t.BUCKET = d.BKT
       GROUP BY d.ALIADA, d.BKT, t.SERVICO

       UNION ALL

       SELECT
         ? AS aliada,
         ? AS bucket,
         COUNT(i.ID) AS backlogServicos,
         COALESCE(SUM(p.PU), 0) AS puBrutoTotal,
         COALESCE(MAX(t.SERVICO), 0) AS tempoServicoMinutos
       FROM backlog_instalacoes i
       LEFT JOIN depara_bucket d ON d.ARMARIO = i.ARMARIO
       LEFT JOIN depara_pu_produto_servico p ON p.SPECIFICATION_PRODUCT = i.SPECIFICATION_PRODUCT
       LEFT JOIN depara_tempo_bucket t ON t.BUCKET = ?
       WHERE d.ARMARIO IS NULL
         AND i.CLUSTER_ = ?
         AND i.SPECIFICATION_TYPE NOT IN (?, ?)
         AND i.SPECIFICATION_PRODUCT NOT LIKE ?
         AND i.STATUS IN (?)
         AND i.STATUS_REASON IN (?)
         AND i.TECNOLOGIA_ACESSO IN (?)
         AND i.ARMARIO IS NOT NULL AND i.ARMARIO <> ''
     ) resumo
     ORDER BY aliada, bucket`,
    [
      CLUSTER_ESCOPO, ...SPECIFICATION_TYPE_EXCLUIDOS, SPECIFICATION_PRODUCT_PREFIXO_EXCLUIDO, status, statusReason, tecnologiaAcesso,
      ALIADA_CURINGA, BUCKET_CURINGA, BUCKET_CURINGA,
      CLUSTER_ESCOPO, ...SPECIFICATION_TYPE_EXCLUIDOS, SPECIFICATION_PRODUCT_PREFIXO_EXCLUIDO, status, statusReason, tecnologiaAcesso,
    ]
  );

  const totalGeral = rows.reduce((acc, row) => acc + row.backlogServicos, 0);

  return { linhas: rows, totalGeral };
}

async function getPuProdutosServicos() {
  const [rows] = await pool.query(
    `SELECT SPECIFICATION_PRODUCT AS produto, PU AS pu
     FROM depara_pu_produto_servico
     ORDER BY SPECIFICATION_PRODUCT`
  );

  return rows;
}

async function atualizarPuProdutosServicos(atualizacoes) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const { produto, pu } of atualizacoes) {
      await conn.query(
        `UPDATE depara_pu_produto_servico SET PU = ? WHERE SPECIFICATION_PRODUCT = ?`,
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

async function getTemposServicos() {
  const [rows] = await pool.query(
    `SELECT ALIADA AS aliada, BUCKET AS bucket, SERVICO AS servico
     FROM depara_tempo_bucket
     ORDER BY ALIADA, BUCKET`
  );

  return rows;
}

async function atualizarTemposServicos(atualizacoes) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const { bucket, servico } of atualizacoes) {
      await conn.query(
        `UPDATE depara_tempo_bucket SET SERVICO = ? WHERE BUCKET = ?`,
        [servico, bucket]
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
  getResumoBucketsServicos,
  getTemposServicos,
  atualizarTemposServicos,
  getFiltrosDisponiveisServicos,
  getPuProdutosServicos,
  atualizarPuProdutosServicos,
  STATUS_EXCLUIDOS_PADRAO,
  STATUS_REASON_EXCLUIDOS_PADRAO,
  TECNOLOGIA_ACESSO_PADRAO,
  CLUSTER_ESCOPO,
  SPECIFICATION_TYPE_EXCLUIDOS,
  SPECIFICATION_PRODUCT_PREFIXO_EXCLUIDO,
  SPECIFICATION_PRODUCT_PREFIXO_EXCLUIDO_TEXTO,
};
