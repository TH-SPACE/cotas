// Config do PM2 pra manter o site sempre no ar, com reinício automático se cair.
//
// A raspagem de Instalações que rodava daqui (app `raspaarbk_instalacoes`,
// elos-backlog-scraper/loop-instalacoes.js) foi descomissionada: agora é feita
// junto com Reparos, num único login, pelo processo `raspagem_elos` em
// backlog_b2c/elos-scraper (mesmo login que baixava só Instalações antes, só que
// unificado). O código antigo continua em elos-backlog-scraper/ (não foi apagado),
// só não roda mais -- as tabelas compartilhadas em `cotas` (elos_credenciais,
// raspagem_status) seguem as mesmas, então o modal "Credenciais do Elos" deste
// site continua mostrando o status ao vivo do processo novo normalmente.
module.exports = {
  apps: [
    {
      name: 'cotas',
      script: 'server.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
    },
  ],
};
