const { round2 } = require('./utils');

const UNIDADES_FRACIONADAS_PERMITIDAS = ['KG', 'MT', 'LT', 'M2', 'M3'];

function normalizarUnidadeComercialFiscal(unidade) {
  const raw = String(unidade || 'UN').trim();
  const lower = raw.toLowerCase();
  const map = {
    kg: 'KG',
    quilo: 'KG',
    quilos: 'KG',
    mt: 'MT',
    metro: 'MT',
    metros: 'MT',
    m: 'MT',
    lt: 'LT',
    l: 'LT',
    litro: 'LT',
    litros: 'LT',
    m2: 'M2',
    'm²': 'M2',
    m3: 'M3',
    'm³': 'M3'
  };

  if (map[lower]) return map[lower];

  const upper = raw.toUpperCase().replace(/²/g, '2').replace(/³/g, '3');
  if (UNIDADES_FRACIONADAS_PERMITIDAS.includes(upper)) return upper;
  return upper;
}

function produtoUsaConversaoUnidadesFiscal(item = {}) {
  return Number(item.produto_fracionado ?? item.vendido_por_peso ?? 0) === 1;
}

const produtoEhFracionadoFiscal = produtoUsaConversaoUnidadesFiscal;

function obterQuantidadeComercialFiscal(item = {}) {
  return Number(item.quantidade_fiscal ?? item.quantidade ?? 0);
}

function obterValorComercialFiscal(item = {}) {
  return Number(item.valor_fiscal ?? item.subtotal ?? 0);
}

function obterPrecoUnitarioComercialFiscal(item = {}) {
  const qCom = obterQuantidadeComercialFiscal(item);
  const valor = obterValorComercialFiscal(item);
  if (qCom > 0 && valor > 0) {
    return valor / qCom;
  }
  return Number(item.preco_unitario || 0);
}

function validarItemComercialConversaoUnidadesFiscal(item = {}) {
  const erros = [];
  if (!produtoUsaConversaoUnidadesFiscal(item)) return erros;

  const nome = item.produto_nome || item.nome || 'Produto';
  const uCom = normalizarUnidadeComercialFiscal(item.unidade || item.produto_unidade);
  const qCom = obterQuantidadeComercialFiscal(item);
  const vProd = obterValorComercialFiscal(item);
  const vUnCom = obterPrecoUnitarioComercialFiscal(item);

  if (!UNIDADES_FRACIONADAS_PERMITIDAS.includes(uCom)) {
    erros.push(
      `❌ ${nome}: uCom "${uCom}" inválida para conversão de unidades. Use KG, MT, LT, M2 ou M3.`
    );
  }

  if (qCom <= 0) {
    erros.push(`❌ ${nome}: qCom inválida (${qCom}). Informe quantidade convertida.`);
  }

  if (vUnCom <= 0) {
    erros.push(`❌ ${nome}: vUnCom inválido (${vUnCom}).`);
  }

  const totalCalculado = round2(qCom * vUnCom);
  if (Math.abs(totalCalculado - round2(vProd)) > 0.02) {
    erros.push(
      `❌ ${nome}: qCom (${qCom}) × vUnCom (${vUnCom.toFixed(4)}) deve ser ${round2(vProd)}.`
    );
  }

  return erros;
}

const validarItemComercialFracionadoFiscal = validarItemComercialConversaoUnidadesFiscal;

module.exports = {
  UNIDADES_FRACIONADAS_PERMITIDAS,
  normalizarUnidadeComercialFiscal,
  produtoUsaConversaoUnidadesFiscal,
  produtoEhFracionadoFiscal,
  obterQuantidadeComercialFiscal,
  obterValorComercialFiscal,
  obterPrecoUnitarioComercialFiscal,
  validarItemComercialConversaoUnidadesFiscal,
  validarItemComercialFracionadoFiscal
};
