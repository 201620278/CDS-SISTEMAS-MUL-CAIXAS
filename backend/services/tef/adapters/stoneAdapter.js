const BaseAdapter = require('./BaseAdapter');
const SimulatedGatewayAdapter = require('./SimulatedGatewayAdapter');

function StoneAdapter(config) {
  return new SimulatedGatewayAdapter(config, {
    nome: 'Stone',
    adquirente: 'STONE',
    bandeiraPadrao: 'VISA'
  });
}

module.exports = StoneAdapter;
