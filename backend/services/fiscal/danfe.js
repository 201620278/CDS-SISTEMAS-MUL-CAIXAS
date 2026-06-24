const QRCode = require('qrcode');

function montarPagamentosDanfe(pagamentos) {
  if (!Array.isArray(pagamentos) || pagamentos.length === 0) {
    return '';
  }

  return pagamentos.map(p => {
    return `${formatarFormaPagamento(p.forma_pagamento)}: ${formatarMoeda(p.valor)}`;
  }).join('\n');
}

function formatarFormaPagamento(forma) {
  const nomes = {
    dinheiro: 'Dinheiro',
    pix: 'Pix',
    cartao: 'Cartão',
    cartao_debito: 'Cartão Débito',
    cartao_credito: 'Cartão Crédito',
    misto: 'Misto'
  };

  return nomes[forma] || forma;
}

function formatarMoeda(valor) {
  return 'R$ ' + Number(valor || 0).toFixed(2).replace('.', ',');
}

function obterQuantidadeFiscalDanfe(item = {}) {
  return Number(item.quantidade_fiscal ?? 0);
}

function obterValorFiscalItemDanfe(item = {}) {
  return Number(item.valor_fiscal ?? 0);
}

// Formata CNPJ: 65957340000150 -> 65.957.340/0001-50
function formatarCNPJ(cnpj) {
  if (!cnpj) return '';
  const numeros = String(cnpj).replace(/\D/g, '');
  if (numeros.length !== 14) return cnpj;
  return numeros.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function formatarCpfCnpj(valor) {
  const v = String(valor || '').replace(/\D/g, '');

  if (v.length === 11) {
    return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  if (v.length === 14) {
    return v.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      '$1.$2.$3/$4-$5'
    );
  }

  return valor || '';
}

async function gerarDanfeHtml({ venda, itens: itensFiscal, empresa, chave, numero, serie, qrCodeUrl, tributos, nota }) {
  console.log("===== DEBUG DANFE AMBIENTE =====");
  console.log("venda.tpAmb:", venda?.tpAmb);
  console.log("venda.ambiente:", venda?.ambiente);
  console.log("nota.tpAmb:", nota?.tpAmb);
  console.log("nota.ambiente:", nota?.ambiente);
  console.log("================================");

  const tpAmbDanfe = Number(
    nota?.tpAmb ||
    nota?.ambiente ||
    venda?.tpAmb ||
    venda?.ambiente ||
    1
  );

  const avisoHomologacao = tpAmbDanfe === 2
    ? `
      <div style="text-align:center; font-weight:bold; margin:8px 0;">
        EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL
      </div>
    `
    : '';

  const qrCodeDataUrl = qrCodeUrl ? await QRCode.toDataURL(qrCodeUrl) : '';

  const itens = Array.isArray(itensFiscal) ? itensFiscal : [];

  const pagamentosLista = Array.isArray(venda.pagamentos) ? venda.pagamentos : [];
  const possuiTipoRecebimento = pagamentosLista.some((p) => p.tipo_recebimento);
  const pagamentosFiscal = possuiTipoRecebimento
    ? pagamentosLista.filter((p) => p.tipo_recebimento === 'fiscal')
    : pagamentosLista;

  const subtotalItem = (item) => obterValorFiscalItemDanfe(item);

  const totalFiscalItens = itens.reduce((acc, item) => acc + subtotalItem(item), 0);
  const valorNota = Number(venda.valor_fiscal ?? totalFiscalItens);

  const itensHtml = itens.map((item) => {
    const quantidade = obterQuantidadeFiscalDanfe(item);
    const subtotal = subtotalItem(item);
    const precoUnitario = quantidade > 0
      ? subtotal / quantidade
      : Number(item.preco_unitario || 0);
    return `
    <tr>
      <td>${item.produto_nome || ''}</td>
      <td style="text-align:center;">${quantidade}</td>
      <td style="text-align:right;">${precoUnitario.toFixed(2)}</td>
      <td style="text-align:right;">${subtotal.toFixed(2)}</td>
    </tr>
  `;
  }).join('');

  const tributosHtml = tributos ? `
    <p style="font-size: 10px;">Tributos Totais Incidentes (Lei Federal 12.741/2012):</p>
    <p style="font-size: 10px;">ICMS: R$ ${Number(tributos.vICMS || 0).toFixed(2)}</p>
    <p style="font-size: 10px;">PIS: R$ ${Number(tributos.vPIS || 0).toFixed(2)}</p>
    <p style="font-size: 10px;">COFINS: R$ ${Number(tributos.vCOFINS || 0).toFixed(2)}</p>
  ` : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>DANFE NFC-e</title>
  <style>
    body { font-family: monospace; width: 80mm; margin: 0 auto; font-size: 11px; }
    h1,h2,p { margin: 0; padding: 0; }
    .center { text-align: center; }
    table { width: 100%; border-collapse: collapse; }
    td, th { padding: 2px 0; vertical-align: top; }
    .sep { border-top: 1px dashed #000; margin: 6px 0; }
    img { max-width: 100%; }
  </style>
</head>
<body>
  <div class="center">
    <h2>${empresa.nome || ''}</h2>
    <p>CNPJ: ${formatarCNPJ(empresa.cnpj)}</p>
    <p>${empresa.endereco || ''}</p>
    <p>DANFE NFC-e - Documento Auxiliar</p>
    <p>NFC-e nº ${numero} Série ${serie}</p>
    ${(
      venda.cpf_cnpj_nota ||
      venda.cliente_cpf
    ) ? `
<div style="margin-top: 5px;">
  <strong>CPF/CNPJ do Consumidor:</strong>
  ${formatarCpfCnpj(venda.cpf_cnpj_nota || venda.cliente_cpf)}
</div>
` : ''}
  </div>
  <div class="sep"></div>
  <table>
    <thead>
      <tr><th>Item</th><th>Qtd</th><th>Vl.Unit</th><th>Total</th></tr>
    </thead>
    <tbody>${itensHtml}</tbody>
  </table>
  <div class="sep"></div>
  <p>Total: R$ ${valorNota.toFixed(2)}</p>
  <p>Desconto: R$ ${Number(venda.desconto || 0).toFixed(2)}</p>
  ${montarPagamentosDanfe(pagamentosFiscal) ? `<p>${montarPagamentosDanfe(pagamentosFiscal).replace(/\n/g, '<br>')}</p>` : ''}
  <div class="sep"></div>
  ${tributosHtml}
  <div class="sep"></div>
  <p>Consulte pela chave de acesso:</p>
  <p>${chave}</p>
  ${qrCodeDataUrl ? `<div class="center"><img src="${qrCodeDataUrl}" alt="QR Code"/><p>Consulte via QR Code</p></div>` : ''}
  <div class="sep"></div>
  ${avisoHomologacao}
</body>
</html>`;
}

module.exports = { gerarDanfeHtml };