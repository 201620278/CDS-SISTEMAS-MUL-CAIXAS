const SimulatedGatewayAdapter = require('./SimulatedGatewayAdapter');

function RedeAdapter(config) {
  return new SimulatedGatewayAdapter(config, {
    nome: 'Rede',
    adquirente: 'REDE',
    bandeiraPadrao: 'VISA'
  });
}

module.exports = RedeAdapter;
