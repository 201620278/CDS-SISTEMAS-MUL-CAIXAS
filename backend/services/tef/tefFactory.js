const SitefAdapter = require('./adapters/sitefAdapter');
const SitefRealAdapter = require('./adapters/sitefRealAdapter');
const PaygoAdapter = require('./adapters/paygoAdapter');
const PaygoRealAdapter = require('./adapters/paygoRealAdapter');
const StoneAdapter = require('./adapters/stoneAdapter');
const CieloAdapter = require('./adapters/cieloAdapter');
const RedeAdapter = require('./adapters/redeAdapter');
const GetnetAdapter = require('./adapters/getnetAdapter');
const tefConfigRepository = require('../../repositories/tefConfigRepository');

function ambienteUsaMiddlewareReal(ambiente) {
  const a = String(ambiente || 'simulacao').toLowerCase();
  return a === 'homologacao' || a === 'producao' || a === 'produção';
}

async function obterAdapter() {
  const registro = await tefConfigRepository.buscarConfiguracaoPrincipal();

  if (!registro) {
    throw new Error('TEF não configurado');
  }

  const provedor = String(registro.provedor || '').toLowerCase();
  const usarReal = ambienteUsaMiddlewareReal(registro.ambiente);

  if (provedor === 'sitef') {
    if (usarReal && SitefRealAdapter.podeUsarModoReal()) {
      return new SitefRealAdapter(registro);
    }
    return new SitefAdapter(registro);
  }

  if (provedor === 'paygo') {
    if (usarReal && PaygoRealAdapter.podeUsarModoReal()) {
      return new PaygoRealAdapter(registro);
    }
    return new PaygoAdapter(registro);
  }

  const gateways = {
    stone: StoneAdapter,
    cielo: CieloAdapter,
    rede: RedeAdapter,
    getnet: GetnetAdapter
  };

  const Gateway = gateways[provedor];
  if (!Gateway) {
    throw new Error(`Provedor TEF não suportado: ${provedor}`);
  }

  return new Gateway(registro);
}

module.exports = {
  obterAdapter,
  ambienteUsaMiddlewareReal
};
