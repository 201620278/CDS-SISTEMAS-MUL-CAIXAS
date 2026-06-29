const { dialog } = require('electron');

async function tratarFalhaConexaoRemota({ error, configServidor, remoteUrl, modulo = 'erp' }) {
  const destino = configServidor
    ? `${configServidor.ipServidor}:${configServidor.porta}`
    : (remoteUrl || 'servidor remoto');

  const isPdv = modulo === 'pdv';

  const detailPdv =
    `${error?.message || 'Erro de conexão'}\n\n` +
    `Servidor configurado: ${destino}\n\n` +
    'Este PDV está em modo cliente e depende do PC servidor estar ligado com o sistema aberto.\n\n' +
    '• Confirme se o servidor está rodando em ' + destino + '\n' +
    '• Clique em "Tentar novamente" após iniciar o servidor\n' +
    '• "Servidor local" é só emergência neste computador';

  const detailErp =
    `${error?.message || 'Erro de conexão'}\n\n` +
    `Destino: ${destino}\n\n` +
    'Você pode tentar novamente ou voltar ao servidor local deste computador.';

  const result = await dialog.showMessageBox({
    type: 'error',
    title: isPdv ? 'Servidor do caixa indisponível' : 'Servidor remoto indisponível',
    message: isPdv
      ? 'Não foi possível conectar ao servidor configurado para este PDV.'
      : 'Não foi possível conectar ao servidor remoto.',
    detail: isPdv ? detailPdv : detailErp,
    buttons: ['Sair', 'Tentar novamente', 'Usar servidor local'],
    defaultId: 1,
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
