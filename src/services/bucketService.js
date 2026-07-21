const pool = require('../db');

// Escopo do projeto é o cluster GOIANIA, não o estado GO inteiro (que também
// inclui armários de ANAPOLIS/BRASILIA fora do depara_bucket).
const CLUSTER_ESCOPO = 'GOIANIA';

// "Reparo" = chamado de defeito (exclui instalação/outros tipos que specification_type possa trazer).
const SPECIFICATION_TYPE_REPARO = 'DEFEITO';

// Regra de "o que é backlog em aberto" para a Calculadora de Cotas - GO (ajustada em
// relação à base do backlog_b2c: aqui EXECUCAO também sai e DETAIL não é filtrado).
const CONDICOES_BACKLOG_ABERTO = `
  UPPER(TRIM(COALESCE(b.STATUS, ''))) NOT IN ('CANCELADA', 'ENCERRADA', 'EXECUCAO')
  AND UPPER(TRIM(COALESCE(b.STATUS_REASON, ''))) <> 'ABERTA MASSIVA'
`;

async function getResumoBuckets() {
  const [rows] = await pool.query(
    `SELECT
       d.ALIADA AS aliada,
       d.BKT AS bucket,
       COUNT(b.COD_SS) AS backlogReparos
     FROM depara_bucket d
     LEFT JOIN backlog_elos b
       ON b.ARMARIO = d.ARMARIO
       AND b.CLUSTER_ = ?
       AND b.SPECIFICATION_TYPE = ?
       AND ${CONDICOES_BACKLOG_ABERTO}
     GROUP BY d.ALIADA, d.BKT
     ORDER BY d.ALIADA, d.BKT`,
    [CLUSTER_ESCOPO, SPECIFICATION_TYPE_REPARO]
  );

  const totalGeral = rows.reduce((acc, row) => acc + row.backlogReparos, 0);

  return { linhas: rows, totalGeral };
}

async function getArmariosNaoMapeados() {
  const [rows] = await pool.query(
    `SELECT b.ARMARIO AS armario, COUNT(*) AS backlogReparos
     FROM backlog_elos b
     LEFT JOIN depara_bucket d ON d.ARMARIO = b.ARMARIO
     WHERE d.ARMARIO IS NULL
       AND b.CLUSTER_ = ?
       AND b.SPECIFICATION_TYPE = ?
       AND b.ARMARIO IS NOT NULL AND b.ARMARIO <> ''
       AND ${CONDICOES_BACKLOG_ABERTO}
     GROUP BY b.ARMARIO
     ORDER BY backlogReparos DESC`,
    [CLUSTER_ESCOPO, SPECIFICATION_TYPE_REPARO]
  );

  return rows;
}

module.exports = { getResumoBuckets, getArmariosNaoMapeados };
