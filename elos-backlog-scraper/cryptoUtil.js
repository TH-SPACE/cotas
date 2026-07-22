// Mesma lógica de src/services/cryptoUtil.js do projeto calculadora_cotas --
// duplicado de propósito (projetos independentes, mesmo padrão já usado pra
// atualizacao/elos_credenciais em schema.js) em vez de importar entre pastas.
// A senha do Elos é salva criptografada em elos_credenciais pela calculadora;
// aqui só precisamos descriptografar pra realmente logar no site. Precisa da
// MESMA ELOS_CRED_ENCRYPTION_KEY nos dois .env, senão a descriptografia falha.
const crypto = require('crypto');

const ALGORITMO = 'aes-256-gcm';

function obterChave() {
  const segredo = process.env.ELOS_CRED_ENCRYPTION_KEY;
  if (!segredo) {
    throw new Error('Defina ELOS_CRED_ENCRYPTION_KEY no .env (mesma chave usada pela calculadora).');
  }
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
