# Elos Backlog Scraper

Versão independente, enxuta, da raspagem do backlog do site Elos (intranet). Faz login,
exporta o CSV do dashboard de backlog e sobe os dados no MariaDB/MySQL. Suporta os dois
tipos de backlog do Elos, cada um com schema e estratégia de carga próprios:

| | Instalações (padrão) | Reparos |
|---|---|---|
| Tabela | `backlog_instalacoes` | `backlog_elos` |
| Chave | nenhuma natural (`NUMERO_OS` sozinho se repete) | `COD_SS` |
| Estratégia | **snapshot**: trunca e recarrega tudo a cada raspagem | **upsert**: atualiza por `COD_SS`, remove o que saiu do backlog |
| Colunas | 102, quase todas `TEXT` (schema copiado de uma tabela real já existente no banco `indicadores`) | 108, tipadas (`VARCHAR`/`DATETIME`) |

Baseado no script original do projeto `estoque` (`raspagem_backlogBD.js`), mas sem as tabelas
derivadas (`backlog_elos_hist`, `RNE_N_PL_BACKLOG_REG_TT`, `PL_TT_WO_NE`, `qua_percepcao_elos`,
`backlog_elos_congelado`, `etaProduction`) — este projeto cuida só de "baixar CSV do Elos e
manter a tabela atualizada".

## O que já foi testado (sem precisar do Elos)

Não dá pra testar o login/scraping de dentro daqui porque o Elos só é acessível pela intranet.
O que **foi validado de verdade**, usando o seu MariaDB local e fatias reais de exports do Elos:

**Reparos** (`fixtures/backlog-sample.csv`, 1500 linhas reais, várias regionais):
- `importBacklog.js` mapeia colunas pelo **nome do cabeçalho** (não pela posição — o export do
  Elos já mudou o número de colunas ao longo do tempo, então depender de posição fixa quebra
  silenciosamente).
- Upsert em lote (`INSERT ... ON DUPLICATE KEY UPDATE` por `COD_SS`) e marca/remove registros que
  saíram do backlog (`STATUS_GOPER`).
- `npm run test-import`: 538 de 1500 linhas batem com CENTRO OESTE/NORTE e foram importadas
  corretamente (345 CENTRO OESTE + 193 NORTE), num banco `elos_scraper_test` à parte (não mexe no
  seu banco real).
- `PHYSICALRESOURCESUMMARY` pode chegar com quase 900 caracteres — mais que o `VARCHAR(255)` do
  schema original do seu amigo. Nesta versão a coluna virou `TEXT`.

**Instalações** (`fixtures/instalacoes-sample.csv`, 1500 linhas reais de
`BackLogDiario_2026-07-22-07-44-59-95.csv`, que você já tinha importado manualmente):
- Schema copiado da tabela `backlog_instalacoes` que já existia no seu banco `indicadores`
  (105 colunas, a maioria `TEXT`, `ID` autoincremento, mais `ARMARIO`/`CLUSTER_`/`REGIONAL`/
  `STATUS`/`SPECIFICATION_TYPE`/`NUMERO_OS` indexados, e `ARQUIVO_ORIGEM`/`IMPORTADO_EM` pra
  rastrear a origem de cada linha).
- Descoberta: `NUMERO_OS` **não é único** sozinho (488 duplicados em 3631 linhas reais — uma OS
  pode ter várias linhas, uma por produto/atividade). Não há chave natural confiável, então a
  carga é por **snapshot**: `TRUNCATE` + reinserção completa a cada raspagem (confirmado com
  você — é o comportamento pretendido, não um histórico acumulativo).
- `npm run test-import-instalacoes`: 1500 de 1500 linhas importadas (amostra só tinha CENTRO
  OESTE), zero duplicidade de `NUMERO_OS+RPON`.
- Também vem em Latin-1, mesma lógica de encoding do backlog de reparos.

## O que você precisa testar (só isso depende da intranet)

1. Rodar `npm start` de uma máquina com acesso a `http://10.31.36.30/elos`, com `ELOS_USER`/
   `ELOS_PASSWORD` reais no `.env`.
2. Conferir os screenshots em `./screenshots/` (1 a 5) se o login ou a navegação até o dashboard
   travar em algum ponto — os seletores/XPaths foram copiados do script original, mas são
   posicionais e dependem do layout exato da tela do Elos.
3. Confirmar que o arquivo baixado em `./downloads/` tem o cabeçalho esperado (`NUMERO_OS`/
   `REGIONAL` para Instalações, `COD_SS`/`REGIONAL` para Reparos) — se o Elos mudar o formato do
   export de novo, o script avisa e para, em vez de importar lixo.

## Setup

```bash
npm install
cp .env.example .env
# edite o .env: credenciais do Elos + dados do banco
npm run setup-db      # opcional: cria as duas tabelas com antecedencia
```

`npm start` já verifica e cria a tabela necessária (`atualizacao` + `backlog_instalacoes` ou
`backlog_elos`, dependendo de `TIPO_SERVICO`) sozinho se ela não existir no banco (`DB_NAME` do
`.env`), então rodar `npm run setup-db` antes é opcional.

## Uso

```bash
npm start                        # login no Elos -> exporta CSV -> importa (Instalacoes por padrao)
npm run test-import              # testa so o parser/import de Reparos, com a fixture local
npm run test-import-instalacoes  # testa so o parser/import de Instalacoes, com a fixture local
```

`npm start` só baixa e reprocessa se a data de atualização do Elos (`#hdDataAtualizacao`) for
diferente da última execução registrada na tabela `atualizacao` — isso evita reprocessar o mesmo
backlog várias vezes por dia. Para trocar de Instalações para Reparos, defina `TIPO_SERVICO=reparos`
no `.env`.

## Variáveis de ambiente (`.env`)

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | sim | — | Conexão com o MariaDB/MySQL |
| `ELOS_USER`, `ELOS_PASSWORD` | sim | — | Login no site Elos |
| `ELOS_URL` | não | `http://10.31.36.30/elos` | URL do Elos |
| `TIPO_SERVICO` | não | `instalacoes` | `instalacoes` ou `reparos` — a tela do Elos ja abre em Instalacoes por padrao, entao com `instalacoes` o script nao clica em nada nesse filtro |
| `CHROME_PATH` | não | detecta automaticamente | Caminho do Chrome/Chromium |
| `HEADLESS` | não | `true` | Coloque `false` para ver o navegador rodando (útil pra debugar seletor) |
| `DOWNLOAD_DIR`, `SCREENSHOT_DIR` | não | `./downloads`, `./screenshots` | Pastas de saída |
| `BACKLOG_TABLE` | não | `backlog_elos` | Tabela de destino quando `TIPO_SERVICO=reparos` |
| `INSTALACOES_TABLE` | não | `backlog_instalacoes` | Tabela de destino quando `TIPO_SERVICO=instalacoes` |
| `REGIOES_VALIDAS` | não | `CENTRO OESTE,NORTE` | Regionais a importar (separadas por vírgula) |
| `MIN_LINHAS` | não | `1000` | Sanidade: aborta se o CSV vier menor que isso |
| `BATCH_SIZE` | não | `500` | Tamanho do lote de INSERT |

## Estrutura

```
db.js                       -> pool de conexao mysql2
schema.js                   -> definicao das tabelas (atualizacao, backlog_elos, backlog_instalacoes)
setup-db.js                 -> cria todas as tabelas com antecedencia
scraper.js                  -> Puppeteer: login, navegacao, filtro Tipo de Servico, export do CSV
importBacklog.js            -> parse + upsert do backlog de Reparos (por COD_SS)
importInstalacoes.js        -> parse + truncate/reload do backlog de Instalacoes (sem chave natural)
index.js                    -> orquestra: escolhe reparos/instalacoes via TIPO_SERVICO, checa atualizacao -> scraper -> import
test-import.js              -> testa importBacklog.js com fixtures/backlog-sample.csv
test-import-instalacoes.js  -> testa importInstalacoes.js com fixtures/instalacoes-sample.csv
fixtures/                   -> fatias reais (reduzidas) de exports do Elos, para teste local
```
