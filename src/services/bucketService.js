const pool = require('../db');

// Escopo do projeto é o cluster GOIANIA, não o estado GO inteiro (que também
// inclui armários de ANAPOLIS/BRASILIA fora do depara_bucket).
const CLUSTER_ESCOPO = 'GOIANIA';

// "Reparo" = chamado de defeito (exclui instalação/outros tipos que specification_type possa trazer).
const SPECIFICATION_TYPE_REPARO = 'DEFEITO';

// Bucket "curinga": tudo que não é ABILITY nem ONDACOM (armário sem linha em depara_bucket)
// conta para a VIVO / BKT_GOIANIA — regra definida pelo usuário.
const ALIADA_CURINGA = 'VIVO';
const BUCKET_CURINGA = 'BKT_GOIANIA';

const TECNOLOGIA_PADRAO = ['GPON'];

// Valores pré-marcados nos filtros do front na primeira carga — equivalentes à regra
// fixa antiga (fora CANCELADA/ENCERRADA/EXECUCAO, fora motivo ABERTA MASSIVA). O
// usuário pode mudar cada um livremente depois (ver getFiltrosDisponiveisReparo).
const STATUS_EXCLUIDOS_PADRAO = ['CANCELADA', 'ENCERRADA', 'EXECUCAO'];
const STATUS_REASON_EXCLUIDOS_PADRAO = ['ABERTA MASSIVA'];

async function getResumoBuckets(tecnologias, filtros) {
  const filtroTecnologia = tecnologias.length > 0 ? tecnologias : TECNOLOGIA_PADRAO;
  const { status, statusReason } = filtros;

  const [rows] = await pool.query(
    `SELECT aliada, bucket, backlogReparos, tempoReparoMinutos FROM (
       SELECT
         d.ALIADA AS aliada,
         d.BKT AS bucket,
         COUNT(b.COD_SS) AS backlogReparos,
         COALESCE(t.REPARO, 0) AS tempoReparoMinutos
       FROM depara_bucket d
       LEFT JOIN backlog_elos b
         ON b.ARMARIO = d.ARMARIO
         AND b.CLUSTER_ = ?
         AND b.SPECIFICATION_TYPE = ?
         AND b.PHYSICAL_LINK_MEDIA_TYPE IN (?)
         AND b.STATUS IN (?)
         AND b.STATUS_REASON IN (?)
       LEFT JOIN depara_tempo_bucket t
         ON t.BUCKET = d.BKT
       GROUP BY d.ALIADA, d.BKT, t.REPARO

       UNION ALL

       SELECT
         ? AS aliada,
         ? AS bucket,
         COUNT(b.COD_SS) AS backlogReparos,
         COALESCE(MAX(t.REPARO), 0) AS tempoReparoMinutos
       FROM backlog_elos b
       LEFT JOIN depara_bucket d ON d.ARMARIO = b.ARMARIO
       LEFT JOIN depara_tempo_bucket t ON t.BUCKET = ?
       WHERE d.ARMARIO IS NULL
         AND b.CLUSTER_ = ?
         AND b.SPECIFICATION_TYPE = ?
         AND b.PHYSICAL_LINK_MEDIA_TYPE IN (?)
         AND b.STATUS IN (?)
         AND b.STATUS_REASON IN (?)
         AND b.ARMARIO IS NOT NULL AND b.ARMARIO <> ''
     ) resumo
     ORDER BY aliada, bucket`,
    [
      CLUSTER_ESCOPO, SPECIFICATION_TYPE_REPARO, filtroTecnologia, status, statusReason,
      ALIADA_CURINGA, BUCKET_CURINGA, BUCKET_CURINGA,
      CLUSTER_ESCOPO, SPECIFICATION_TYPE_REPARO, filtroTecnologia, status, statusReason,
    ]
  );

  const totalGeral = rows.reduce((acc, row) => acc + row.backlogReparos, 0);

  return { linhas: rows, totalGeral };
}

// Tecnologias distintas hoje em backlog_elos para o cluster (ex.: GPON, METALICO),
// usadas para montar o filtro — assim o front não precisa hardcodar os valores.
async function getTecnologiasDisponiveis() {
  const [rows] = await pool.query(
    `SELECT DISTINCT PHYSICAL_LINK_MEDIA_TYPE AS tecnologia
     FROM backlog_elos
     WHERE CLUSTER_ = ? AND PHYSICAL_LINK_MEDIA_TYPE <> ''
     ORDER BY PHYSICAL_LINK_MEDIA_TYPE`,
    [CLUSTER_ESCOPO]
  );

  return rows.map(row => row.tecnologia);
}

// Valores distintos de STATUS/STATUS_REASON hoje na base (escopo GOIANIA + DEFEITO),
// para montar os filtros no front sem hardcodar os valores.
async function getFiltrosDisponiveisReparo() {
  const escopo = 'CLUSTER_ = ? AND SPECIFICATION_TYPE = ?';
  const params = [CLUSTER_ESCOPO, SPECIFICATION_TYPE_REPARO];

  const [statusRows] = await pool.query(
    `SELECT DISTINCT STATUS AS valor FROM backlog_elos WHERE ${escopo} ORDER BY STATUS`,
    params
  );
  const [statusReasonRows] = await pool.query(
    `SELECT DISTINCT STATUS_REASON AS valor FROM backlog_elos WHERE ${escopo} ORDER BY STATUS_REASON`,
    params
  );

  return {
    status: statusRows.map(r => r.valor),
    statusReason: statusReasonRows.map(r => r.valor),
  };
}

async function getTemposReparo() {
  const [rows] = await pool.query(
    `SELECT ALIADA AS aliada, BUCKET AS bucket, REPARO AS reparo
     FROM depara_tempo_bucket
     ORDER BY ALIADA, BUCKET`
  );

  return rows;
}

// Atualiza por BUCKET (não pelo par ALIADA+BUCKET) porque o nome do bucket já é
// único na tabela e a ALIADA de origem pode divergir de depara_bucket (ex.: BKT_ITABERAI).
async function atualizarTemposReparo(atualizacoes) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const { bucket, reparo } of atualizacoes) {
      await conn.query(
        `UPDATE depara_tempo_bucket SET REPARO = ? WHERE BUCKET = ?`,
        [reparo, bucket]
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
  getResumoBuckets,
  getTemposReparo,
  atualizarTemposReparo,
  getTecnologiasDisponiveis,
  TECNOLOGIA_PADRAO,
  getFiltrosDisponiveisReparo,
  STATUS_EXCLUIDOS_PADRAO,
  STATUS_REASON_EXCLUIDOS_PADRAO,
};
