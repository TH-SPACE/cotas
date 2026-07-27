// Gerador de CSV pro export "Baixar backlog" (clique no Total geral da home) --
// sem lib nova, mesmo espírito do leitor de .xlsx feito na mão em cotasService.js.
// Separador ';' (não ',') porque o Excel em pt-BR usa vírgula como separador
// decimal -- um CSV com vírgula como separador de CAMPO abre errado (tudo numa
// coluna só) sem o usuário precisar importar manualmente.
function escaparCampoCsv(valor) {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  if (/[";\n\r]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

// `colunas` = [{ rotulo, campo }, ...]. BOM UTF-8 na frente -- sem isso o Excel
// lê acento errado (ISO-8859-1 por padrão em vez de UTF-8).
const BOM_UTF8 = String.fromCharCode(0xFEFF);

function paraCsv(linhas, colunas) {
  const cabecalho = colunas.map(c => escaparCampoCsv(c.rotulo)).join(';');
  const corpo = linhas
    .map(linha => colunas.map(c => escaparCampoCsv(linha[c.campo])).join(';'))
    .join('\r\n');
  return BOM_UTF8 + cabecalho + '\r\n' + corpo;
}

module.exports = { paraCsv };
