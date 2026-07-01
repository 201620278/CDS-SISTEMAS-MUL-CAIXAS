const crypto = require('crypto');
const {
  normalizarTokenCsc,
  normalizarIdCsc,
  extrairUrlHttps
} = require('./utils');

function montarUrlBaseQrCode(consultaQrUrl) {
  const urlBase = extrairUrlHttps(consultaQrUrl);
  if (!urlBase) {
    throw new Error('URL de consulta do QR Code não configurada.');
  }

  if (urlBase.includes('?p=')) {
    return urlBase;
  }

  return `${urlBase}?p=`;
}

function gerarQRCodeNFCe({ chave, ambiente, idCSC, CSC, consultaQrUrl }) {
  const versaoQR = '2';
  const tpAmb = String(Number(ambiente || 2));
  const idToken = normalizarIdCsc(idCSC);
  const token = normalizarTokenCsc(CSC);

  if (!token) {
    throw new Error('Token CSC não configurado.');
  }

  const dadosParaHash = `${chave}|${versaoQR}|${tpAmb}|${idToken}`;
  const hashCSC = crypto
    .createHash('sha1')
    .update(dadosParaHash + token)
    .digest('hex')
    .toUpperCase();

  const urlBase = montarUrlBaseQrCode(consultaQrUrl);

  return `${urlBase}${chave}|${versaoQR}|${tpAmb}|${idToken}|${hashCSC}`;
}

module.exports = {
  gerarQRCodeNFCe,
  montarUrlBaseQrCode
};
