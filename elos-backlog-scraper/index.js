require('dotenv').config();
const conn = require('./db');
const {
  criarTabelaAtualizacao,
  garantirRegistroAtualizacao,
  criarTabelaBacklog,
  criarTabelaInstalacoes,
  getCredenciais
} = require('./schema');
const { baixarBacklog } = require('./scraper');

const TIPO_SERVICO = (process.env.TIPO_SERVICO || 'instalacoes').toLowerCase();

async function main() {
  // Garante que as tabelas existem antes de usar (idempotente: so cria se faltar).
  const conexao = await conn;
  await criarTabelaAtualizacao(conexao);

  // Credenciais podem vir da tabela (editavel pela pagina da calculadora, "Credenciais
  // do Elos") ou do .env -- tabela tem prioridade, .env e so fallback.
  const credenciaisDb = await getCredenciais(conexao);
  const usuario = (credenciaisDb && credenciaisDb.usuario) || process.env.ELOS_USER;
  const senha = (credenciaisDb && credenciaisDb.senha) || process.env.ELOS_PASSWORD;

  if (!usuario || !senha) {
    console.error('Defina as credenciais do Elos pela pagina da calculadora, ou ELOS_USER/ELOS_PASSWORD no .env.');
    process.exit(1);
  }

  let importarArquivo;
  let tipoAtualizacao;
  if (TIPO_SERVICO === 'reparos') {
    ({ importarArquivo } = require('./importBacklog'));
    await criarTabelaBacklog(conexao, process.env.BACKLOG_TABLE || 'backlog_elos');
    tipoAtualizacao = 'backlog_elos';
  } else {
    ({ importarArquivo } = require('./importInstalacoes'));
    await criarTabelaInstalacoes(conexao, process.env.INSTALACOES_TABLE || 'backlog_instalacoes');
    tipoAtualizacao = 'backlog_instalacoes';
  }
  await garantirRegistroAtualizacao(conexao, tipoAtualizacao);

  const [linhas] = await conexao.query(
    'SELECT DATE_FORMAT(datahora, "%Y-%m-%d %H:%i:%s") as data FROM atualizacao WHERE tipo = ?',
    [tipoAtualizacao]
  );
  const dataAtualizacaoAnterior = linhas[0] ? linhas[0].data : null;

  const { arquivo, dataAtualizacao } = await baixarBacklog({
    usuario,
    senha,
    dataAtualizacaoAnterior
  });

  if (!arquivo) {
    console.log('Nada a importar (Elos ainda nao atualizou o backlog).');
    return;
  }

  const stats = await importarArquivo(arquivo);
  console.log('Importacao concluida:', stats);

  await conexao.query(
    'UPDATE atualizacao SET datahora = ? WHERE tipo = ?',
    [dataAtualizacao, tipoAtualizacao]
  );
}

main()
  .catch((err) => {
    console.error('Erro na raspagem do backlog:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await (await conn).end(); } catch (e) { /* ja fechado */ }
  });
