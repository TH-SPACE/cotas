// Config do PM2 pra manter os dois processos (site + raspagem) sempre no ar,
// com reinício automático se algum cair. `cwd` de cada app é essencial: cada um
// tem seu próprio .env (require('dotenv').config() lê do cwd, não do __dirname
// do script), então sem isso o scraper carregaria o .env errado (ou nenhum).
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'cotas',
      script: 'server.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
    },
    {
      name: 'raspaarbk_instalacoes',
      script: 'loop-instalacoes.js',
      cwd: path.join(__dirname, 'elos-backlog-scraper'),
      autorestart: true,
      watch: false,
      // O próprio loop já tem retry interno (10-25min entre raspagens); isso aqui
      // é só uma rede de segurança pra um crash de verdade (ex.: exceção não
      // tratada). min_uptime+max_restarts evita ficar reiniciando sem parar se
      // algo estiver fundamentalmente quebrado (ex.: .env faltando).
      restart_delay: 5000,
      min_uptime: '30s',
      max_restarts: 10,
    },
  ],
};
