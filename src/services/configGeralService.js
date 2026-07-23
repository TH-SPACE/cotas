const pool = require('../db');

// Guarda Previsto/Janelas/Meta de PU/Carga (as 23 chaves das 4 seções) como
// linhas chave/valor em vez de colunas fixas -- mesma ideia de depara_pu_produto,
// evita precisar de ALTER TABLE toda vez que um campo novo (ex.: Carga) é
// adicionado. Antes esses valores só viviam na query string da URL (ver
// hidden-config-estado.ejs) e voltavam pro padrão fixo em routes/index.js
// sempre que alguém abria um link "limpo" -- agora persistem de verdade.
async function criarTabela() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS configuracoes_gerais (
      CHAVE VARCHAR(50) PRIMARY KEY,
      VALOR VARCHAR(50) NOT NULL,
      ATUALIZADO_EM DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
}

// Retorna um mapa chave -> valor (string). Quem chama decide o normalizador e o
// padrão de cada campo (ver normalizarPercentual/normalizarPu/... em routes/index.js) --
// uma chave sem linha aqui ainda (nunca configurada) simplesmente não aparece no mapa.
async function getConfiguracoesGerais() {
  await criarTabela();
  const [rows] = await pool.query('SELECT CHAVE, VALOR FROM configuracoes_gerais');

  const mapa = {};
  rows.forEach(r => { mapa[r.CHAVE] = r.VALOR; });
  return mapa;
}

async function salvarConfiguracoesGerais(valores) {
  await criarTabela();

  const entradas = Object.entries(valores);
  if (entradas.length === 0) return;

  const placeholders = entradas.map(() => '(?, ?)').join(',');
  const params = entradas.flatMap(([chave, valor]) => [chave, String(valor)]);

  await pool.query(
    `INSERT INTO configuracoes_gerais (CHAVE, VALOR) VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE VALOR = VALUES(VALOR)`,
    params
  );
}

module.exports = { getConfiguracoesGerais, salvarConfiguracoesGerais };
