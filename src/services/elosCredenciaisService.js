// Credenciais de login do Elos usadas pela raspagem automática (elos-backlog-scraper),
// editáveis por aqui em vez de exigir acesso ao .env do servidor -- útil quando quem
// costuma mexer nisso sai de férias e outra pessoa precisa trocar o usuário/senha.
// A raspagem lê da mesma tabela (fallback pro .env se a tabela estiver vazia).
const pool = require('../db');

async function criarTabelaElosCredenciais() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS elos_credenciais (
      id TINYINT PRIMARY KEY,
      usuario VARCHAR(100) NOT NULL,
      senha VARCHAR(255) NOT NULL,
      atualizado_em DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
}

// Nunca devolve a senha pro front -- só usuário e quando foi a última atualização,
// pra preencher o formulário sem expor a senha atual em texto puro na página.
async function getElosCredenciais() {
  await criarTabelaElosCredenciais();
  const [linhas] = await pool.query(
    'SELECT usuario, atualizado_em FROM elos_credenciais WHERE id = 1'
  );
  return linhas[0] || null;
}

// Senha em branco = mantém a atual (não sobrescreve com vazio); só troca se o
// usuário realmente digitou uma senha nova no formulário.
async function salvarElosCredenciais(usuario, senha) {
  await criarTabelaElosCredenciais();
  const [linhas] = await pool.query('SELECT senha FROM elos_credenciais WHERE id = 1');
  const senhaFinal = senha || (linhas[0] ? linhas[0].senha : '');

  await pool.query(
    `INSERT INTO elos_credenciais (id, usuario, senha, atualizado_em) VALUES (1, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE usuario = VALUES(usuario), senha = VALUES(senha), atualizado_em = VALUES(atualizado_em)`,
    [usuario, senhaFinal]
  );
}

module.exports = { getElosCredenciais, salvarElosCredenciais };
