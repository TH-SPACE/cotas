// Memoiza o resultado de uma função sem argumentos por `ttlMs`, com "coalescing"
// de chamadas concorrentes (várias requisições no mesmo instante compartilham a
// MESMA busca em voo, em vez de disparar N queries iguais ao banco).
//
// Uso pretendido: leituras que só mudam quando um novo backlog é carregado -- as
// OPÇÕES de filtro (status/statusReason/tecnologia) hoje varrem backlog_instalacoes
// (colunas TEXT, sem índice) em TODA página só pra montar os checkboxes. O
// resultado numérico (getResumoBuckets*) NÃO é cacheado -- continua sempre fresco.
// Staleness máxima = ttlMs; para listas de opção de filtro isso é irrelevante.
function memoTTL(fn, ttlMs) {
  let valor;
  let expira = 0;
  let emVoo = null;

  return function () {
    const agora = Date.now();
    if (agora < expira) return Promise.resolve(valor);
    if (emVoo) return emVoo; // já tem uma busca acontecendo -> todo mundo espera ela

    emVoo = Promise.resolve()
      .then(fn)
      .then((v) => { valor = v; expira = Date.now() + ttlMs; emVoo = null; return v; })
      .catch((e) => { emVoo = null; throw e; });
    return emVoo;
  };
}

module.exports = { memoTTL };
