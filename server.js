require('dotenv').config();
const path = require('path');
const express = require('express');

const indexRouter = require('./src/routes/index');

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Calculadora de Cotas - GO rodando em http://localhost:${PORT}`);
});
