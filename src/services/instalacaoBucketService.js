const pool = require('../db');
const { paraInClause } = require('./sqlUtils');

// Mesmo escopo do painel de Reparos (ver bucketService.js).
const CLUSTER_ESCOPO = 'GOIANIA';

// "Instalação" aqui = SPECIFICATION_TYPE 'INSTALAÇÃO' (exclui ALTERAÇÃO/DESCONEXÃO/
// UPGRADE/DOWNGRADE, que também vêm no mesmo CSV do ELOS). Esse recorte não é
// selecionável no front — só STATUS, STATUS_REASON e TECNOLOGIA_ACESSO são.
const SPECIFICATION_TYPE_INSTALACAO = 'INSTALAÇÃO';

// Valores pré-marcados nos filtros do front na primeira carga (equivalentes à regra
// antiga fixa: fora CANCELADA/ENCERRADA/EXECUCAO, só GPON). O usuário pode mudar cada
// um livremente depois.
const STATUS_EXCLUIDOS_PADRAO = ['CANCELADA', 'ENCERRADA', 'EXECUCAO'];
// Status Reason: lista de INCLUSÃO (não de exclusão) -- ver comentário completo em
// bucketService.js. A home calcula pra D+1, então só motivo em branco ("(sem motivo)")
// ou AGENDAMENTO contam por padrão.
const STATUS_REASON_INCLUIDOS_PADRAO = ['', 'AGENDAMENTO'];
const TECNOLOGIA_ACESSO_PADRAO = ['GPON'];

// Mesmo bucket "curinga" dos Reparos: ARD (ARMARIO) sem linha em depara_bucket
// cai na VIVO / BKT_GOIANIA.
const ALIADA_CURINGA = 'VIVO';
const BUCKET_CURINGA = 'BKT_GOIANIA';

// Valores distintos de STATUS/STATUS_REASON/TECNOLOGIA_ACESSO hoje na base (escopo
// GOIANIA + INSTALAÇÃO), para montar os filtros no front sem hardcodar os valores.
async function getFiltrosDisponiveisInstalacoes() {
  const escopo = 'CLUSTER_ = ? AND SPECIFICATION_TYPE = ?';
  const params = [CLUSTER_ESCOPO, SPECIFICATION_TYPE_INSTALACAO];

  // As 3 queries são independentes -> rodam em paralelo (1/3 das idas ao banco).
  const [[statusRows], [statusReasonRows], [tecnologiaRows]] = await Promise.all([
    pool.query(`SELECT DISTINCT STATUS AS valor FROM backlog_instalacoes WHERE ${escopo} ORDER BY STATUS`, params),
    pool.query(`SELECT DISTINCT STATUS_REASON AS valor FROM backlog_instalacoes WHERE ${escopo} ORDER BY STATUS_REASON`, params),
    pool.query(`SELECT DISTINCT TECNOLOGIA_ACESSO AS valor FROM backlog_instalacoes WHERE ${escopo} AND TECNOLOGIA_ACESSO <> '' ORDER BY TECNOLOGIA_ACESSO`, params),
  ]);

  return {
    status: statusRows.map(r => r.valor),
    statusReason: statusReasonRows.map(r => r.valor),
    tecnologiaAcesso: tecnologiaRows.map(r => r.valor),
  };
}

async function getResumoBucketsInstalacoes(filtros) {
  const status = paraInClause(filtros.status);
  const statusReason = paraInClause(filtros.statusReason);
  const tecnologiaAcesso = paraInClause(filtros.tecnologiaAcesso);

  // PU não é um valor único pro painel: cada SPECIFICATION_PRODUCT tem seu próprio
  // peso (depara_pu_produto), então somamos o peso ticket-a-ticket (puBrutoTotal) e
  // só aplicamos o percentual de "previsto" depois, em calculoBacklogService.
  const [rows] = await pool.query(
    `SELECT aliada, bucket, backlogInstalacoes, puBrutoTotal, tempoInstalacaoMinutos FROM (
       SELECT
         d.ALIADA AS aliada,
         d.BKT AS bucket,
         COUNT(i.ID) AS backlogInstalacoes,
         COALESCE(SUM(p.PU), 0) AS puBrutoTotal,
         COALESCE(t.INSTALACAO, 0) AS tempoInstalacaoMinutos
       FROM depara_bucket d
       LEFT JOIN backlog_instalacoes i
         ON i.ARMARIO = d.ARMARIO
         AND i.CLUSTER_ = ?
         AND i.SPECIFICATION_TYPE = ?
         AND i.STATUS IN (?)
         AND i.STATUS_REASON IN (?)
         AND i.TECNOLOGIA_ACESSO IN (?)
         AND DATE(STR_TO_DATE(i.DATA_VENCIMENTO, '%d/%m/%Y %H:%i:%s')) != CURDATE()
       LEFT JOIN depara_pu_produto p ON p.SPECIFICATION_PRODUCT = i.SPECIFICATION_PRODUCT
       LEFT JOIN depara_tempo_bucket t
         ON t.BUCKET = d.BKT
       GROUP BY d.ALIADA, d.BKT, t.INSTALACAO

       UNION ALL

       SELECT
         ? AS aliada,
         ? AS bucket,
         COUNT(i.ID) AS backlogInstalacoes,
         COALESCE(SUM(p.PU), 0) AS puBrutoTotal,
         COALESCE(MAX(t.INSTALACAO), 0) AS tempoInstalacaoMinutos
       FROM backlog_instalacoes i
       LEFT JOIN depara_bucket d ON d.ARMARIO = i.ARMARIO
       LEFT JOIN depara_pu_produto p ON p.SPECIFICATION_PRODUCT = i.SPECIFICATION_PRODUCT
       LEFT JOIN depara_tempo_bucket t ON t.BUCKET = ?
       WHERE d.ARMARIO IS NULL
         AND i.CLUSTER_ = ?
         AND i.SPECIFICATION_TYPE = ?
         AND i.STATUS IN (?)
         AND i.STATUS_REASON IN (?)
         AND i.TECNOLOGIA_ACESSO IN (?)
         AND i.ARMARIO IS NOT NULL AND i.ARMARIO <> ''
         AND DATE(STR_TO_DATE(i.DATA_VENCIMENTO, '%d/%m/%Y %H:%i:%s')) != CURDATE()
     ) resumo
     ORDER BY aliada, bucket`,
    [
      CLUSTER_ESCOPO, SPECIFICATION_TYPE_INSTALACAO, status, statusReason, tecnologiaAcesso,
      ALIADA_CURINGA, BUCKET_CURINGA, BUCKET_CURINGA,
      CLUSTER_ESCOPO, SPECIFICATION_TYPE_INSTALACAO, status, statusReason, tecnologiaAcesso,
    ]
  );

  const totalGeral = rows.reduce((acc, row) => acc + row.backlogInstalacoes, 0);

  return { linhas: rows, totalGeral };
}

// Uma linha por ORDEM (não agregada por bucket) com os mesmos filtros de
// getResumoBucketsInstalacoes -- alimenta o "baixar CSV" ao clicar no Total
// geral da home. Ver comentário equivalente em bucketService.js
// (getOrdensBacklog) sobre o LEFT JOIN único cobrir mapeado/não-mapeado.
async function getOrdensBacklogInstalacoes(filtros) {
  const status = paraInClause(filtros.status);
  const statusReason = paraInClause(filtros.statusReason);
  const tecnologiaAcesso = paraInClause(filtros.tecnologiaAcesso);

  const [rows] = await pool.query(
    `SELECT
       COALESCE(d.ALIADA, ?) AS aliada,
       COALESCE(d.BKT, ?) AS bucket,
       i.ID AS codigo,
       i.ARMARIO AS armario,
       i.STATUS AS status,
       i.STATUS_REASON AS statusReason,
       i.TECNOLOGIA_ACESSO AS tecnologia,
       i.DATA_VENCIMENTO AS dataAgendamento,
       i.TIME_SLOT AS timeSlot
     FROM backlog_instalacoes i
     LEFT JOIN depara_bucket d ON d.ARMARIO = i.ARMARIO
     WHERE i.CLUSTER_ = ?
       AND i.SPECIFICATION_TYPE = ?
       AND i.STATUS IN (?)
       AND i.STATUS_REASON IN (?)
       AND i.TECNOLOGIA_ACESSO IN (?)
       AND i.ARMARIO IS NOT NULL AND i.ARMARIO <> ''
       AND DATE(STR_TO_DATE(i.DATA_VENCIMENTO, '%d/%m/%Y %H:%i:%s')) != CURDATE()
     ORDER BY aliada, bucket, i.ID`,
    [
      ALIADA_CURINGA, BUCKET_CURINGA,
      CLUSTER_ESCOPO, SPECIFICATION_TYPE_INSTALACAO, status, statusReason, tecnologiaAcesso,
    ]
  );

  return rows;
}

async function getPuProdutos() {
  const [rows] = await pool.query(
    `SELECT SPECIFICATION_PRODUCT AS produto, PU AS pu
     FROM depara_pu_produto
     ORDER BY SPECIFICATION_PRODUCT`
  );

  return rows;
}

async function atualizarPuProdutos(atualizacoes) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const { produto, pu } of atualizacoes) {
      await conn.query(
        `UPDATE depara_pu_produto SET PU = ? WHERE SPECIFICATION_PRODUCT = ?`,
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
  getResumoBucketsInstalacoes,
  getOrdensBacklogInstalacoes,
  getFiltrosDisponiveisInstalacoes,
  getPuProdutos,
  atualizarPuProdutos,
  STATUS_EXCLUIDOS_PADRAO,
  STATUS_REASON_INCLUIDOS_PADRAO,
  TECNOLOGIA_ACESSO_PADRAO,
  CLUSTER_ESCOPO,
  SPECIFICATION_TYPE_INSTALACAO,
};
