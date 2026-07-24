require('dotenv').config();
const path = require('path');
const express = require('express');
const cron = require('node-cron');

const indexRouter = require('./src/routes/index');
const { carregarDadosPainel } = require('./src/routes/index');
const { salvarSnapshot, existeSnapshot } = require('./src/services/snapshotService');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Screenshots que a raspagem (elos-backlog-scraper/scraper.js) tira a cada etapa
// (login, dashboard, exportação...) -- mesma pasta física, só servida aqui como
// estática, pro modal "Credenciais do Elos" mostrar miniaturas do progresso.
// Assume o SCREENSHOT_DIR padrão do scraper (relativo à própria pasta dele); se
// alguém mudar essa variável no elos-backlog-scraper/.env, precisa ajustar aqui também.
app.use('/raspagem-screenshots', express.static(path.join(__dirname, 'elos-backlog-scraper', 'screenshots')));

app.use('/', indexRouter);

app.use((req, res) => {
  res.status(404).send('Página não encontrada');
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Erro interno: ' + err.message);
});

// Snapshot diário às 9h: salva o planejamento calculado (Sugestão distribuída por
// janela) na tabela planejamento_historico. A página "Cotas Planejadas" usa o
// snapshot de D-1 como coluna "Planej." -- assim o planejamento de ontem não muda
// quando o backlog de hoje for carregado.
// Só dispara se ainda não houver snapshot para hoje (seguro re-executar se o
// servidor reiniciar depois das 9h).
cron.schedule('0 9 * * *', async () => {
  try {
    const hoje = new Date();
    const jaExiste = await existeSnapshot(hoje);
    if (jaExiste) {
      console.log('[snapshot] Já existe snapshot para hoje, pulando.');
      return;
    }
    console.log('[snapshot] Iniciando snapshot diário...');
    const dados = await carregarDadosPainel({});
    await salvarSnapshot(dados, hoje);
  } catch (err) {
    console.error('[snapshot] Falha no snapshot diário:', err.message);
  }
}, { timezone: 'America/Sao_Paulo' });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Calculadora de Cotas - GO rodando em http://localhost:${PORT}`);
});
