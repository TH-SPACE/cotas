const pool = require('../db');

// Override de configuração POR ALIADA -- camada sobre configuracoes_gerais
// (ver configGeralService.js). Cada aliada trabalha de um jeito (Previsto/Carga/
// %janela/Meta de PU diferentes), então o mesmo campo pode ter um valor próprio
// por aliada. Regra de leitura (resolvida em routes/index.js): valor da aliada,
// senão o global (configuracoes_gerais), senão o default de código.
//
// Guarda (ALIADA, CHAVE) -> VALOR, mesmas CHAVEs de configuracoes_gerais
// (percentualInstalacao, cargaReparo, percentualJanela1Servico, metaPuTecnicoMe, ...).
// Aliada sem linha aqui simplesmente herda o global -- nada quebra pra quem já
// estava configurado antes desta tabela existir.
async function criarTabela() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS configuracoes_aliada (
      ALIADA VARCHAR(50) NOT NULL,
      CHAVE VARCHAR(50) NOT NULL,
      VALOR VARCHAR(50) NOT NULL,
      ATUALIZADO_EM DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (ALIADA, CHAVE)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
}

// Retorna um mapa aninhado aliada -> { chave -> valor (string) }. Quem chama
// decide normalizador/padrão de cada campo e o fallback pro global.
async function getConfiguracoesAliada() {
  await criarTabela();
  const [rows] = await pool.query('SELECT ALIADA, CHAVE, VALOR FROM configuracoes_aliada');

  const mapa = {};
  rows.forEach(r => {
    (mapa[r.ALIADA] || (mapa[r.ALIADA] = {}))[r.CHAVE] = r.VALOR;
  });
  return mapa;
}

// Grava um ou mais campos (chave->valor) de UMA aliada. Upsert por (ALIADA, CHAVE),
// então não mexe nos campos que não vieram nem nas outras aliadas.
async function salvarConfiguracaoAliada(aliada, valores) {
  await criarTabela();

  const entradas = Object.entries(valores);
  if (!aliada || entradas.length === 0) return;

  const placeholders = entradas.map(() => '(?, ?, ?)').join(',');
  const params = entradas.flatMap(([chave, valor]) => [aliada, chave, String(valor)]);

  await pool.query(
    `INSERT INTO configuracoes_aliada (ALIADA, CHAVE, VALOR) VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE VALOR = VALUES(VALOR)`,
    params
  );
}

// Remove o override de um campo (ou de todos, se `chaves` vier vazio) de uma
// aliada, fazendo-a voltar a herdar o global -- usado pelo "voltar ao padrão".
async function limparConfiguracaoAliada(aliada, chaves) {
  await criarTabela();
  if (!aliada) return;

  const lista = [].concat(chaves || []).filter(Boolean);
  if (lista.length === 0) {
    await pool.query('DELETE FROM configuracoes_aliada WHERE ALIADA = ?', [aliada]);
    return;
  }

  const placeholders = lista.map(() => '?').join(',');
  await pool.query(
    `DELETE FROM configuracoes_aliada WHERE ALIADA = ? AND CHAVE IN (${placeholders})`,
    [aliada, ...lista]
  );
}

module.exports = { getConfiguracoesAliada, salvarConfiguracaoAliada, limparConfiguracaoAliada };
