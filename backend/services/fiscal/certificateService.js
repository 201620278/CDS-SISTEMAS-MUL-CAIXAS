const fs = require('fs');
const forge = require('node-forge');

function isCaCertificate(cert) {
  const bc = cert.getExtension('basicConstraints');
  return !!(bc && bc.cA === true);
}

function isSelfSigned(cert) {
  try {
    return cert.issuer.hash === cert.subject.hash;
  } catch {
    return false;
  }
}

function bytesToHexSafe(value) {
  try {
    return value ? forge.util.bytesToHex(value) : null;
  } catch {
    return null;
  }
}

function carregarCertificadoPfx(certificadoPath, senha) {
  if (!certificadoPath) {
    throw new Error('Caminho do certificado não configurado.');
  }

  if (!fs.existsSync(certificadoPath)) {
    throw new Error(`Certificado não encontrado em: ${certificadoPath}`);
  }

  const pfxBuffer = fs.readFileSync(certificadoPath);
  const p12Der = forge.util.createBuffer(pfxBuffer.toString('binary'));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, senha || '');

  let privateKeyPem = '';
  let certPem = '';
  let certBase64 = '';
  let certBundlePem = '';

  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] || [];

  if (!keyBags.length || !keyBags[0]?.key) {
    throw new Error('Chave privada não encontrada no PFX.');
  }

  const keyBag = keyBags[0];
  privateKeyPem = forge.pki.privateKeyToPem(keyBag.key);

  const keyLocalKeyId =
    keyBag.attributes &&
    keyBag.attributes.localKeyId &&
    keyBag.attributes.localKeyId[0]
      ? bytesToHexSafe(keyBag.attributes.localKeyId[0])
      : null;

  const certBags =
    p12.getBags({ bagType: forge.pki.oids.certBag })[
      forge.pki.oids.certBag
    ] || [];

  if (!certBags.length) {
    throw new Error('Nenhum certificado encontrado dentro do PFX.');
  }

  const certs = certBags.filter((bag) => bag?.cert);

  let certBagFolha = null;

  if (keyLocalKeyId) {
    certBagFolha = certs.find((bag) => {
      const certLocalKeyId =
        bag.attributes &&
        bag.attributes.localKeyId &&
        bag.attributes.localKeyId[0]
          ? bytesToHexSafe(bag.attributes.localKeyId[0])
          : null;

      return certLocalKeyId && certLocalKeyId === keyLocalKeyId;
    });
  }

  if (!certBagFolha) {
    certBagFolha = certs.find((bag) => {
      const cert = bag.cert;
      if (!cert) return false;
      return !isCaCertificate(cert);
    }) || certs[0];
  }

  if (!certBagFolha || !certBagFolha.cert) {
    throw new Error('Certificado folha não encontrado no PFX.');
  }

  certPem = forge.pki.certificateToPem(certBagFolha.cert);
  certBase64 = forge.util.encode64(
    forge.asn1.toDer(forge.pki.certificateToAsn1(certBagFolha.cert)).getBytes()
  );

  const intermediarios = certs
    .filter((bag) => bag.cert && bag.cert !== certBagFolha.cert)
    .map((bag) => bag.cert)
    .filter((cert) => isCaCertificate(cert) && !isSelfSigned(cert));

  certBundlePem = [certPem, ...intermediarios.map((c) => forge.pki.certificateToPem(c))].join('\n');

  if (!privateKeyPem || !certPem || !certBase64) {
    throw new Error('Não foi possível extrair chave privada e certificado do PFX.');
  }

  return {
    privateKeyPem,
    certPem,
    certBase64,
    certBundlePem
  };
}

function limparNomeEmpresaCertificado(nome) {
  return String(nome || '')
    .replace(/:\d{14}$/, '')
    .trim();
}

function extrairCnpjDoCertificado(certificadoPath, senha) {
  try {
    const pfx = carregarCertificadoPfx(certificadoPath, senha);
    const cert = forge.pki.certificateFromPem(pfx.certPem);
    const subject = cert.subject;

    if (!subject?.attributes) {
      return null;
    }

    const cnpjOid = subject.attributes.find((attr) =>
      attr.type === '2.16.76.1.3.3' ||
      attr.name === '2.16.76.1.3.3'
    );

    if (cnpjOid?.value) {
      const cnpj = String(cnpjOid.value).replace(/\D/g, '');
      if (cnpj.length === 14) {
        return cnpj;
      }
    }

    const cnAttribute = subject.attributes.find((attr) =>
      attr.name === 'commonName' ||
      attr.shortName === 'CN' ||
      attr.type === '2.5.4.3'
    );

    if (cnAttribute?.value) {
      const match = String(cnAttribute.value).match(/:(\d{14})$/);
      if (match) {
        return match[1];
      }
    }

    return null;
  } catch (error) {
    console.error('Erro ao extrair CNPJ do certificado:', error);
    return null;
  }
}

function extrairNomeEmpresaDoCertificado(certificadoPath, senha) {
  try {
    const pfx = carregarCertificadoPfx(certificadoPath, senha);
    const certPem = pfx.certPem;
    const cert = forge.pki.certificateFromPem(certPem);
    
    const subject = cert.subject;
    if (subject && subject.attributes) {
      const cnAttribute = subject.attributes.find(attr => 
        attr.name === 'commonName' || 
        attr.shortName === 'CN' ||
        attr.type === '2.5.4.3'
      );
      
      if (cnAttribute && cnAttribute.value) {
        return limparNomeEmpresaCertificado(cnAttribute.value);
      }
      
      const orgAttribute = subject.attributes.find(attr => 
        attr.name === 'organizationName' || 
        attr.shortName === 'O' ||
        attr.type === '2.5.4.10'
      );
      
      if (orgAttribute && orgAttribute.value) {
        return limparNomeEmpresaCertificado(orgAttribute.value);
      }
    }
    
    return null;
  } catch (error) {
    console.error('Erro ao extrair nome do certificado:', error);
    return null;
  }
}

module.exports = {
  carregarCertificadoPfx,
  extrairNomeEmpresaDoCertificado,
  extrairCnpjDoCertificado,
  limparNomeEmpresaCertificado
};
