const http = require('http');
const { dialog } = require('electron');
const { tratarFalhaConexaoRemota } = require('./electron-rede-recuperacao');

function testarServidorRemoto(ip, porta, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!ip || !porta) {
      resolve(false);
      return;
    }

    const req = http.get(
      {
        host: ip,
        port: porta,
        path: '/api/ping',
        timeout: timeoutMs
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.on('error', () => resolve(false));
  });
}

async function confirmarModoLocalEmergencia(modulo) {
  if (modulo !== 'pdv') {
    return true;
  }

  const result = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancelar', 'Usar servidor local'],
    defaultId: 0,
    cancelId: 0,
    title: 'Modo emergência no PDV',
    message: 'Transformar este terminal em servidor local?',
    detail:
      'Use somente em emergência. Este computador deixará de ser terminal cliente e passará a usar um banco local separado do servidor principal.\n\n' +
      'Para voltar ao modo cliente depois, abra Configuração de Rede (Super Admin) e informe o IP do servidor novamente.'
  });

  return result.response === 1;
}

/**
 * Testa o servidor remoto antes de abrir a janela do Electron.
 * Evita ERR_CONNECTION_REFUSED e oferece recuperação com "Tentar novamente" como padrão.
 */
async function iniciarConexaoClienteRemoto({
  configServidor,
  modulo = 'erp',
  abrirJanelaRemota,
  iniciarServidorLocal,
  encerrarApp
}) {
  const destino = `${configServidor.ipServidor}:${configServidor.porta}`;
  const urlBase = `http://${destino}`;

  // eslint-disable-next-line no-constant-condition
  while (true) {
  // eslint-disable-next-line no-await-in-loop
    const online = await testarServidorRemoto(configServidor.ipServidor, configServidor.porta);

    if (online) {
      console.log(`Servidor remoto online em ${destino}. Abrindo aplicativo...`);
      return abrirJanelaRemota(urlBase, configServidor);
    }

    console.warn(`Servidor remoto indisponível em ${destino}.`);

    // eslint-disable-next-line no-await-in-loop
    const acao = await tratarFalhaConexaoRemota({
      error: new Error('Servidor não respondeu. Verifique se o PC servidor está ligado e o sistema aberto.'),
      configServidor,
      remoteUrl: urlBase,
      modulo
    });

    if (acao === 'retry') {
      continue;
    }

    if (acao === 'local') {
      // eslint-disable-next-line no-await-in-loop
      const confirmado = await confirmarModoLocalEmergencia(modulo);
      if (!confirmado) {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      return iniciarServidorLocal();
    }

    return encerrarApp();
  }
}

module.exports = {
  testarServidorRemoto,
  confirmarModoLocalEmergencia,
  iniciarConexaoClienteRemoto
};
