# Calculadora de Cotas - GO

Painel web (Node.js + Express + EJS) que cruza a tabela `backlog_elos` (banco `indicadores`) com o de-para de armários/buckets (`depara_bucket`) para mostrar o backlog de reparos em aberto por Aliada e Bucket, no cluster GOIANIA.

## Stack

- Node.js + Express
- EJS (views server-side)
- MySQL (mysql2)
- dotenv

## Estrutura

- `server.js`: bootstrap do Express.
- `src/db.js`: pool de conexão MySQL.
- `src/services/bucketService.js`: regras de negócio e consultas (backlog em aberto, armários não mapeados).
- `src/routes/index.js`: rota principal.
- `views/`: templates EJS.
- `public/`: CSS estático.
- `scripts/import-depara.js`: importa `data/deparabucket.txt` para a tabela `depara_bucket`.
- `data/`: arquivos de referência (de-para de buckets e layout de tabela desejado).

## Variáveis de ambiente

Crie um `.env` na raiz (não versionado):

```dotenv
NODE_ENV=development
PORT=3301

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=indicadores
```

## Instalação e execução

```bash
npm install
npm run import:depara   # carrega/atualiza depara_bucket a partir de data/deparabucket.txt
npm start                # ou npm run dev (auto-reload)
```

Acesso: `http://localhost:3301`

## Regra de backlog em aberto

Definida em `src/services/bucketService.js` (`CONDICOES_BACKLOG_ABERTO`):

- Escopo: `CLUSTER_ = 'GOIANIA'` e `SPECIFICATION_TYPE = 'DEFEITO'`.
- `STATUS` diferente de `CANCELADA`, `ENCERRADA` e `EXECUCAO`.
- `STATUS_REASON` diferente de `ABERTA MASSIVA`.
- `DETAIL` não é filtrado.

Armários presentes no backlog mas ausentes em `depara_bucket` aparecem na seção "Armários sem bucket mapeado" da página, para indicar que o de-para precisa ser atualizado.
