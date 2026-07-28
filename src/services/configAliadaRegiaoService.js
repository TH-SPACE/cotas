const pool = require('../db');

// Override de configuração POR (ALIADA, REGIÃO) -- camada MAIS específica que
// configuracoes_aliada.js, sobre a mesma cascata (região -> aliada inteira ->
// configuracoes_gerais -> default de código). Existe porque dentro de uma
// mesma aliada os buckets do interior e os da capital podem precisar de
// Previsto/Carga/%janela/Meta de PU diferentes (ver bucketRegiaoService.js
// pra saber que região cada bucket é). Tabela nova e independente de
// configuracoes_aliada -- não é ALTER TABLE numa tabela já em produção com
// dados reais, é uma camada extra por cima.
//
// Guarda (ALIADA, REGIAO, CHAVE) -> VALOR, mesmas CHAVEs de configuracoes_gerais/
// configuracoes_aliada. (aliada,região) sem linha aqui simplesmente herda o
// nível de baixo (aliada inteira, depois global).
let tabelaGarantida = false;
async function criarTabela() {
  if (tabelaGarantida) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS configuracoes_aliada_regiao (
      ALIADA VARCHAR(50) NOT NULL,
      REGIAO VARCHAR(20) NOT NULL,
      CHAVE VARCHAR(50) NOT NULL,
      VALOR VARCHAR(50) NOT NULL,
      ATUALIZADO_EM DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (ALIADA, REGIAO, CHAVE)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
  tabelaGarantida = true;
}

// Mapa aninhado aliada -> região -> { chave -> valor (string) }.
async function getConfiguracoesAliadaRegiao() {
  await criarTabela();
  const [rows] = await pool.query('SELECT ALIADA, REGIAO, CHAVE, VALOR FROM configuracoes_aliada_regiao');

  const mapa = {};
  rows.forEach(r => {
    const porAliada = mapa[r.ALIADA] || (mapa[r.ALIADA] = {});
    (porAliada[r.REGIAO] || (porAliada[r.REGIAO] = {}))[r.CHAVE] = r.VALOR;
  });
  return mapa;
}

// Grava um ou mais campos de UMA (aliada,região). Upsert por (ALIADA,REGIAO,CHAVE).
async function salvarConfiguracaoAliadaRegiao(aliada, regiao, valores) {
  await criarTabela();

  const entradas = Object.entries(valores || {});
  if (!aliada || !regiao || entradas.length === 0) return;

  const placeholders = entradas.map(() => '(?, ?, ?, ?)').join(',');
  const params = entradas.flatMap(([chave, valor]) => [aliada, regiao, chave, String(valor)]);

  await pool.query(
    `INSERT INTO configuracoes_aliada_regiao (ALIADA, REGIAO, CHAVE, VALOR) VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE VALOR = VALUES(VALOR)`,
    params
  );
}

// Remove o override de um campo (ou de todos, se `chaves` vier vazio) de uma
// (aliada,região), fazendo-a voltar a herdar o nível de baixo.
async function limparConfiguracaoAliadaRegiao(aliada, regiao, chaves) {
  await criarTabela();
  if (!aliada || !regiao) return;

  const lista = [].concat(chaves || []).filter(Boolean);
  if (lista.length === 0) {
    await pool.query('DELETE FROM configuracoes_aliada_regiao WHERE ALIADA = ? AND REGIAO = ?', [aliada, regiao]);
    return;
  }

  const placeholders = lista.map(() => '?').join(',');
  await pool.query(
    `DELETE FROM configuracoes_aliada_regiao WHERE ALIADA = ? AND REGIAO = ? AND CHAVE IN (${placeholders})`,
    [aliada, regiao, ...lista]
  );
}

module.exports = { getConfiguracoesAliadaRegiao, salvarConfiguracaoAliadaRegiao, limparConfiguracaoAliadaRegiao };
