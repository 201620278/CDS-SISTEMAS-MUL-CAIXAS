const { dialog } = require('electron');

async function tratarFalhaConexaoRemota({ error, configServidor, remoteUrl }) {
  const destino = configServidor
    ? `${configServidor.ipServidor}:${configServidor.porta}`
    : (remoteUrl || 'servidor remoto');

  const result = await dialog.showMessageBox({
    type: 'error',
    title: 'Servidor remoto indisponível',
    message: 'Não foi possível conectar ao servidor remoto.',
    detail: `${error?.message || 'Erro de conexão'}\n\nDestino: ${destino}\n\nVocê pode tentar novamente ou voltar ao servidor local deste computador — sem precisar abrir as configurações no servidor.`,
    buttons: ['Sair', 'Tentar novamente', 'Usar servidor local'],
    defaultId: 2,
    cancelId: 0
  });

  if (result.response === 1) return 'retry';
  if (result.response === 2) return 'local';
  return 'quit';
}

function aplicarRecuperacaoModoLocal() {
  const configService = require('./backend/services/configuracaoService');
  configService.voltarModoLocalEstacao();
}

module.exports = {
  tratarFalhaConexaoRemota,
  aplicarRecuperacaoModoLocal
};
