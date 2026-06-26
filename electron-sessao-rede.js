let sessaoClienteRemoto = null;

function definirSessaoClienteRemoto(config) {
  if (!config || !config.ipServidor) {
    sessaoClienteRemoto = null;
    return;
  }

  sessaoClienteRemoto = {
    ipServidor: String(config.ipServidor).trim(),
    porta: Number(config.porta) > 0 ? Number(config.porta) : 3001
  };
}

function obterSessaoClienteRemoto() {
  if (!sessaoClienteRemoto) {
    return null;
  }

  return {
    modo: 'cliente',
    ipServidor: sessaoClienteRemoto.ipServidor,
    porta: sessaoClienteRemoto.porta
  };
}

function estaEmSessaoClienteRemoto() {
  return Boolean(sessaoClienteRemoto);
}

module.exports = {
  definirSessaoClienteRemoto,
  obterSessaoClienteRemoto,
  estaEmSessaoClienteRemoto
};
