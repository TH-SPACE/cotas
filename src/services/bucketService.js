const pool = require('../db');

// Único table deste app que mora em outro banco (indicadores, não cotas) --
// backlog_elos já tem sua própria raspagem na intranet e continua lá por
// decisão do usuário; toda tabela nossa (depara_bucket, depara_tempo_bucket etc.)
// vive em cotas, que é o banco default da pool (ver src/db.js / .env DB_NAME).
// Por isso essa é a única referência com o banco qualificado no nome -- o nome
// do banco vem do .env (DB_NAME_INDICADORES) em vez de fixo no código, pra dar
// pra trocar por ambiente sem editar fonte.
const TABELA_BACKLOG_ELOS = `${process.env.DB_NAME_INDICADORES || 'indicadores'}.backlog_elos`;

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
       LEFT JOIN ${TABELA_BACKLOG_ELOS} b
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
       FROM ${TABELA_BACKLOG_ELOS} b
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
     FROM ${TABELA_BACKLOG_ELOS}
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
    `SELECT DISTINCT STATUS AS valor FROM ${TABELA_BACKLOG_ELOS} WHERE ${escopo} ORDER BY STATUS`,
    params
  );
  const [statusReasonRows] = await pool.query(
    `SELECT DISTINCT STATUS_REASON AS valor FROM ${TABELA_BACKLOG_ELOS} WHERE ${escopo} ORDER BY STATUS_REASON`,
    params
  );

  return {
    status: statusRows.map(r => r.valor),
    statusReason: statusReasonRows.map(r => r.valor),
  };
}

// Data da última carga do ELOS pro backlog_elos inteiro (coluna DATA_CARGA vem do
// próprio export, igual em todas as linhas de uma mesma carga — não confundir com
// quando a raspagem rodou aqui, é o horário que o ELOS registra a carga dele).
async function getDataCargaReparo() {
  const [rows] = await pool.query(
    `SELECT MAX(STR_TO_DATE(DATA_CARGA, '%d/%m/%Y %H:%i:%s')) AS dataCarga FROM ${TABELA_BACKLOG_ELOS}`
  );
  return rows[0].dataCarga;
}

module.exports = {
  getResumoBuckets,
  getTecnologiasDisponiveis,
  TECNOLOGIA_PADRAO,
  getFiltrosDisponiveisReparo,
  getDataCargaReparo,
  STATUS_EXCLUIDOS_PADRAO,
  STATUS_REASON_EXCLUIDOS_PADRAO,
};
