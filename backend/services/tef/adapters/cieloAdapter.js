const SimulatedGatewayAdapter = require('./SimulatedGatewayAdapter');

function CieloAdapter(config) {
  return new SimulatedGatewayAdapter(config, {
    nome: 'Cielo',
    adquirente: 'CIELO',
    bandeiraPadrao: 'VISA'
  });
}

module.exports = CieloAdapter;
