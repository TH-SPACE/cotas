const pool = require('../db');
const { paraInClause } = require('./sqlUtils');

// Backlog de Reparos. Antes era `indicadores.backlog_elos` (outro banco,
// compartilhado com outro sistema); passou a ser `backlog_reparos` no próprio
// banco `cotas` -- mesmo layout de colunas do export do ELOS, alimentado pela
// raspagem que já roda na intranet.
//
// Motivo da troca: `backlog_reparos` é a que recebe carga fresca hoje -- a
// `backlog_elos` ficou pra trás (na troca, a nova estava com a carga do dia e a
// antiga com a da tarde anterior). Se algum dia os números da home parecerem
// velhos, comparar MAX(DATA_CARGA) das duas antes de suspeitar do cálculo.
//
// Com isso NENHUMA tabela deste app mora fora de `cotas`, o banco default da
// pool (ver src/db.js / .env DB_NAME), então o nome não precisa mais vir
// qualificado nem configurável por .env.
const TABELA_BACKLOG_REPAROS = 'backlog_reparos';

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
// fixa antiga (fora CANCELADA/ENCERRADA/EXECUCAO). O usuário pode mudar cada um
// livremente depois (ver getFiltrosDisponiveisReparo).
const STATUS_EXCLUIDOS_PADRAO = ['CANCELADA', 'ENCERRADA', 'EXECUCAO'];
// Status Reason: ao contrário de Status (lista de EXCLUSÃO -- tudo fora disso conta),
// aqui o padrão é uma lista de INCLUSÃO -- só esses contam por padrão. Pedido do
// usuário: a home calcula pra D+1, então só importa backlog sem motivo bloqueador
// (`''`, "(sem motivo)" no front), já agendado (`AGENDAMENTO`), em análise técnica
// (`TECNICA`, sem acento -- é como vem gravado em backlog_reparos) ou em triagem
// (`TRIAGEM`); qualquer outro motivo (aguardando peça, cliente ausente etc.) não
// é candidato a D+1 por padrão -- o usuário pode marcar manualmente se quiser
// incluir outros motivos.
const STATUS_REASON_INCLUIDOS_PADRAO = ['', 'AGENDAMENTO', 'TECNICA', 'TRIAGEM'];

async function getResumoBuckets(tecnologias, filtros) {
  const filtroTecnologia = tecnologias.length > 0 ? tecnologias : TECNOLOGIA_PADRAO;
  const status = paraInClause(filtros.status);
  const statusReason = paraInClause(filtros.statusReason);

  const [rows] = await pool.query(
    `SELECT aliada, bucket, backlogReparos, tempoReparoMinutos FROM (
       SELECT
         d.ALIADA AS aliada,
         d.BKT AS bucket,
         COUNT(b.COD_SS) AS backlogReparos,
         COALESCE(t.REPARO, 0) AS tempoReparoMinutos
       FROM depara_bucket d
       LEFT JOIN ${TABELA_BACKLOG_REPAROS} b
         ON b.ARMARIO = d.ARMARIO
         AND b.CLUSTER_ = ?
         AND b.SPECIFICATION_TYPE = ?
         AND b.PHYSICAL_LINK_MEDIA_TYPE IN (?)
         AND b.STATUS IN (?)
         AND b.STATUS_REASON IN (?)
         AND DATE(b.DATA_VENCIMENTO) != CURDATE()
       LEFT JOIN depara_tempo_bucket t
         ON t.BUCKET = d.BKT
       GROUP BY d.ALIADA, d.BKT, t.REPARO

       UNION ALL

       SELECT
         ? AS aliada,
         ? AS bucket,
         COUNT(b.COD_SS) AS backlogReparos,
         COALESCE(MAX(t.REPARO), 0) AS tempoReparoMinutos
       FROM ${TABELA_BACKLOG_REPAROS} b
       LEFT JOIN depara_bucket d ON d.ARMARIO = b.ARMARIO
       LEFT JOIN depara_tempo_bucket t ON t.BUCKET = ?
       WHERE d.ARMARIO IS NULL
         AND b.CLUSTER_ = ?
         AND b.SPECIFICATION_TYPE = ?
         AND b.PHYSICAL_LINK_MEDIA_TYPE IN (?)
         AND b.STATUS IN (?)
         AND b.STATUS_REASON IN (?)
         AND b.ARMARIO IS NOT NULL AND b.ARMARIO <> ''
         AND DATE(b.DATA_VENCIMENTO) != CURDATE()
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

// Uma linha por ORDEM (não agregada por bucket) com os mesmos filtros de
// getResumoBuckets -- alimenta o "baixar CSV" ao clicar no Total geral da home
// (usuário pediu pra poder conferir o número contra o ELOS). Reaproveita
// aliada = COALESCE(d.ALIADA, curinga) num LEFT JOIN só (sem UNION ALL, já que
// aqui não precisa agregar): cobre os dois casos (ARMARIO mapeado e não
// mapeado em depara_bucket) na mesma passada.
async function getOrdensBacklog(tecnologias, filtros) {
  const filtroTecnologia = tecnologias.length > 0 ? tecnologias : TECNOLOGIA_PADRAO;
  const status = paraInClause(filtros.status);
  const statusReason = paraInClause(filtros.statusReason);

  const [rows] = await pool.query(
    `SELECT
       COALESCE(d.ALIADA, ?) AS aliada,
       COALESCE(d.BKT, ?) AS bucket,
       b.COD_SS AS codigo,
       b.ARMARIO AS armario,
       b.STATUS AS status,
       b.STATUS_REASON AS statusReason,
       b.PHYSICAL_LINK_MEDIA_TYPE AS tecnologia,
       b.DATA_VENCIMENTO AS dataAgendamento,
       b.TIME_SLOT AS timeSlot
     FROM ${TABELA_BACKLOG_REPAROS} b
     LEFT JOIN depara_bucket d ON d.ARMARIO = b.ARMARIO
     WHERE b.CLUSTER_ = ?
       AND b.SPECIFICATION_TYPE = ?
       AND b.PHYSICAL_LINK_MEDIA_TYPE IN (?)
       AND b.STATUS IN (?)
       AND b.STATUS_REASON IN (?)
       AND b.ARMARIO IS NOT NULL AND b.ARMARIO <> ''
       AND DATE(b.DATA_VENCIMENTO) != CURDATE()
     ORDER BY aliada, bucket, b.COD_SS`,
    [
      ALIADA_CURINGA, BUCKET_CURINGA,
      CLUSTER_ESCOPO, SPECIFICATION_TYPE_REPARO, filtroTecnologia, status, statusReason,
    ]
  );

  return rows;
}

// Tecnologias distintas hoje em backlog_reparos para o cluster (ex.: GPON, METALICO),
// usadas para montar o filtro — assim o front não precisa hardcodar os valores.
async function getTecnologiasDisponiveis() {
  const [rows] = await pool.query(
    `SELECT DISTINCT PHYSICAL_LINK_MEDIA_TYPE AS tecnologia
     FROM ${TABELA_BACKLOG_REPAROS}
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

  // As 2 queries são independentes -> rodam em paralelo (metade das idas ao banco).
  const [[statusRows], [statusReasonRows]] = await Promise.all([
    pool.query(`SELECT DISTINCT STATUS AS valor FROM ${TABELA_BACKLOG_REPAROS} WHERE ${escopo} ORDER BY STATUS`, params),
    pool.query(`SELECT DISTINCT STATUS_REASON AS valor FROM ${TABELA_BACKLOG_REPAROS} WHERE ${escopo} ORDER BY STATUS_REASON`, params),
  ]);

  return {
    status: statusRows.map(r => r.valor),
    statusReason: statusReasonRows.map(r => r.valor),
  };
}

// Data da última carga do ELOS pro backlog_reparos inteiro (coluna DATA_CARGA vem do
// próprio export, igual em todas as linhas de uma mesma carga — não confundir com
// quando a raspagem rodou aqui, é o horário que o ELOS registra a carga dele).
async function getDataCargaReparo() {
  const [rows] = await pool.query(
    `SELECT MAX(STR_TO_DATE(DATA_CARGA, '%d/%m/%Y %H:%i:%s')) AS dataCarga FROM ${TABELA_BACKLOG_REPAROS}`
  );
  return rows[0].dataCarga;
}

module.exports = {
  getResumoBuckets,
  getOrdensBacklog,
  getTecnologiasDisponiveis,
  TECNOLOGIA_PADRAO,
  getFiltrosDisponiveisReparo,
  getDataCargaReparo,
  STATUS_EXCLUIDOS_PADRAO,
  STATUS_REASON_INCLUIDOS_PADRAO,
  TABELA_BACKLOG_REPAROS,
  SPECIFICATION_TYPE_REPARO,
};
