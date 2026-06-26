const {
  validarItemComercialFracionadoFiscal
} = require('./unidadeFiscal');

function onlyDigits(str) {
  return String(str || '').replace(/\D/g, '');
}

function validarProdutoFiscal(item) {
  const erros = [];

  const nome = item.nome || item.xProd || item.produto_nome || 'Produto sem nome';

  const ncm = onlyDigits(item.ncm || item.produto_ncm || '');
  const cest = onlyDigits(item.cest || item.produto_cest || '');

  if (ncm.length !== 8) {
    erros.push(`❌ ${nome}: NCM inválido (deve ter 8 dígitos)`);
  }

  if (cest && cest.length !== 7) {
    erros.push(`❌ ${nome}: CEST inválido (deve ter 7 dígitos)`);
  }

  return erros;
}

function validarItensFiscal(itens, ambiente = 2) {
  const erros = [];

  itens.forEach(item => {
    erros.push(...validarProdutoFiscal(item));
    erros.push(...validarItemComercialFracionadoFiscal(item));
  });

  // Em PRODUÇÃO trava tudo
  if (ambiente === 1 && erros.length > 0) {
    throw new Error(
      'Corrija os dados fiscais antes de emitir:\n\n' +
      erros.join('\n')
    );
  }

  return erros;
}

module.exports = {
  validarItensFiscal
};
