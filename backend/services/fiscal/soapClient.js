const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const { carregarCertificadoPfx } = require('./certificateService');
const { getFiscalSubDir } = require('./paths');

const SEFAZ_TIMEOUT_MS = Number(process.env.FISCAL_SOAP_TIMEOUT_MS) || 90000;
const SEFAZ_MAX_TENTATIVAS = 2;

function mensagemErroSefaz(error) {
  if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '')) {
    return `A SEFAZ não respondeu em ${Math.round(SEFAZ_TIMEOUT_MS / 1000)}s. Tente emitir novamente.`;
  }

  const resposta = error.response?.data;
  if (typeof resposta === 'string' && resposta.length > 500) {
    return `Erro na comunicação com a SEFAZ (HTTP ${error.response?.status || 'sem status'}).`;
  }

  return resposta || error.message || String(error);
}

function aguardar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function salvarDebug(nome, conteudo) {
  const pasta = getFiscalSubDir('debug');
  fs.writeFileSync(path.join(pasta, nome), conteudo, 'utf8');
}

function validarXmlAntesDeEnviar(xml) {
  if (!xml) {
    throw new Error('XML vazio antes do envio.');
  }

  const matchCert = xml.match(/<X509Certificate>(.*?)<\/X509Certificate>/);
  if (matchCert && /\s/.test(matchCert[1])) {
    throw new Error('X509Certificate contém espaços ou quebras internas.');
  }

  return true;
}

function removerDeclaracaoXml(xml) {
  return String(xml || '')
    .replace(/^\s*<\?xml[^>]*\?>\s*/i, '')
    .trim();
}

function montarLote(xmlAssinado, idLote) {
  const nfeXml = removerDeclaracaoXml(xmlAssinado);

  return (
    `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
      `<idLote>${idLote}</idLote>` +
      `<indSinc>1</indSinc>` +
      `${nfeXml}` +
    `</enviNFe>`
  );
}

function montarSoapEnvelop(loteXml, cUF = '23', versaoDados = '4.00') {
  const loteSemDeclaracao = String(loteXml || '')
    .replace(/^\s*<\?xml[^>]*\?>\s*/i, '')
    .trim();

  return (`<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
      `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
      `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
      `<soap12:Header>` +
        `<nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">` +
          `<cUF>${cUF}</cUF>` +
          `<versaoDados>${versaoDados}</versaoDados>` +
        `</nfeCabecMsg>` +
      `</soap12:Header>` +
      `<soap12:Body>` +
        `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">` +
          `${loteSemDeclaracao}` +
        `</nfeDadosMsg>` +
      `</soap12:Body>` +
    `</soap12:Envelope>`);
}

function criarHttpsAgentSefaz({ certificadoPath, certificadoSenha, url }) {
  if (!certificadoPath) {
    throw new Error('Certificado não configurado.');
  }

  const certificado = carregarCertificadoPfx(certificadoPath, certificadoSenha);
  const host = new URL(url).hostname;

  console.log('USANDO CERTIFICADO:', certificadoPath);
  console.log('HOST SEFAZ:', host);

  return new https.Agent({
    key: certificado.privateKeyPem,
    cert: certificado.certBundlePem || certificado.certPem,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2',
    keepAlive: false,
    servername: host
  });
}

async function enviarLote({
  url,
  loteXml,
  certificadoPath,
  certificadoSenha,
  cUF = '23',
  versaoDados = '4.00'
}) {
  if (!url) {
    return {
      success: false,
      status: 'configuracao_pendente',
      message: 'URL de autorização não configurada.'
    };
  }

  const envelope = montarSoapEnvelop(loteXml, cUF, versaoDados);

  validarXmlAntesDeEnviar(envelope);
  salvarDebug('03-xml-lote-enviNFe.xml', loteXml);
  salvarDebug('04-soap-enviado.xml', envelope);

  const httpsAgent = criarHttpsAgentSefaz({
    certificadoPath,
    certificadoSenha,
    url
  });

  console.log('Enviando para SEFAZ URL:', url);
  console.log(`SOAP 1.2 sem wrapper + action explícita (timeout ${SEFAZ_TIMEOUT_MS}ms)`);

  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= SEFAZ_MAX_TENTATIVAS; tentativa++) {
    try {
      const response = await axios.post(url, envelope, {
        httpsAgent,
        proxy: false,
        timeout: SEFAZ_TIMEOUT_MS,
        responseType: 'text',
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        transitional: {
          forcedJSONParsing: false
        },
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote"',
          'Accept': 'application/soap+xml, text/xml, */*',
          'User-Agent': 'CDGESTAO-NFCE/1.0'
        }
      });

      return {
        success: true,
        status: 'soap_enviado',
        raw: response.data
      };
    } catch (error) {
      ultimoErro = error;
      const podeRetentar =
        tentativa < SEFAZ_MAX_TENTATIVAS &&
        (error.code === 'ECONNABORTED' || /timeout/i.test(error.message || ''));

      console.error(`ERRO REAL SEFAZ (tentativa ${tentativa}/${SEFAZ_MAX_TENTATIVAS}):`, error.message);
      console.error('ERRO CODE:', error.code || null);
      console.error('ERRO STATUS HTTP:', error.response?.status || null);
      console.error('ERRO HEADERS:', error.response?.headers || null);
      console.error('ERRO RESPONSE:', error.response?.data || null);

      if (podeRetentar) {
        console.warn('Timeout SEFAZ — nova tentativa em 3s...');
        await aguardar(3000);
        continue;
      }

      console.error('SOAP ENVELOPE ENVIADO:\n', envelope);
      break;
    }
  }

  const error = ultimoErro;

  return {
    success: false,
    status: 'erro_transmissao',
    message: mensagemErroSefaz(error),
    code: error?.code || null
  };
}

module.exports = {
  montarLote,
  montarSoapEnvelop,
  enviarLote,
  montarSoapDFe,
  enviarSoapDFe
};

function montarSoapDFe(xmlConsulta, cUF = '23', versao = '1.01') {
  const xmlSemDeclaracao = String(xmlConsulta || '')
    .replace(/^\s*<\?xml[^>]*\?>\s*/i, '')
    .trim();

  return (`<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
      `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
      `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
      `<soap12:Header>` +
        `<nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">` +
          `<cUF>${cUF}</cUF>` +
          `<versaoDados>${versao}</versaoDados>` +
        `</nfeCabecMsg>` +
      `</soap12:Header>` +
      `<soap12:Body>` +
        `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">` +
          `<nfeDadosMsg>` +
            `${xmlSemDeclaracao}` +
          `</nfeDadosMsg>` +
        `</nfeDistDFeInteresse>` +
      `</soap12:Body>` +
    `</soap12:Envelope>`);
}

async function enviarSoapDFe(envelope, certificadoPath, certificadoSenha, url) {
  if (!url) {
    throw new Error('URL de distribuição DF-e não configurada.');
  }

  validarXmlAntesDeEnviar(envelope);
  salvarDebug('dfe-xml-consulta.xml', envelope);

  try {
    const httpsAgent = criarHttpsAgentSefaz({
      certificadoPath,
      certificadoSenha,
      url
    });

    console.log('Enviando para SEFAZ DF-e URL:', url);
    console.log('SOAP COMPLETO');
    console.log(envelope);

    const response = await axios.post(url, envelope, {
      httpsAgent,
      proxy: false,
      timeout: SEFAZ_TIMEOUT_MS,
      responseType: 'text',
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      transitional: {
        forcedJSONParsing: false
      },
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse"',
        'Accept': 'application/soap+xml, text/xml, */*',
        'User-Agent': 'CDGESTAO-DFE/1.0'
      }
    });

    return response.data;
  } catch (error) {
    console.error('ERRO DF-e:', error.message);
    console.error('ERRO RESPONSE:', error.response?.data || null);
    throw new Error(error.response?.data || error.message);
  }
}