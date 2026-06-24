const SimulatedGatewayAdapter = require('./SimulatedGatewayAdapter');

function GetnetAdapter(config) {
  return new SimulatedGatewayAdapter(config, {
    nome: 'Getnet',
    adquirente: 'GETNET',
    bandeiraPadrao: 'VISA'
  });
}

module.exports = GetnetAdapter;
