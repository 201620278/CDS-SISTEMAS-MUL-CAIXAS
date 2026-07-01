const crypto = require('crypto');

function onlyDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function normalizarTokenCsc(token) {
  return String(token || '')
    .replace(/^CSC\s*:\s*/i, '')
    .trim();
}

function normalizarIdCsc(idCSC) {
  const digits = String(idCSC || '1').replace(/\D/g, '');
  if (!digits) {
    return '1';
  }
  return String(Number(digits));
}

function extrairUrlHttps(valor) {
  const texto = String(valor || '').trim();
  const match = texto.match(/https?:\/\/[^\s"'<>]+/i);
  if (match) {
    return match[0].replace(/\/+$/, '');
  }
  return texto.replace(/\/+$/, '');
}

function padLeft(value, size, char = '0') {
  return String(value == null ? '' : value).padStart(size, char);
}

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function formatNumber(value, decimals = 2) {
  return Number(value || 0).toFixed(decimals);
}

function todayYMD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = padLeft(d.getMonth() + 1, 2);
  const dd = padLeft(d.getDate(), 2);
  return `${yyyy}-${mm}-${dd}`;
}

function nowDhEmi() {
  const agora = new Date();

  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  const hora = String(agora.getHours()).padStart(2, '0');
  const minuto = String(agora.getMinutes()).padStart(2, '0');
  const segundo = String(agora.getSeconds()).padStart(2, '0');

  // Brasil UTC-03:00
  return `${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo}-03:00`;
}

// Módulo 11 da chave NF-e/NFC-e
function modulo11(base) {
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i -= 1) {
    soma += Number(base[i]) * peso;
    peso += 1;
    if (peso > 9) peso = 2;
  }
  const resto = soma % 11;
  return (resto === 0 || resto === 1) ? 0 : 11 - resto;
}

function gerarCodigoNumerico() {
  return padLeft(Math.floor(Math.random() * 99999999), 8);
}

function gerarChaveAcesso({ uf, aamm, cnpj, modelo = '65', serie, numero, tpEmis = '1', cNF }) {
  const base = [
    padLeft(uf, 2),
    aamm,
    padLeft(onlyDigits(cnpj), 14),
    padLeft(modelo, 2),
    padLeft(serie, 3),
    padLeft(numero, 9),
    padLeft(tpEmis, 1),
    padLeft(cNF, 8)
  ].join('');
  const dv = modulo11(base);
  return `${base}${dv}`;
}

function sha1Hex(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function extrairNumeroNFeDaChave(chave) {
  const digits = onlyDigits(chave);
  if (digits.length !== 44) {
    return null;
  }
  return Number(digits.substring(25, 34));
}

function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function compactarXml(xml) {
  return String(xml || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .replace(/\n/g, '')
    .replace(/\t/g, '')
    .replace(/>\s+</g, '><')
    .trim();
}

function normalizarXmlParaSefaz(xml) {
  return String(xml || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .replace(/\n/g, '')
    .replace(/\t/g, '')
    .replace(/>\s+</g, '><')
    .trim();
}

function limparCertificadoBase64(certBase64) {
  return String(certBase64 || '')
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\r/g, '')
    .replace(/\n/g, '')
    .replace(/\t/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function extrairChaveEProtocoloAutorizados(xmlRetorno) {
  const texto = String(xmlRetorno || '');
  if (!texto.includes('<cStat>100</cStat>')) return null;

  const matchChave = texto.match(/<chNFe>(\d{44})<\/chNFe>[\s\S]{0,800}?<cStat>100<\/cStat>/i);
  if (!matchChave) return null;

  const chaveAcesso = matchChave[1];
  const bloco = matchChave[0];
  const protNoBloco = bloco.match(/<nProt>(\d+)<\/nProt>/i);
  const protGlobal = texto.match(
    new RegExp(`<chNFe>${chaveAcesso}</chNFe>[\\s\\S]{0,400}?<nProt>(\\d+)</nProt>`, 'i')
  );

  return {
    chaveAcesso,
    protocolo: (protNoBloco && protNoBloco[1]) || (protGlobal && protGlobal[1]) || null
  };
}

module.exports = {
  onlyDigits,
  normalizarTokenCsc,
  normalizarIdCsc,
  extrairUrlHttps,
  padLeft,
  round2,
  formatNumber,
  todayYMD,
  nowDhEmi,
  gerarCodigoNumerico,
  gerarChaveAcesso,
  sha1Hex,
  extrairNumeroNFeDaChave,
  xmlEscape,
  compactarXml,
  normalizarXmlParaSefaz,
  limparCertificadoBase64,
  extrairChaveEProtocoloAutorizados
};
