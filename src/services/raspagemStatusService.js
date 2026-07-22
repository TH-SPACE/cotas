// Lê o status "ao vivo" que a raspagem (elos-backlog-scraper/loop-instalacoes.js)
// vai gravando em cada etapa (login, exportando, importando...) -- essa tabela é
// escrita pelo outro processo, aqui só lemos pra mostrar no modal de credenciais.
const pool = require('../db');

async function criarTabelaStatusRaspagem() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS raspagem_status (
      id TINYINT PRIMARY KEY,
      etapa VARCHAR(50) NOT NULL DEFAULT 'ocioso',
      mensagem VARCHAR(255) NOT NULL DEFAULT '',
      atualizado_em DATETIME,
      ultima_execucao_em DATETIME,
      ultimo_resultado VARCHAR(20),
      ultimas_linhas INT,
      ultimo_erro TEXT,
      execucao_manual_solicitada TINYINT(1) NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
  // ADD COLUMN IF NOT EXISTS pra tabela que já existia antes dessa coluna nascer.
  await pool.query(`ALTER TABLE raspagem_status ADD COLUMN IF NOT EXISTS execucao_manual_solicitada TINYINT(1) NOT NULL DEFAULT 0`);
}

async function getStatusRaspagem() {
  await criarTabelaStatusRaspagem();
  const [linhas] = await pool.query('SELECT * FROM raspagem_status WHERE id = 1');
  return linhas[0] || null;
}

// Botão "Executar agora" do modal -- só liga uma flag no banco; quem realmente
// dispara a raspagem é o processo separado (loop-instalacoes.js), que fica
// verificando essa flag a cada 5s enquanto espera o próximo intervalo normal.
async function solicitarExecucaoManual() {
  await criarTabelaStatusRaspagem();
  await pool.query(
    `INSERT INTO raspagem_status (id, execucao_manual_solicitada) VALUES (1, 1)
     ON DUPLICATE KEY UPDATE execucao_manual_solicitada = 1`
  );
}

module.exports = { getStatusRaspagem, solicitarExecucaoManual };
