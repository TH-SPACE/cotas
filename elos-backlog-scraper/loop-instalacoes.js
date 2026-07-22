// Versão "sempre rodando" do index.js, fixa em Instalacoes (backlog_instalacoes) --
// não existe raspagem automática pra esse backlog ainda (Reparos/backlog_elos já tem
// um sistema próprio na intranet cuidando disso, então não entra aqui).
//
// Ideia: raspa uma vez, espera um intervalo ALEATÓRIO entre MIN e MAX minutos, raspa
// de novo, pra sempre -- em vez de intervalo fixo, que bateria sempre no mesmo minuto
// do relógio. Erro de uma rodada (Elos fora do ar, seletor mudou, etc.) só é logado;
// não derruba o processo, a próxima rodada tenta de novo depois do intervalo normal.
require('dotenv').config();
const conn = require('./db');
const {
  criarTabelaAtualizacao,
  garantirRegistroAtualizacao,
  criarTabelaInstalacoes,
  getCredenciais,
  atualizarStatusRaspagem,
  registrarResultadoRaspagem,
  consumirSolicitacaoManual
} = require('./schema');
const { baixarBacklog } = require('./scraper');
const { importarArquivo } = require('./importInstalacoes');

const TIPO_ATUALIZACAO = 'backlog_instalacoes';
const INTERVALO_MIN_MS = 10 * 60 * 1000;
const INTERVALO_MAX_MS = 25 * 60 * 1000;
// Enquanto espera o próximo intervalo, verifica a cada 5s se alguém clicou
// "Executar agora" na página -- assim o botão não precisa esperar até 25min
// pra fazer efeito, sem precisar de nenhuma comunicação direta entre processos
// (os dois só se falam pelo banco).
const INTERVALO_VERIFICACAO_MANUAL_MS = 5000;

function proximoIntervaloMs() {
  return INTERVALO_MIN_MS + Math.random() * (INTERVALO_MAX_MS - INTERVALO_MIN_MS);
}

function agora() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(...args) {
  console.log(`[${agora()}]`, ...args);
}

async function rodarUmaVez(conexao) {
  // Consome qualquer solicitação de execução manual pendente -- vamos rodar
  // agora de qualquer forma, então isso evita que uma solicitação "sobre" e
  // dispare uma rodada extra desnecessária logo depois desta.
  await consumirSolicitacaoManual(conexao);

  // Credenciais podem vir da tabela (editável pela página da calculadora, ver
  // "Credenciais do Elos" no topo) ou do .env -- tabela tem prioridade, .env é só
  // fallback pro primeiro setup antes de alguém preencher pela página.
  const credenciaisDb = await getCredenciais(conexao);
  const usuario = (credenciaisDb && credenciaisDb.usuario) || process.env.ELOS_USER;
  const senha = (credenciaisDb && credenciaisDb.senha) || process.env.ELOS_PASSWORD;
  if (!usuario || !senha) {
    throw new Error('Defina as credenciais do Elos pela página da calculadora, ou ELOS_USER/ELOS_PASSWORD no .env.');
  }

  await atualizarStatusRaspagem(conexao, 'iniciando', 'Iniciando raspagem de instalações...');

  const [linhas] = await conexao.query(
    'SELECT DATE_FORMAT(datahora, "%Y-%m-%d %H:%i:%s") as data FROM atualizacao WHERE tipo = ?',
    [TIPO_ATUALIZACAO]
  );
  const dataAtualizacaoAnterior = linhas[0] ? linhas[0].data : null;

  // Repassa cada etapa do scraper.js pro status no banco -- é isso que a página
  // da calculadora fica consultando (polling) enquanto o modal de credenciais
  // está aberto, pra mostrar "Login realizado" etc. em tempo real.
  const onProgresso = (etapa, mensagem) => {
    atualizarStatusRaspagem(conexao, etapa, mensagem).catch((err) => log('Falha ao gravar status:', err.message));
  };

  const { arquivo, dataAtualizacao } = await baixarBacklog({ usuario, senha, dataAtualizacaoAnterior, onProgresso });

  if (!arquivo) {
    log('Nada a importar (Elos ainda não atualizou o backlog de instalações).');
    await registrarResultadoRaspagem(conexao, { resultado: 'sucesso', linhas: 0 });
    return;
  }

  await atualizarStatusRaspagem(conexao, 'importando', 'Importando dados para o banco...');
  const stats = await importarArquivo(arquivo);
  log('Importação de instalações concluída:', stats);

  await conexao.query('UPDATE atualizacao SET datahora = ? WHERE tipo = ?', [dataAtualizacao, TIPO_ATUALIZACAO]);
  await registrarResultadoRaspagem(conexao, { resultado: 'sucesso', linhas: stats.totalImportadas });
}

let encerrando = false;
let timeoutAtual = null;
// Só clearTimeout() não bastava: cancela o timer, mas a Promise que o `await
// esperar()` está segurando nunca seria resolvida, e o processo ficava pendurado
// pra sempre em vez de encerrar. Guarda o próprio `resolve` pra poder destravar
// a espera na hora, quando um sinal chega no meio dela.
let resolverEsperaAtual = null;

function pedirEncerramento(sinal) {
  if (encerrando) return;
  encerrando = true;
  log(`${sinal} recebido, encerrando após a rodada atual (ou já na espera)...`);
  if (timeoutAtual) clearTimeout(timeoutAtual);
  if (resolverEsperaAtual) {
    const resolve = resolverEsperaAtual;
    resolverEsperaAtual = null;
    resolve();
  }
}

process.on('SIGINT', () => pedirEncerramento('SIGINT'));
process.on('SIGTERM', () => pedirEncerramento('SIGTERM'));

function esperar(ms) {
  return new Promise((resolve) => {
    resolverEsperaAtual = resolve;
    timeoutAtual = setTimeout(() => {
      resolverEsperaAtual = null;
      resolve();
    }, ms);
  });
}

// Espera o intervalo normal, mas em pedaços de 5s -- a cada pedaço, confere se
// uma execução manual foi solicitada e, se sim, corta a espera na hora em vez
// de esperar o resto do intervalo aleatório.
async function esperarComVerificacaoManual(conexao, totalMs) {
  let restante = totalMs;
  while (restante > 0 && !encerrando) {
    const pedaco = Math.min(INTERVALO_VERIFICACAO_MANUAL_MS, restante);
    await esperar(pedaco);
    restante -= pedaco;
    if (encerrando) return;

    const solicitado = await consumirSolicitacaoManual(conexao).catch(() => false);
    if (solicitado) {
      log('Execução manual solicitada pela página -- iniciando agora, sem esperar o resto do intervalo.');
      return;
    }
  }
}

async function loop() {
  const conexao = await conn;
  await criarTabelaAtualizacao(conexao);
  await criarTabelaInstalacoes(conexao, process.env.INSTALACOES_TABLE || 'backlog_instalacoes');
  await garantirRegistroAtualizacao(conexao, TIPO_ATUALIZACAO);

  log('Raspagem automática de instalações iniciada. Intervalo entre rodadas: 10 a 25 min.');

  while (!encerrando) {
    try {
      await rodarUmaVez(conexao);
    } catch (err) {
      log('Erro na raspagem de instalações:', err.message);
      await registrarResultadoRaspagem(conexao, { resultado: 'erro', erro: err.message }).catch(() => {});
    }

    if (encerrando) break;

    const espera = proximoIntervaloMs();
    log(`Próxima raspagem em ${Math.round(espera / 60000)} min (ou antes, se solicitado pela página).`);
    await esperarComVerificacaoManual(conexao, espera);
  }

  await conexao.end();
  log('Encerrado.');
  process.exit(0);
}

loop();
