require('dotenv').config();
const puppeteerVanilla = require('puppeteer');
const { addExtra } = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomIntFromInterval(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

const ELOS_URL = process.env.ELOS_URL || 'http://10.31.36.30/elos';
const DOWNLOAD_DIR = path.resolve(__dirname, process.env.DOWNLOAD_DIR || 'downloads');
const SCREENSHOT_DIR = path.resolve(__dirname, process.env.SCREENSHOT_DIR || 'screenshots');
const TIPO_SERVICO = (process.env.TIPO_SERVICO || 'instalacoes').toLowerCase();

// Faz login no Elos, navega ate o dashboard de backlog, aplica os filtros
// de regional e baixa o CSV exportado. Devolve o caminho do arquivo baixado
// (ou null se o Elos ja estava atualizado e nada precisou ser baixado) e a
// data de atualizacao lida na pagina (para comparacao com a proxima execucao).
async function baixarBacklog({ usuario, senha, dataAtualizacaoAnterior, onProgresso }) {
  // Callback opcional pra reportar progresso pra fora (loop-instalacoes.js grava
  // isso num status no banco, pra pagina da calculadora mostrar ao vivo) -- se
  // ninguem passar, so faz nada, o console.log de cada etapa continua rolando.
  const progresso = onProgresso || (() => {});

  fsExtra.ensureDirSync(DOWNLOAD_DIR);
  fsExtra.ensureDirSync(SCREENSHOT_DIR);
  fsExtra.emptyDirSync(DOWNLOAD_DIR);

  const puppeteer = addExtra(puppeteerVanilla);
  puppeteer.use(StealthPlugin());

  const chromePath = process.env.CHROME_PATH || (
    process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : (fs.existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : '/usr/bin/google-chrome')
  );

  const browser = await puppeteer.launch({
    headless: process.env.HEADLESS !== 'false',
    executablePath: chromePath,
    args: [
      '--start-fullscreen',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-proxy-server'
    ]
  });

  try {
    progresso('login', 'Abrindo o Elos...');
    const page = await browser.newPage();
    page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    );

    await page.goto(ELOS_URL);
    await esperar(10000);

    await page.type('#cboEmail', usuario);
    await esperar(randomIntFromInterval(1000, 3000));
    await page.type('#cboSenha', senha);
    await esperar(randomIntFromInterval(1000, 3000));

    const botaoLogin = await page.$('#btn1');
    await botaoLogin.click();
    await esperar(randomIntFromInterval(3000, 12000));
    console.log('Login realizado');
    progresso('login', 'Login realizado');
    await esperar(10000);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '1-tela-principal.jpg') });

    await page.click('a[title="Dashboards"]');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '2-tela-dashboard.jpg') });
    await esperar(randomIntFromInterval(1000, 7000));
    try {
      await page.click('a[title="Dashboards"]');
      await esperar(randomIntFromInterval(1000, 7000));
    } catch (err) {
      // alguns ambientes exigem clicar 2x no menu, outros nao. Segue o jogo.
    }

    // Menu lateral: Backlog -> primeiro item do submenu
    const menuBacklog = await page.$$('xpath/./html/body/div[1]/div/div[2]/ul[1]/li[2]');
    await menuBacklog[0].click();
    await esperar(randomIntFromInterval(2000, 6000));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '3-click-menu-1.jpg') });

    const submenuBacklog = await page.$$('xpath/./html/body/div[1]/div/div[2]/ul[1]/li[2]/ul/li[1]');
    await submenuBacklog[0].click();
    await esperar(randomIntFromInterval(2000, 6000));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '4-click-menu-2.jpg') });

    // O dashboard (painel Qlik/BI) carrega de forma assincrona depois do clique no menu:
    // a tela ja aparece com o titulo "Backlog", mas o conteudo (e o campo oculto
    // #hdDataAtualizacao) so surge alguns segundos depois. Por isso esperamos ativamente
    // pelo elemento em vez de confiar num sleep fixo.
    console.log('Aguardando o dashboard de backlog carregar...');
    progresso('navegando', 'Abrindo o dashboard de backlog...');
    try {
      await page.waitForSelector('#hdDataAtualizacao', { timeout: 60000 });
    } catch (err) {
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '5-erro-dashboard-nao-carregou.jpg') });
      throw new Error(
        'O campo #hdDataAtualizacao nao apareceu em 60s apos abrir o Backlog. Veja screenshots/5-erro-dashboard-nao-carregou.jpg: ' +
        'se a tela estiver vazia, o dashboard pode estar lento (aumente o timeout); se tiver conteudo mas sem o campo esperado, o layout do Elos mudou.'
      );
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '5-dashboard-carregado.jpg') });

    const dataAtualizacaoRaw = await page.$eval('#hdDataAtualizacao', (input) => input.getAttribute('value'));
    const [dataParte, horaParte] = dataAtualizacaoRaw.split(' ');
    const [dia, mes, ano] = dataParte.split('/');
    const dataAtualizacao = `${ano}-${mes}-${dia} ${horaParte}`;

    if (dataAtualizacaoAnterior && dataAtualizacao === dataAtualizacaoAnterior) {
      console.log('Elos sem dados novos, nada a baixar.');
      progresso('sem_novidade', 'Elos sem dados novos, nada a importar');
      await page.goto(`${ELOS_URL.replace(/\/elos\/?$/i, '')}/Elos/Public/LogOut`);
      await esperar(3000);
      return { arquivo: null, dataAtualizacao };
    }

    console.log('Dados novos detectados no Elos, exportando...');
    progresso('exportando', 'Dados novos detectados, aplicando filtros e exportando...');

    // Marca os filtros de regional/status no dashboard.
    // ATENCAO: estes XPaths sao posicionais (copiados 1:1 do script original)
    // e dependem do layout exato da tela do Elos. Se o clique cair no
    // elemento errado, confira os screenshots em ./screenshots para ajustar.

    // "Tipo de Servico": a tela abre por padrao em Instalacoes. So clicamos para
    // trocar quando TIPO_SERVICO=reparos for explicitamente pedido no .env.
    if (TIPO_SERVICO === 'reparos') {
      const filtroPrincipal = await page.$$('xpath/./html/body/div[3]/div/div[4]/div/div[2]/div/div[1]/div/div[2]/div[2]/div/div/label/input');
      await filtroPrincipal[0].click();
      await esperar(randomIntFromInterval(2000, 6000));
    } else if (TIPO_SERVICO !== 'instalacoes') {
      console.log(`TIPO_SERVICO="${TIPO_SERVICO}" nao reconhecido (use "instalacoes" ou "reparos"). Mantendo o padrao da tela (Instalacoes).`);
    }

    const xpathsFiltroRegional = [4, 1, 3, 5];
    for (const posicao of xpathsFiltroRegional) {
      const filtro = await page.$$(`xpath/./html/body/div[3]/div/div[4]/div/div[2]/div/div[9]/div/div[2]/div[${posicao}]/div/div/label/input`);
      await filtro[0].click();
      await esperar(randomIntFromInterval(2000, 6000));
    }

    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: DOWNLOAD_DIR
    });

    const botaoExportar = await page.$$('xpath/./html/body/div[3]/div/div[4]/div/div[3]/button');
    await botaoExportar[0].click();
    progresso('baixando', 'Aguardando o download do CSV...');

    let arquivoFinal = null;
    for (let tentativa = 0; tentativa < 60; tentativa++) {
      await esperar(5000);
      const arquivos = fs.readdirSync(DOWNLOAD_DIR);
      arquivoFinal = arquivos.find((f) => !f.endsWith('.crdownload') && !f.endsWith('.tmp'));
      if (arquivoFinal) break;
      console.log(`Aguardando download... tentativa ${tentativa + 1}`);
    }
    if (!arquivoFinal) {
      throw new Error('Download nao completou no tempo esperado');
    }
    console.log('Download finalizado:', arquivoFinal);
    progresso('baixando', `Download concluído: ${arquivoFinal}`);

    await page.goto(`${ELOS_URL.replace(/\/elos\/?$/i, '')}/Elos/Public/LogOut`);
    await esperar(randomIntFromInterval(3000, 10000));

    return { arquivo: path.join(DOWNLOAD_DIR, arquivoFinal), dataAtualizacao };
  } finally {
    await browser.close();
  }
}

module.exports = { baixarBacklog };
