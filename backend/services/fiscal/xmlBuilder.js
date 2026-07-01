const {
  formatNumber,
  gerarChaveAcesso,
  gerarCodigoNumerico,
  nowDhEmi,
  onlyDigits,
  padLeft,
  round2,
  sha1Hex,
  xmlEscape
} = require('./utils');

const { gerarQRCodeNFCe } = require('./qrcode');
const { extrairNomeEmpresaDoCertificado, extrairCnpjDoCertificado } = require('./certificateService');
const { normalizarUnidadeComercialFiscal } = require('./unidadeFiscal');

function normalizarCsosn(valor, padrao = '102') {
  const digits = String(valor ?? '').replace(/\D/g, '');
  if (!digits) {
    return String(padrao || '102').replace(/\D/g, '').padStart(3, '0').slice(-3);
  }
  return digits.padStart(3, '0').slice(-3);
}

function montarBlocoIcmsSimplesNacional(origem, csosnRaw, csosnPadrao = '102') {
  const orig = origem != null && origem !== '' ? Number(origem) : 0;
  const csosn = normalizarCsosn(csosnRaw, csosnPadrao);

  if (['102', '103', '300', '400'].includes(csosn)) {
    return `
            <ICMSSN102>
              <orig>${orig}</orig>
              <CSOSN>${csosn}</CSOSN>
            </ICMSSN102>`;
  }

  if (csosn === '101') {
    return `
            <ICMSSN101>
              <orig>${orig}</orig>
              <CSOSN>101</CSOSN>
              <pCredSN>0.00</pCredSN>
              <vCredICMSSN>0.00</vCredICMSSN>
            </ICMSSN101>`;
  }

  if (csosn === '500') {
    return `
            <ICMSSN500>
              <orig>${orig}</orig>
              <CSOSN>500</CSOSN>
            </ICMSSN500>`;
  }

  if (csosn === '900') {
    return `
            <ICMSSN900>
              <orig>${orig}</orig>
              <CSOSN>900</CSOSN>
              <modBC>3</modBC>
              <vBC>0.00</vBC>
              <pICMS>0.00</pICMS>
              <vICMS>0.00</vICMS>
            </ICMSSN900>`;
  }

  throw new Error(
    `CSOSN ${csosn} inválido para NFC-e. Use 102, 103, 300, 400, 500 ou 900 no cadastro do produto.`
  );
}

function splitEnderecoLivre(endereco) {
  const texto = String(endereco || '').trim();

  if (!texto) {
    return { xLgr: '', nro: 'S/N', xBairro: '', cMun: '', xMun: '', UF: '', CEP: '' };
  }

  const partes = texto.split(',');
  return {
    xLgr: (partes[0] || '').trim(),
    nro: (partes[1] || 'S/N').trim(),
    xBairro: (partes[2] || '').trim()
  };
}

function mapearFormaPagamento(forma) {
  const normalizada = String(forma || '').toLowerCase().trim();

  const mapa = {
    dinheiro: '01',
    cheque: '02',
    cartao: '03',
    cartao_credito: '03',
    cartao_debito: '04',
    credito: '05',
    credito_loja: '05',
    vale_alimentacao: '10',
    vale_refeicao: '11',
    vale_presente: '12',
    vale_combustivel: '13',
    boleto: '15',
    deposito: '16',
    pix: '17',
    pix_tef: '17',
    transferencia: '18',
    programa_fidelidade: '19',
    sem_pagamento: '90',
    misto: '99',
    outro: '99',
    prazo: '99'
  };

  return mapa[normalizada] || '99';
}

function obterDescricaoPagamento(forma, tPag) {
  if (tPag !== '99') {
    return null;
  }

  const normalizada = String(forma || '').toLowerCase().trim();
  const descricoes = {
    outro: 'Outros',
    prazo: 'Venda a prazo',
    misto: 'Pagamento misto',
    cartao_pf: 'Cartao PF'
  };

  return descricoes[normalizada] || 'Outros';
}

function resolverTefPagamento(pagamento, dadosVenda = {}) {
  if (pagamento.tef) {
    return pagamento.tef;
  }

  if (pagamento.nsu || pagamento.autorizacao) {
    return {
      nsu: pagamento.nsu,
      autorizacao: pagamento.autorizacao,
      bandeira: pagamento.bandeira,
      cnpj_credenciadora: pagamento.cnpj_credenciadora
    };
  }

  return dadosVenda.tef || null;
}

function resolverPagamentosNfce(venda, totalFiscal) {
  const pagamentosBrutos = Array.isArray(venda?.pagamentos) ? venda.pagamentos : [];
  let pagamentosFiscais = pagamentosBrutos.filter((p) => (
    !p.tipo_recebimento || p.tipo_recebimento === 'fiscal'
  ));

  if (pagamentosFiscais.length === 0 && venda?.forma_pagamento) {
    pagamentosFiscais = [{
      forma_pagamento: venda.forma_pagamento,
      valor: totalFiscal
    }];
  }

  if (pagamentosFiscais.length === 0) {
    pagamentosFiscais = [{
      forma_pagamento: 'dinheiro',
      valor: totalFiscal
    }];
  }

  const somaPagamentos = pagamentosFiscais.reduce(
    (total, pagamento) => total + Number(pagamento.valor || 0),
    0
  );

  if (Math.abs(somaPagamentos - totalFiscal) > 0.01 && pagamentosFiscais.length === 1) {
    pagamentosFiscais = [{
      ...pagamentosFiscais[0],
      valor: totalFiscal
    }];
  }

  return pagamentosFiscais;
}

function montarPagamentos(pagamentos, dadosVenda = {}) {
  let xml = '<pag>';

  pagamentos.forEach(p => {
    const formaPagamento = p.forma_pagamento || p.tipo || '';
    const tPag = mapearFormaPagamento(formaPagamento);
    const xPag = p.xPag || p.descricao_pagamento || obterDescricaoPagamento(formaPagamento, tPag);

    xml += `
      <detPag>
        <tPag>${tPag}</tPag>
    `;

    if (xPag) {
      xml += `<xPag>${xmlEscape(String(xPag).substring(0, 60))}</xPag>`;
    }

    xml += `<vPag>${Number(p.valor).toFixed(2)}</vPag>`;

    const tef = resolverTefPagamento(p, dadosVenda);

    if (tef && ['03', '04', '17'].includes(tPag)) {
      xml += `
        <card>
          <tpIntegra>1</tpIntegra>
      `;

      const cnpjCredenciadora = onlyDigits(
        (tef && tef.cnpj_credenciadora) ||
        (tef && tef.cnpjCredenciadora) ||
        '01425787000104'
      );

      if (cnpjCredenciadora && cnpjCredenciadora.length === 14) {
        xml += `<CNPJ>${cnpjCredenciadora}</CNPJ>`;
      }

      if (tPag === '03' || tPag === '04') {
        const bandeira = String(tef.bandeira || p.bandeira || '').toUpperCase();

        let tBand = '99';

        if (bandeira.includes('VISA')) tBand = '01';
        else if (bandeira.includes('MASTERCARD') || bandeira.includes('MASTER')) tBand = '02';
        else if (bandeira.includes('AMEX')) tBand = '03';
        else if (bandeira.includes('SOROCRED')) tBand = '04';
        else if (bandeira.includes('DINERS')) tBand = '05';
        else if (bandeira.includes('ELO')) tBand = '06';
        else if (bandeira.includes('HIPER')) tBand = '07';
        else if (bandeira.includes('AURA')) tBand = '08';
        else if (bandeira.includes('CABAL')) tBand = '09';

        xml += `<tBand>${tBand}</tBand>`;
      }

      const autorizacao = tef.autorizacao || p.autorizacao || tef.nsu || p.nsu;

      if (autorizacao) {
        xml += `<cAut>${String(autorizacao).substring(0, 20)}</cAut>`;
      }

      xml += `</card>`;
    } else if (['03', '04', '17'].includes(tPag)) {
      xml += `
        <card>
          <tpIntegra>2</tpIntegra>
        </card>
      `;
    }

    xml += `</detPag>`;
  });

  xml += '</pag>';

  return xml;
}

function gerarQrCodeUrl({
  consultaUrl,
  chave,
  versaoQrCode = '3',
  tpAmb
}) {
  if (!consultaUrl) {
    return '';
  }

  const dados = [
    chave,
    versaoQrCode,
    tpAmb
  ].join('|');

  const base = consultaUrl.replace(/\/+$/, '');

  return `${base}?p=${dados}`;
}

function montarInfNFeSupl({ qrCodeUrl, urlChave }) {
  if (!qrCodeUrl || !urlChave) {
    return '';
  }

  return `<infNFeSupl><qrCode><![CDATA[${qrCodeUrl}]]></qrCode><urlChave>${xmlEscape(urlChave)}</urlChave></infNFeSupl>`;
}

function anexarInfNFeSupl(xmlAssinado, infNFeSupl) {
  if (!infNFeSupl) {
    return xmlAssinado;
  }

  const xml = String(xmlAssinado || '');

  if (xml.includes('<infNFeSupl>')) {
    return xml;
  }

  if (!xml.includes('</infNFe>')) {
    throw new Error('Tag </infNFe> não encontrada ao anexar infNFeSupl.');
  }

  return xml.replace('</infNFe>', `</infNFe>${infNFeSupl}`);
}

function codigoInternoOuBalanca(codigo) {
  const ean = onlyDigits(codigo || '');
  return /^2\d{12}$/.test(ean);
}

function gtinValido(codigo) {
  const ean = onlyDigits(codigo || '');

  if (![8, 12, 13, 14].includes(ean.length)) {
    return false;
  }

  const numeros = ean.split('').map(Number);
  const digito = numeros.pop();

  let soma = 0;
  let peso = 3;

  for (let i = numeros.length - 1; i >= 0; i--) {
    soma += numeros[i] * peso;
    peso = peso === 3 ? 1 : 3;
  }

  const calculado = (10 - (soma % 10)) % 10;
  return calculado === digito;
}

function montarDestinatarioNFCe(cpfCnpj) {
  const doc = onlyDigits(cpfCnpj || '');

  if (!doc) {
    return '';
  }

  if (doc.length === 11) {
    return `
    <dest>
      <CPF>${doc}</CPF>
      <indIEDest>9</indIEDest>
    </dest>`;
  }

  if (doc.length === 14) {
    return `
    <dest>
      <CNPJ>${doc}</CNPJ>
      <indIEDest>9</indIEDest>
    </dest>`;
  }

  return '';
}

function calcularDigitoGTIN(codigoSemDigito) {
  const numeros = String(codigoSemDigito).replace(/\D/g, "");
  let soma = 0;
  let peso = 3;

  for (let i = numeros.length - 1; i >= 0; i--) {
    soma += Number(numeros[i]) * peso;
    peso = peso === 3 ? 1 : 3;
  }

  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

function gtinValido(codigo) {
  const gtin = String(codigo || "").replace(/\D/g, "");

  if (![8, 12, 13, 14].includes(gtin.length)) {
    return false;
  }

  // Bloqueia códigos internos/pesáveis usados por mercados.
  // Ex: 2000000000017, 210..., 220..., 29...
  if (gtin.startsWith("2")) {
    return false;
  }

  const corpo = gtin.slice(0, -1);
  const digitoInformado = Number(gtin.slice(-1));
  const digitoCalculado = calcularDigitoGTIN(corpo);

  return digitoInformado === digitoCalculado;
}

function obterEANFiscal(produto) {
  const codigo = String(
    produto?.codigo_barras ||
    produto?.codigo_barra ||
    produto?.ean ||
    produto?.cEAN ||
    ""
  ).replace(/\D/g, "");

  if (!codigo) {
    return "SEM GTIN";
  }

  if (!gtinValido(codigo)) {
    return "SEM GTIN";
  }

  return codigo;
}

function obterQuantidadeFiscalItem(item = {}) {
  return Number(item.quantidade_fiscal ?? 0);
}

function obterValorFiscalItem(item = {}) {
  return Number(item.valor_fiscal ?? 0);
}

function obterPrecoUnitarioFiscalItem(item = {}) {
  const quantidade = obterQuantidadeFiscalItem(item);
  const valor = obterValorFiscalItem(item);
  if (quantidade > 0 && valor > 0) {
    return valor / quantidade;
  }
  return Number(item.preco_unitario || 0);
}

function ratearDescontoNosItens(itens, descontoTotal) {
  const desconto = Number(descontoTotal || 0);

  if (!desconto || desconto <= 0 || !Array.isArray(itens) || itens.length === 0) {
    return itens.map(item => ({
      ...item,
      desconto_rateado: 0
    }));
  }

  const totalProdutos = itens.reduce(
    (soma, item) => soma + obterValorFiscalItem(item),
    0
  );

  if (totalProdutos <= 0) {
    return itens.map(item => ({
      ...item,
      desconto_rateado: 0
    }));
  }

  let somaDescontos = 0;

  const itensComDesconto = itens.map((item, index) => {
    const totalItem = obterValorFiscalItem(item);

    let descontoItem;

    if (index === itens.length - 1) {
      descontoItem = round2(desconto - somaDescontos);
    } else {
      descontoItem = round2((totalItem / totalProdutos) * desconto);
      somaDescontos += descontoItem;
    }

    if (descontoItem < 0) descontoItem = 0;
    if (descontoItem > totalItem) descontoItem = totalItem;

    return {
      ...item,
      desconto_rateado: descontoItem
    };
  });

  return itensComDesconto;
}

function buildNfceXml({ config, venda, itens, numero }) {
  const dhEmi = nowDhEmi();
  const aamm = dhEmi.slice(2, 4) + dhEmi.slice(5, 7);
  const cNF = gerarCodigoNumerico();

  const totalFiscal = itens.reduce(
    (total, item) => total + obterValorFiscalItem(item),
    0
  );

  const chave = gerarChaveAcesso({
    uf: config.codigoUf,
    aamm,
    cnpj: config.cnpj,
    modelo: '65',
    serie: config.serie,
    numero,
    tpEmis: '1',
    cNF
  });

  const enderecoLivre = splitEnderecoLivre(config.endereco);

  let nomeEmpresaCertificado = null;
  let cnpjCertificado = null;
  if (config.certificadoPath && config.certificadoSenha) {
    try {
      nomeEmpresaCertificado = extrairNomeEmpresaDoCertificado(config.certificadoPath, config.certificadoSenha);
      cnpjCertificado = extrairCnpjDoCertificado(config.certificadoPath, config.certificadoSenha);
    } catch (error) {
      console.error('Erro ao extrair dados do certificado, usando configuração:', error);
    }
  }

  const nomeEmpresa = nomeEmpresaCertificado || config.nomeEmpresa || 'EMPRESA NAO INFORMADA';
  const cnpjEmitente = onlyDigits(config.cnpj || cnpjCertificado || '');

  if (!cnpjEmitente || cnpjEmitente.length !== 14) {
    throw new Error('CNPJ do emitente inválido. Preencha nas configurações ou use um certificado com CNPJ.');
  }
  
  // Generate xFant by removing corporate suffixes (LTDA, EIRELI, ME, etc.)
  const xFant = nomeEmpresa
    .replace(/\s+(LTDA|EIRELI|ME|EPP|SS|S\/A|S\.A\.|LIMITADA|LIMITADA|SOCIEDADE)\.?$/gi, '')
    .trim() || nomeEmpresa;

  const emit = {
    xNome: nomeEmpresa,
    xFant: xFant,
    CNPJ: cnpjEmitente,
    IE: onlyDigits(config.ie),
    CRT: config.crt,
    enderEmit: {
      xLgr: String(
        config.logradouro ||
        config.endereco ||
        'RUA NAO INFORMADA'
      ).trim()
        .substring(0, 60) || 'RUA NAO INFORMADA',

      nro: (config.numero && String(config.numero).trim() !== '')
        ? String(config.numero).trim()
        : 'S/N',

      xBairro: String(
        config.bairro ||
        'CENTRO'
      ).trim(),

      cMun: String(
        config.municipioCodigo ||
        config.codigo_municipio ||
        '2307304'
      ).trim(),

      xMun: String(
        config.municipioNome ||
        config.municipio ||
        config.cidade ||
        'JUAZEIRO DO NORTE'
      ).trim(),

      UF: String(
        config.uf ||
        'CE'
      ).trim(),

      CEP: String(
        config.cep ||
        '63000000'
      ).replace(/\D/g, ''),

      cPais: '1058',

      xPais: 'BRASIL',

      fone: String(
        config.telefone ||
        ''
      ).replace(/\D/g, '')
    }
  };

  const infAdFisco = config.ambiente === 2
    ? 'EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
    : '';

  const infCplFinal = String(infAdFisco || '').trim();
  const tagInfAdic = infCplFinal
    ? `<infAdic><infCpl>${xmlEscape(infCplFinal)}</infCpl></infAdic>`
    : '';

  let vProd = 0;
  const descontoVenda = round2(venda.desconto || venda.desconto_total || 0);
  const itensVenda = ratearDescontoNosItens(itens || [], descontoVenda);
  let vDesc = 0;
  let vNF = totalFiscal;

  const descricaoHomologacao = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

  const dets = itensVenda.map((item, idx) => {
    const quantidade = obterQuantidadeFiscalItem(item);
    const subtotal = round2(obterValorFiscalItem(item));
    const valorUnitario = obterPrecoUnitarioFiscalItem(item);
    const descontoItem = round2(item.desconto_rateado || 0);
    vProd += subtotal;
    vDesc += descontoItem;

    const ncmRaw = onlyDigits(item.ncm || item.produto_ncm || '');
    if (!ncmRaw || ncmRaw.length !== 8) {
      throw new Error(`Produto ${item.produto_nome || item.nome || 'desconhecido'} sem NCM válido (deve ter 8 dígitos).`);
    }
    const ncm = ncmRaw;
    const cfop = item.cfop || '5102';
    const csosnPadrao = config.csosn_padrao || '102';
    const origem = item.origem != null ? Number(item.origem) : 0;
    const cestLimpo = onlyDigits(item.cest || item.produto_cest || item.CEST || '');
    const tagCEST = cestLimpo.length === 7
      ? `<CEST>${cestLimpo}</CEST>`
      : '';
    const unidade = normalizarUnidadeComercialFiscal(item.unidade || item.produto_unidade || 'UN');
    const xProd = Number(config.ambiente) === 2 && idx === 0
      ? descricaoHomologacao
      : item.produto_nome || 'PRODUTO';

    return `
      <det nItem="${idx + 1}">
        <prod>
          <cProd>${xmlEscape(String(item.produto_id || idx + 1))}</cProd>
          <cEAN>${obterEANFiscal(item)}</cEAN>
          <xProd>${xmlEscape(xProd)}</xProd>
          <NCM>${ncm}</NCM>
          ${tagCEST}
          <CFOP>${cfop}</CFOP>
          <uCom>${xmlEscape(unidade)}</uCom>
          <qCom>${formatNumber(quantidade, 4)}</qCom>
          <vUnCom>${formatNumber(valorUnitario, 10)}</vUnCom>
          <vProd>${formatNumber(subtotal, 2)}</vProd>
          <cEANTrib>${obterEANFiscal(item)}</cEANTrib>
          <uTrib>${xmlEscape(unidade)}</uTrib>
          <qTrib>${formatNumber(quantidade, 4)}</qTrib>
          <vUnTrib>${formatNumber(valorUnitario, 10)}</vUnTrib>
          ${descontoItem > 0 ? `<vDesc>${formatNumber(descontoItem, 2)}</vDesc>` : ''}
          <indTot>1</indTot>
        </prod>
        <imposto>
          <ICMS>
            ${montarBlocoIcmsSimplesNacional(origem, item.csosn, csosnPadrao)}
          </ICMS>
          <PIS>
            <PISNT>
              <CST>07</CST>
            </PISNT>
          </PIS>
          <COFINS>
            <COFINSNT>
              <CST>07</CST>
            </COFINSNT>
          </COFINS>
        </imposto>
      </det>
    `;
  }).join('');

  vDesc = round2(vDesc);
  vNF = round2(vProd - vDesc);

  const pagamentosVenda = resolverPagamentosNfce(venda, totalFiscal);

  const pag = montarPagamentos(pagamentosVenda, venda);

  console.log('PAGAMENTO NFCe:', pag);

  const xmlSemAssinatura = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe versao="4.00" Id="NFe${chave}">
    <ide>
      <cUF>${config.codigoUf}</cUF>
      <cNF>${cNF}</cNF>
      <natOp>VENDA NFC-E</natOp>
      <mod>65</mod>
      <serie>${config.serie}</serie>
      <nNF>${numero}</nNF>
      <dhEmi>${dhEmi}</dhEmi>
      <tpNF>1</tpNF>
      <idDest>1</idDest>
      <cMunFG>${config.municipioCodigo}</cMunFG>
      <tpImp>${config.tpImp}</tpImp>
      <tpEmis>1</tpEmis>
      <cDV>${chave.slice(-1)}</cDV>
      <tpAmb>${config.ambiente}</tpAmb>
      <finNFe>1</finNFe>
      <indFinal>1</indFinal>
      <indPres>1</indPres>
      <procEmi>0</procEmi>
      <verProc>CDGESTAO-NFCE-1.0.0</verProc>
    </ide>
    <emit>
      <CNPJ>${emit.CNPJ}</CNPJ>
      <xNome>${xmlEscape(emit.xNome)}</xNome>
      <xFant>${xmlEscape(emit.xFant)}</xFant>
      <enderEmit>
        <xLgr>${xmlEscape(emit.enderEmit.xLgr)}</xLgr>
        <nro>${xmlEscape(emit.enderEmit.nro)}</nro>
        <xBairro>${xmlEscape(emit.enderEmit.xBairro)}</xBairro>
        <cMun>${emit.enderEmit.cMun}</cMun>
        <xMun>${xmlEscape(emit.enderEmit.xMun)}</xMun>
        <UF>${emit.enderEmit.UF}</UF>
        ${emit.enderEmit.CEP ? `<CEP>${emit.enderEmit.CEP}</CEP>` : ''}
        <cPais>${emit.enderEmit.cPais}</cPais>
        <xPais>${emit.enderEmit.xPais}</xPais>
        ${emit.enderEmit.fone ? `<fone>${emit.enderEmit.fone}</fone>` : ''}
      </enderEmit>
      <IE>${emit.IE}</IE>
      <CRT>${emit.CRT}</CRT>
    </emit>
    ${montarDestinatarioNFCe(
      venda.cpf_cnpj_nota ||
      venda.cliente_cpf ||
      venda.cliente_cnpj
    )}
    ${dets}
    <total>
      <ICMSTot>
        <vBC>0.00</vBC>
        <vICMS>0.00</vICMS>
        <vICMSDeson>0.00</vICMSDeson>
        <vFCP>0.00</vFCP>
        <vBCST>0.00</vBCST>
        <vST>0.00</vST>
        <vFCPST>0.00</vFCPST>
        <vFCPSTRet>0.00</vFCPSTRet>
        <vProd>${formatNumber(totalFiscal, 2)}</vProd>
        <vFrete>0.00</vFrete>
        <vSeg>0.00</vSeg>
        <vDesc>${formatNumber(vDesc, 2)}</vDesc>
        <vII>0.00</vII>
        <vIPI>0.00</vIPI>
        <vIPIDevol>0.00</vIPIDevol>
        <vPIS>0.00</vPIS>
        <vCOFINS>0.00</vCOFINS>
        <vOutro>0.00</vOutro>
        <vNF>${formatNumber(totalFiscal, 2)}</vNF>
      </ICMSTot>
    </total>
    <transp>
      <modFrete>9</modFrete>
    </transp>
    ${pag}
    ${tagInfAdic}
  </infNFe>
</NFe>`;

  return {
    chave,
    numero,
    cNF,
    dhEmi,
    xmlSemAssinatura,
    valores: { vProd, vDesc, vNF }
  };
}

module.exports = {
  buildNfceXml,
  ratearDescontoNosItens,
  gerarQrCodeUrl,
  montarInfNFeSupl,
  anexarInfNFeSupl,
  mapearFormaPagamento,
  montarPagamentos,
  resolverPagamentosNfce
};