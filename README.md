# Calculadora de Cotas - GO

Painel web (Node.js + Express + EJS) que estima quantos técnicos são necessários para atender o backlog em aberto do cluster GOIANIA, em 4 seções: **Reparos**, **Instalações**, **Serviços** e **ME** (Mudança de Endereço). Cada seção cruza o backlog bruto com o de-para de armários/buckets (`depara_bucket`) e o tempo médio por bucket (`depara_tempo_bucket`), aplica um percentual de previsto e distribui o resultado entre janelas de horário. Tem também uma página de resumo consolidado (`/resumo-cotas`) com as 4 seções lado a lado.

## Stack

- Node.js + Express
- EJS (views server-side, sem client-side framework)
- MySQL (mysql2)
- dotenv

## Dois bancos de dados

- **`indicadores`**: só a tabela `backlog_elos` (Reparos) mora aqui — ela já tem sua própria raspagem automática rodando na intranet, separada deste projeto. Nome do banco configurável via `DB_NAME_INDICADORES`.
- **`cotas`**: todo o resto que este app usa/cria — `depara_bucket`, `depara_tempo_bucket`, `depara_pu_produto*`, `backlog_instalacoes`, `elos_credenciais`. Nome configurável via `DB_NAME` (banco padrão da conexão).

A única query que cruza os dois bancos (`src/services/bucketService.js`) referencia `backlog_elos` com o nome do banco qualificado no SQL — não depende de `USE`/schema padrão.

## Subprojeto: raspagem automática de Instalações

`elos-backlog-scraper/` é um projeto Node **separado** (`package.json`/`node_modules`/`.env` próprios) que faz login no Elos (intranet), baixa o CSV diário de Instalações e sobe em `backlog_instalacoes`. Ver `elos-backlog-scraper/README.md` para detalhes de como a raspagem em si funciona.

- `loop-instalacoes.js`: roda pra sempre, raspando a cada intervalo aleatório de 10 a 25 min.
- Credenciais do Elos (`ELOS_USER`/`ELOS_PASSWORD`) podem ser cadastradas pela própria página (botão de chave no topo da barra de navegação) em vez de só pelo `.env` — fica salvo na tabela `cotas.elos_credenciais`, útil quando quem cuida disso sai de férias e outra pessoa precisa trocar o usuário.
- Reparos **não** é raspado por aqui — já existe outro sistema na intranet cuidando de `backlog_elos`.

## Estrutura

- `server.js`: bootstrap do Express.
- `src/db.js`: pool de conexão MySQL (banco `cotas` por padrão).
- `src/routes/index.js`: todas as rotas (`/`, `/resumo-cotas`, `/config/*`, `/instalacoes/upload`).
- `src/services/`: um serviço por seção (`bucketService.js` = Reparos, `instalacaoBucketService.js`, `servicoBucketService.js`, `meBucketService.js`), mais `calculoBacklogService.js` (matemática compartilhada, sem SQL), `instalacoesService.js` (import de CSV) e `elosCredenciaisService.js`.
- `views/`: templates EJS (`index.ejs` = página principal, `resumo-cotas.ejs` = resumo consolidado, `partials/`).
- `public/`: CSS e JS estáticos.
- `scripts/import-depara.js` / `import-depara-tempo.js`: importam `data/deparabucket.txt` / `data/deparatempo.txt` para `depara_bucket` / `depara_tempo_bucket`.
- `data/`: arquivos de referência versionados (de-para de buckets e de tempo por bucket).
- `ecosystem.config.js`: config do PM2 pra manter o site e a raspagem sempre no ar (ver seção de deploy abaixo).

## Variáveis de ambiente

Crie um `.env` na raiz (não versionado):

```dotenv
NODE_ENV=production
PORT=3301

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=cotas
DB_NAME_INDICADORES=indicadores

# Chave de criptografia da senha do Elos salva em elos_credenciais (ver
# src/services/cryptoUtil.js) -- gere uma vez com:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# e use a MESMA chave aqui e em elos-backlog-scraper/.env (um lado cripta,
# o outro decripta). Trocar a chave depois invalida qualquer senha já salva.
ELOS_CRED_ENCRYPTION_KEY=
```

E outro em `elos-backlog-scraper/.env` (ver `elos-backlog-scraper/.env.example`) — precisa apontar pro mesmo `DB_NAME=cotas` e ter a **mesma** `ELOS_CRED_ENCRYPTION_KEY`, já que é lá que `backlog_instalacoes`/`elos_credenciais` moram e onde a senha é descriptografada de fato pra logar no Elos.

## Instalação e execução (dev local)

```bash
npm install
npm run import:depara   # carrega/atualiza depara_bucket a partir de data/deparabucket.txt
npm run import:tempo    # carrega/atualiza depara_tempo_bucket a partir de data/deparatempo.txt
npm start                # ou npm run dev (auto-reload)
```

Acesso: `http://localhost:3301`

Pra rodar o site **e** a raspagem juntos localmente, num terminal só:

```bash
npm run dev:all     # site com --watch + raspagem, em paralelo (concurrently)
npm run start:all   # mesma coisa, sem --watch
```

## Deploy num servidor (Linux) com PM2

1. **Pré-requisitos no servidor**: Node.js, MySQL/MariaDB, Chromium (`sudo apt-get install -y chromium-browser`, necessário pro Puppeteer da raspagem) e PM2 global (`sudo npm install -g pm2`).

2. **Levar o código e instalar dependências** (dos dois projetos):
   ```bash
   git clone <repo> calculadora_cotas
   cd calculadora_cotas
   npm install
   cd elos-backlog-scraper && npm install && cd ..
   ```

3. **Banco de dados**: se o `cotas` do servidor estiver vazio, ver a seção "Banco vazio no servidor novo?" abaixo antes de continuar. `indicadores`/`backlog_elos` presumidamente já existe lá, mantido pela raspagem de Reparos que já roda na intranet.

4. **Configurar os dois `.env`** (raiz e `elos-backlog-scraper/`) com os dados do banco daquele servidor. Não precisa preencher `ELOS_USER`/`ELOS_PASSWORD` — dá pra cadastrar depois pela própria página.

5. **Rodar com PM2** (a partir da raiz do projeto — `ecosystem.config.js` monta o `cwd` de cada processo relativo a `__dirname`, então o comando precisa ser executado dali):
   ```bash
   cd calculadora_cotas
   pm2 start ecosystem.config.js
   ```
   Isso sobe os dois processos: `calculadora-cotas` (o site) e `elos-scraper-instalacoes` (a raspagem em loop).

6. **Conferir**:
   ```bash
   pm2 status
   pm2 logs
   ```

7. **Deixar sobrevivendo a reboot**:
   ```bash
   pm2 startup
   ```
   Copie e rode exatamente o comando que ele imprimir (registra um serviço systemd). Depois:
   ```bash
   pm2 save
   ```

### Banco vazio no servidor novo?

Depende da tabela — nem tudo precisa de backup manual:

| Tabela | O que acontece num banco `cotas` vazio |
|---|---|
| `backlog_instalacoes`, `atualizacao`, `elos_credenciais` | Criadas sozinhas (`CREATE TABLE IF NOT EXISTS`) na primeira raspagem/uso. `backlog_instalacoes` começa vazia e só populada depois da primeira raspagem bem-sucedida (ou upload manual de CSV). |
| `depara_pu_produto`, `depara_pu_produto_me`, `depara_pu_produto_servico` | Tabela é criada sozinha, mas só ganha os **produtos** conhecidos (com PU = 0) depois do primeiro CSV processado — os pesos de PU corretos (hoje 9+3+5 = 17 produtos configurados) só existem nesta base local, precisam ser **re-cadastrados manualmente pela página** (ou migrados, ver abaixo) |
| `depara_bucket` | Reproduzível via `npm run import:depara` — `data/deparabucket.txt` está versionado no git e é a fonte oficial (não é editado pela página, só por esse arquivo) |
| `depara_tempo_bucket` | Reproduzível via `npm run import:tempo` a partir de `data/deparatempo.txt` (versionado, e hoje bate 100% com o banco local) — **mas** essa tabela também é editável pela página ("Salvar tempos" em cada seção). Se alguém mudar um tempo por lá sem atualizar o `.txt` e alguém rodar o import de novo depois, o import **sobrescreve** a mudança feita pela página. |

**Recomendação**: pra um primeiro deploy exato (inclusive os pesos de PU, que não têm arquivo-fonte), o mais seguro é exportar o `cotas` local e restaurar no servidor:

```powershell
# aqui no Windows
mysqldump -u root -p cotas > cotas_dump.sql
```
```bash
# no servidor Linux, depois de copiar o arquivo pra lá
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS cotas"
mysql -u root -p cotas < cotas_dump.sql
```

Só usar `npm run import:depara`/`import:tempo` sozinhos se você tiver certeza que os `.txt` estão atualizados e não se importar de começar sem os pesos de PU configurados (ficam todos em 0 até re-cadastrar pela página).

## Regra de backlog em aberto (Reparos)

Definida em `src/services/bucketService.js` (`STATUS_EXCLUIDOS_PADRAO`/`STATUS_REASON_EXCLUIDOS_PADRAO`, usados como seleção padrão do filtro — o usuário pode mudar livremente pela página):

- Escopo: `CLUSTER_ = 'GOIANIA'` e `SPECIFICATION_TYPE = 'DEFEITO'`.
- Filtro padrão: `STATUS` fora de `CANCELADA`, `ENCERRADA`, `EXECUCAO`; `STATUS_REASON` fora de `ABERTA MASSIVA`.

Cada uma das outras 3 seções (Instalações/Serviços/ME) tem sua própria regra de escopo — ver os respectivos `*BucketService.js`.
