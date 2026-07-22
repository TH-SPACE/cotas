// Criptografia simétrica (não hash) para a senha do Elos em elos_credenciais --
// precisa ser reversível porque a raspagem tem que USAR a senha de verdade pra
// logar num site de terceiro (não é uma senha nossa pra só validar/comparar).
// AES-256-GCM: autenticado (detecta se o valor foi adulterado), sem depender de
// nenhuma lib externa (crypto é built-in do Node). A mesma chave (.env
// ELOS_CRED_ENCRYPTION_KEY) tem que existir aqui e em elos-backlog-scraper/.env,
// já que um lado cripta e o outro decripta.
const crypto = require('crypto');

const ALGORITMO = 'aes-256-gcm';

function obterChave() {
  const segredo = process.env.ELOS_CRED_ENCRYPTION_KEY;
  if (!segredo) {
    throw new Error('Defina ELOS_CRED_ENCRYPTION_KEY no .env para salvar/ler credenciais do Elos.');
  }
  // sha256 normaliza qualquer tamanho de segredo pros 32 bytes que aes-256 exige.
  return crypto.createHash('sha256').update(segredo).digest();
}

function criptografar(texto) {
  const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv(ALGORITMO, obterChave(), iv);
  const criptografado = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
  const tag = cifra.getAuthTag();
  return Buffer.concat([iv, tag, criptografado]).toString('base64');
}

function descriptografar(payload) {
  const buffer = Buffer.from(payload, 'base64');
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const criptografado = buffer.subarray(28);
  const decifra = crypto.createDecipheriv(ALGORITMO, obterChave(), iv);
  decifra.setAuthTag(tag);
  return Buffer.concat([decifra.update(criptografado), decifra.final()]).toString('utf8');
}

module.exports = { criptografar, descriptografar };
