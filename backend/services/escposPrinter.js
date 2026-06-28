const escpos = require('escpos');
const { formatarLinhasItemCupomEscpos } = require('./vendaUnidadeHelpers');

escpos.USB = require('escpos-usb');

function formatarMoeda(valor) {
  return Number(valor || 0).toFixed(2).replace('.', ',');
}

function montarLinhasCupom(payload) {
  const vendaId = payload.vendaId || '-';
  const itens = Array.isArray(payload.itens) ? payload.itens : [];
  const desconto = Number(payload.desconto || 0);
  const total = Number(payload.total || 0);
  const subtotal = total + desconto;

  const formaPagamentoTexto = {
    dinheiro: 'Dinheiro',
    cartao_credito: 'Cartao Credito',
    cartao_debito: 'Cartao Debito',
    pix: 'PIX',
    prazo: 'A Prazo'
  }[String(payload.forma_pagamento || '').toLowerCase()] || (payload.forma_pagamento || '-');

  const linhas = [
    'MERCADAO DA ECONOMIA',
    '-----------------------------',
    `Venda: ${vendaId}`,
    `Data: ${new Date().toLocaleString('pt-BR')}`,
    'COMPROVANTE NAO FISCAL',
    '-----------------------------'
  ];

  itens.forEach((item) => {
    formatarLinhasItemCupomEscpos(item).forEach((linha) => linhas.push(linha));
  });

  linhas.push('-----------------------------');
  linhas.push(`SUBTOTAL: ${formatarMoeda(subtotal)}`);
  linhas.push(`DESCONTO: ${formatarMoeda(desconto)}`);
  linhas.push(`TOTAL: ${formatarMoeda(total)}`);
  linhas.push(`PAGAMENTO: ${formaPagamentoTexto}`);

  if (payload.cliente_nome) {
    linhas.push(`CLIENTE: ${String(payload.cliente_nome).slice(0, 26)}`);
  }

  linhas.push('-----------------------------');
  linhas.push('Obrigado pela preferencia!');

  return linhas;
}

function imprimirCupomEscPos(payload = {}) {
  return new Promise((resolve, reject) => {
    let device;

    try {
      device = new escpos.USB();
    } catch (error) {
      reject(new Error(`Nao foi possivel acessar impressora USB: ${error.message}`));
      return;
    }

    const printer = new escpos.Printer(device);
    const linhas = montarLinhasCupom(payload);

    device.open((err) => {
      if (err) {
        reject(new Error(`Falha ao abrir impressora USB: ${err.message || err}`));
        return;
      }

      try {
        printer.align('CT');
        linhas.forEach((linha) => printer.text(linha));
        printer.cut().close();
        resolve({ success: true });
      } catch (printError) {
        reject(new Error(`Falha ao imprimir cupom: ${printError.message}`));
      }
    });
  });
}

module.exports = { imprimirCupomEscPos };
