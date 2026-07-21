require('dotenv').config();
const path = require('path');
const express = require('express');

const indexRouter = require('./src/routes/index');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));

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
