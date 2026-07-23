// Protege contra "IN ()" (erro de sintaxe SQL) quando um filtro multi-valor fica
// vazio -- pode acontecer com o usuário desmarcando tudo, mas também sozinho
// quando a base não tem NENHUM valor disponível pro filtro (ex.: upload novo sem
// nenhuma linha no escopo do painel), caso em que o "padrão" calculado a partir
// dos valores disponíveis também vem vazio. mysql2 expande `IN (?)` de um array
// vazio como `IN ()`, que o MariaDB rejeita. `IN (NULL)` no lugar não casa com
// nenhuma linha -- mesmo efeito pretendido de "nada selecionado = nada aparece".
function paraInClause(lista) {
  return Array.isArray(lista) && lista.length > 0 ? lista : [null];
}

module.exports = { paraInClause };
