// snapshotService.js
// Persiste o planejamento calculado (Sugestão distribuída por janela) numa tabela
// de histórico. Chamado automaticamente às 9h via cron (ver server.js).
//
// Estrutura da tabela planejamento_historico:
//   data         DATE        -- dia de referência do planejamento (ex.: 2026-07-24)
//   tipo         VARCHAR(20) -- 'instalacao' | 'servico' | 'me' | 'reparo'
//   bucket       VARCHAR(80)
//   janela_index TINYINT     -- 0, 1, 2, 3 (índice na lista de janelas do tipo)
//   janela_label VARCHAR(20) -- ex.: '08:30 - 10:30'
//   minutos      INT
//   ordens       INT
//
// A chave única (data, tipo, bucket, janela_index) garante que rodar duas vezes no
// mesmo dia sobrescreve (INSERT ... ON DUPLICATE KEY UPDATE) em vez de duplicar.

const pool = require('../db');

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS planejamento_historico (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    data          DATE        NOT NULL,
    tipo          VARCHAR(20) NOT NULL,
    bucket        VARCHAR(80) NOT NULL,
    janela_index  TINYINT     NOT NULL,
    janela_label  VARCHAR(20) NOT NULL,
    minutos       INT         NOT NULL DEFAULT 0,
    ordens        INT         NOT NULL DEFAULT 0,
    criado_em     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_planejamento (data, tipo, bucket, janela_index)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
`;

async function garantirTabela() {
    await pool.query(CREATE_TABLE_SQL);
}

// Salva o snapshot do dia `data` (Date ou string YYYY-MM-DD) para todos os tipos.
// `dadosPainel` é o objeto retornado por carregarDadosPainel() em routes/index.js.
async function salvarSnapshot(dadosPainel, data) {
    await garantirTabela();

    const dataStr = formatarData(data || new Date());

    // Cada seção tem: lista de linhas com .janelas[] e .minutos[], e os labels.
    const secoes = [
        {
            tipo: 'instalacao',
            linhas: dadosPainel.linhasInstalacoes,
            labels: dadosPainel.janelasInstalacaoLabels,
        },
        {
            tipo: 'servico',
            linhas: dadosPainel.linhasServicos,
            labels: dadosPainel.janelasServicoLabels,
        },
        {
            tipo: 'me',
            linhas: dadosPainel.linhasMe,
            labels: dadosPainel.janelasMeLabels,
        },
        {
            tipo: 'reparo',
            linhas: dadosPainel.linhas,
            labels: dadosPainel.janelasReparoLabels,
        },
    ];

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        for (const { tipo, linhas, labels } of secoes) {
            for (const linha of linhas) {
                for (let j = 0; j < labels.length; j++) {
                    await conn.query(
                        `INSERT INTO planejamento_historico
               (data, tipo, bucket, janela_index, janela_label, minutos, ordens)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               janela_label = VALUES(janela_label),
               minutos      = VALUES(minutos),
               ordens       = VALUES(ordens),
               criado_em    = CURRENT_TIMESTAMP`,
                        [
                            dataStr,
                            tipo,
                            linha.bucket,
                            j,
                            labels[j],
                            linha.minutos[j] || 0,
                            linha.janelas[j] || 0,
                        ]
                    );
                }
            }
        }

        await conn.commit();
        console.log(`[snapshot] Planejamento de ${dataStr} salvo com sucesso.`);
    } catch (err) {
        await conn.rollback();
        console.error('[snapshot] Erro ao salvar planejamento:', err.message);
        throw err;
    } finally {
        conn.release();
    }
}

// Retorna o planejamento de uma data específica, agrupado por tipo e bucket.
// Resultado: { instalacao: { BKT_X: [{ label, minutos, ordens }, ...], ... }, ... }
async function getSnapshotPorData(data) {
    await garantirTabela();
    const dataStr = formatarData(data);

    const [rows] = await pool.query(
        `SELECT tipo, bucket, janela_index, janela_label, minutos, ordens
     FROM planejamento_historico
     WHERE data = ?
     ORDER BY tipo, bucket, janela_index`,
        [dataStr]
    );

    // Monta mapa tipo -> bucket -> array ordenado por janela_index
    const resultado = {};
    for (const row of rows) {
        if (!resultado[row.tipo]) resultado[row.tipo] = {};
        if (!resultado[row.tipo][row.bucket]) resultado[row.tipo][row.bucket] = [];
        resultado[row.tipo][row.bucket][row.janela_index] = {
            label: row.janela_label,
            minutos: row.minutos,
            ordens: row.ordens,
        };
    }
    return resultado;
}

// Retorna o snapshot do dia anterior (D-1) relativo a hoje.
async function getSnapshotD1() {
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    return getSnapshotPorData(ontem);
}

// Verifica se já existe snapshot para uma data (útil pro cron não disparar duas vezes).
async function existeSnapshot(data) {
    await garantirTabela();
    const dataStr = formatarData(data);
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS total FROM planejamento_historico WHERE data = ?`,
        [dataStr]
    );
    return rows[0].total > 0;
}

function formatarData(data) {
    if (typeof data === 'string') return data.slice(0, 10);
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
}

module.exports = {
    salvarSnapshot,
    getSnapshotPorData,
    getSnapshotD1,
    existeSnapshot,
    garantirTabela,
};
