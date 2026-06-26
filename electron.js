const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const { tratarFalhaConexaoRemota, aplicarRecuperacaoModoLocal } = require('./electron-rede-recuperacao');
const {
  definirSessaoClienteRemoto,
  obterSessaoClienteRemoto,
  estaEmSessaoClienteRemoto
} = require('./electron-sessao-rede');

// Configuração do banco de dados
process.env.DB_DIR = process.env.DB_DIR || path.join(
  process.env.PROGRAMDATA || 'C:\\ProgramData',
  'MercantilFiscal',
  'dados'
);

console.log('DB_DIR definido para:', process.env.DB_DIR);

// 🔥 CORREÇÃO DEFINITIVA GPU - Resolve travamentos no Windows
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-features', 'UseSkiaRenderer');

let mainWindow;

// Registrar handlers IPC globalmente (antes de criar a janela)
ipcMain.removeHandler('listar-impressoras');
ipcMain.handle('listar-impressoras', async (event) => {
  try {
    console.log('[IPC] listar-impressoras chamado');
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      console.error('[IPC] Não foi possível obter a janela do evento');
      return [];
    }
    const impressoras = await win.webContents.getPrintersAsync();
    console.log('[IPC] Impressoras encontradas:', impressoras.length);
    return impressoras.map(imp => ({
      name: imp.name,
      description: imp.description,
      status: imp.status,
      isDefault: imp.isDefault
    }));
  } catch (error) {
    console.error('[IPC] Erro ao listar impressoras:', error);
    return [];
  }
});

ipcMain.removeHandler('selecionar-pasta-backup');
ipcMain.handle('selecionar-pasta-backup', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Selecione a pasta de backup'
  });

  if (result.canceled) return null;

  return result.filePaths[0];
});

ipcMain.removeHandler('rede-obter-modo-estacao');
ipcMain.handle('rede-obter-modo-estacao', async () => {
  const sessao = obterSessaoClienteRemoto();
  if (sessao) {
    return sessao;
  }

  const configService = require('./backend/services/configuracaoService');
  return configService.obterModoEstacaoLocal();
});

ipcMain.removeHandler('rede-esta-em-modo-cliente');
ipcMain.handle('rede-esta-em-modo-cliente', async () => estaEmSessaoClienteRemoto());

ipcMain.removeHandler('rede-obter-hostname');
ipcMain.handle('rede-obter-hostname', async () => os.hostname());

ipcMain.removeHandler('rede-voltar-modo-local');
ipcMain.handle('rede-voltar-modo-local', async () => {
  const confirmacao = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Cancelar', 'Voltar ao servidor local'],
    defaultId: 1,
    cancelId: 0,
    title: 'Sair do modo cliente',
    message: 'Voltar para o servidor local?',
    detail: 'O sistema será reiniciado neste computador com o backend local. A conexão com o servidor remoto será desativada nesta estação.'
  });

  if (confirmacao.response !== 1) {
    return { sucesso: false, cancelado: true };
  }

  try {
    const configService = require('./backend/services/configuracaoService');
    configService.voltarModoLocalEstacao();
    app.relaunch();
    app.exit(0);
    return { sucesso: true };
  } catch (error) {
    console.error('Erro ao voltar ao modo local:', error);
    return { sucesso: false, erro: error.message };
  }
});

ipcMain.removeHandler('rede-salvar-modo-estacao');
ipcMain.handle('rede-salvar-modo-estacao', async (_event, body = {}) => {
  try {
    const configService = require('./backend/services/configuracaoService');
    const modoAnterior = configService.getModoRedeElectron().modo;
    const modoNovo = String(body.modo || 'local').trim().toLowerCase() === 'cliente' ? 'cliente' : 'local';

    configService.salvarModoEstacaoLocal({
      modo: modoNovo,
      ipServidor: body.ipServidor,
      porta: body.porta
    });

    if (modoAnterior !== modoNovo) {
      const titulo = modoNovo === 'local' ? 'Usar servidor local' : 'Conectar como cliente';
      const mensagem = modoNovo === 'local'
        ? 'O sistema será reiniciado neste computador com o backend local.'
        : 'O sistema será reiniciado e conectará ao servidor remoto informado.';

      const confirmacao = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Depois', 'Reiniciar agora'],
        defaultId: 1,
        cancelId: 0,
        title: titulo,
        message: 'Reiniciar para aplicar o modo de rede?',
        detail: mensagem
      });

      if (confirmacao.response === 1) {
        app.relaunch();
        app.exit(0);
        return { sucesso: true, reiniciado: true };
      }
    }

    return { sucesso: true, reiniciado: false };
  } catch (error) {
    console.error('Erro ao salvar modo da estação:', error);
    return { sucesso: false, erro: error.message };
  }
});

function obterPortaServidor() {
  const porta = Number.parseInt(process.env.PORT, 10);
  return Number.isFinite(porta) && porta > 0 ? porta : 3001;
}

function esperarServidor(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const inicio = Date.now();

    function tentar() {
      http.get(url, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
        } else {
          repetir();
        }
      }).on('error', repetir);
    }

    function repetir() {
      if (Date.now() - inicio > timeout) {
        reject(new Error('Servidor não respondeu a tempo.'));
        return;
      }
      setTimeout(tentar, 500);
    }

    tentar();
  });
}

function checarPortaLivre(porta) {
  return new Promise((resolve) => {
    const tester = net.createServer();

    tester.once('error', () => {
      resolve(false);
    });

    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });

    tester.listen(porta);
  });
}

async function encontrarPortaDisponivel(portaInicial, tentativas = 20) {
  let portaAtual = portaInicial;

  for (let i = 0; i < tentativas; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const livre = await checarPortaLivre(portaAtual);
    if (livre) {
      return portaAtual;
    }
    portaAtual += 1;
  }

  throw new Error(`Nenhuma porta disponível encontrada a partir de ${portaInicial}.`);
}

function carregarJanelaComRobustez(window, url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    let finalizado = false;

    const timer = setTimeout(() => {
      finalizarComErro(new Error(`Timeout ao carregar ${url}`));
    }, timeout);

    function cleanup() {
      clearTimeout(timer);
      window.webContents.off('did-finish-load', onFinish);
      window.webContents.off('did-fail-load', onFail);
    }

    function finalizarComSucesso() {
      if (finalizado) return;
      finalizado = true;
      cleanup();
      resolve();
    }

    function finalizarComErro(error) {
      if (finalizado) return;
      finalizado = true;
      cleanup();
      reject(error);
    }

    function onFinish() {
      finalizarComSucesso();
    }

    function onFail(event, errorCode, errorDescription, validatedURL, isMainFrame) {
      if (!isMainFrame) return;

      // ERR_ABORTED (-3) é comum em redirecionamentos e não indica queda do backend.
      if (errorCode === -3) {
        return;
      }

      finalizarComErro(
        new Error(`${errorDescription || 'Falha ao carregar página'} (${errorCode}) em ${validatedURL || url}`)
      );
    }

    window.webContents.on('did-finish-load', onFinish);
    window.webContents.on('did-fail-load', onFail);
    window.loadURL(url).catch((error) => {
      const mensagem = String(error && error.message ? error.message : error);
      if (mensagem.includes('ERR_ABORTED')) {
        return;
      }
      finalizarComErro(error);
    });
  });
}

function aguardarListening(server, timeout = 15000) {
  return new Promise((resolve, reject) => {
    if (!server) {
      reject(new Error('Servidor backend não foi inicializado.'));
      return;
    }

    if (server.listening) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Servidor não entrou em listening a tempo.'));
    }, timeout);

    function cleanup() {
      clearTimeout(timer);
      server.off('listening', onListening);
      server.off('error', onError);
    }

    function onListening() {
      cleanup();
      resolve();
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    server.once('listening', onListening);
    server.once('error', onError);
  });
}

function carregarConfiguracaoServidor() {
  if (process.argv.includes('--cds-forcar-local')) {
    console.log('Modo local forçado via argumento --cds-forcar-local');
    return {
      modo: 'local',
      ipServidor: '127.0.0.1',
      porta: obterPortaServidor()
    };
  }

  try {
    const configService = require('./backend/services/configuracaoService');
    configService.consumirFlagForcarModoLocal();
    configService.ensureConfigFile();
    const cfg = configService.readConfig();
    configService.syncElectronConfig(cfg);
    const modoRede = configService.getModoRedeElectron(cfg);
    console.log('CONFIG PATH:', configService.CONFIG_PATH);
    console.log('ELECTRON CONFIG PATH:', configService.ELECTRON_CONFIG_PATH);
    console.log('DB_DIR:', process.env.DB_DIR);
    return modoRede;
  } catch (err) {
    console.warn('Não foi possível ler configuracoes.json, usando configuração padrão.', err.message);
    return {
      modo: 'local',
      ipServidor: '127.0.0.1',
      porta: 3001
    };
  }
}

function injetarHostnameEstacao(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  const hostname = os.hostname();
  const script = `(function(){try{var h=${JSON.stringify(hostname)};sessionStorage.setItem('cds_estacao_hostname',h);window.__CDS_ESTACAO_HOSTNAME__=h;}catch(e){}})();`;
  webContents.executeJavaScript(script, true).catch(() => {});
}

function criarMainWindow(opcoes = {}) {
  const argumentosExtras = [];
  if (opcoes.modoClienteRemoto) {
    const { ipServidor, porta } = opcoes.modoClienteRemoto;
    argumentosExtras.push(`--cds-modo-cliente=${ipServidor}:${porta}`);
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    focusable: true,
    skipTaskbar: false,
    icon: path.join(__dirname, 'assets/icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: argumentosExtras
    }
  });

  global.mainWindow = mainWindow;

  console.log('[ELECTRON] mainWindow criada e definida como global.mainWindow');

  mainWindow.webContents.on('did-finish-load', () => {
    injetarHostnameEstacao(mainWindow.webContents);
  });

  mainWindow.webContents.setWindowOpenHandler(() => {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 420,
        height: 720,
        title: 'Comprovante',
        alwaysOnTop: true,
        autoHideMenuBar: true,
        parent: mainWindow,
        modal: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      }
    };
  });

  mainWindow.webContents.on('did-create-window', (childWindow) => {
    console.log('Janela filha criada via window.open');
    childWindow.setAlwaysOnTop(true);
    childWindow.focus();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  ipcMain.removeAllListeners('forcar-reflow');
  ipcMain.on('forcar-reflow', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        document.body.style.display = 'none';
        document.body.offsetHeight;
        document.body.style.display = '';
        console.log('Reflow forçado pelo Electron');
      `);
    }
  });

  ipcMain.removeAllListeners('abrir-comprovante');
  ipcMain.on('abrir-comprovante', (event, html, options = {}) => {
    const { deviceName, silent = false } = options;

    const cupomWindow = new BrowserWindow({
      width: 380,
      height: 720,
      title: 'DANFE NFC-e',
      parent: mainWindow,
      modal: false,
      show: !silent,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    const htmlFinal = html.replace('</head>', `
    <style>
      @page {
        size: 80mm auto;
        margin: 0;
      }

      html, body {
        width: 76mm !important;
        max-width: 76mm !important;
        margin: 0 auto !important;
        padding: 2mm !important;
        background: #fff !important;
        color: #000 !important;
        font-family: "Courier New", monospace !important;
        font-size: 11px !important;
        line-height: 1.18 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      img {
        display: block !important;
        margin: 8px auto !important;
        width: 180px !important;
        height: 180px !important;
        object-fit: contain !important;
        image-rendering: pixelated !important;
      }

      * {
        box-sizing: border-box !important;
        max-width: 100% !important;
      }

      table {
        width: 100% !important;
        border-collapse: collapse !important;
        table-layout: fixed !important;
      }

      td, th {
        word-break: break-word !important;
      }
    </style>
  </head>`);

    cupomWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(htmlFinal)}`
    );

    cupomWindow.webContents.once('did-finish-load', async () => {
      await cupomWindow.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const imagens = Array.from(document.images);

        if (!imagens.length) {
          setTimeout(resolve, 800);
          return;
        }

        let total = 0;

        imagens.forEach((img) => {
          if (img.complete && img.naturalWidth > 0) {
            total++;
            if (total === imagens.length) setTimeout(resolve, 1000);
          } else {
            img.onload = () => {
              total++;
              if (total === imagens.length) setTimeout(resolve, 1000);
            };
            img.onerror = () => {
              total++;
              if (total === imagens.length) setTimeout(resolve, 1000);
            };
          }
        });
      });
    `);

      const printOptions = {
        silent: true,
        printBackground: true,
        margins: {
          marginType: 'none'
        }
      };

      if (deviceName) {
        printOptions.deviceName = deviceName;
      }

      cupomWindow.webContents.print(printOptions, (success, errorType) => {
        if (success) {
          console.log('[IMPRESSAO] DANFE NFC-e impresso.');
        } else {
          console.error('[IMPRESSAO] Falha:', errorType);
        }

        if (!cupomWindow.isDestroyed()) {
          cupomWindow.close();
        }
      });
    });
  });

  ipcMain.removeHandler('imprimir-danfe-silencioso');
  ipcMain.handle('imprimir-danfe-silencioso', async (event, html, deviceName) => {
    const printWindow = new BrowserWindow({
      width: 420,
      height: 720,
      show: false, // Janela invisível
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    // Aguardar renderização
    await new Promise(resolve => setTimeout(resolve, 500));

    const printOptions = {
      silent: true,
      printBackground: true
    };

    if (deviceName) {
      printOptions.deviceName = deviceName;
    }

    return new Promise((resolve, reject) => {
      printWindow.webContents.print(printOptions, (success, errorType) => {
        // Fechar janela após impressão
        if (!printWindow.isDestroyed()) {
          printWindow.close();
        }

        if (success) {
          resolve({ sucesso: true });
        } else {
          reject(new Error(`Falha na impressão: ${errorType}`));
        }
      });
    });
  });

  return mainWindow;
}

function iniciarBackendLocal() {
  aplicarRecuperacaoModoLocal();
  const portaPreferida = obterPortaServidor();
  return encontrarPortaDisponivel(portaPreferida)
    .then((portaLivre) => {
      process.env.PORT = String(portaLivre);
      console.log(`Porta escolhida para backend local: ${portaLivre}`);
      const server = require('./backend/server');
      return aguardarListening(server).then(() => server);
    })
    .then((server) => {
      const address = server.address();
      const portaReal = address && typeof address === 'object' ? address.port : obterPortaServidor();
      return createWindow(portaReal);
    });
}

function abrirJanelaApp(url, tituloErro, mensagemErro, opcoes = {}) {
  criarMainWindow(opcoes);

  return carregarJanelaComRobustez(mainWindow, url)
    .then(() => {
      mainWindow.maximize();
      mainWindow.show();
    })
    .catch(async (error) => {
      if (opcoes.modoClienteRemoto) {
        const acao = await tratarFalhaConexaoRemota({
          error,
          configServidor: opcoes.modoClienteRemoto,
          remoteUrl: url
        });

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.destroy();
          mainWindow = null;
        }

        if (acao === 'retry') {
          return abrirJanelaApp(url, tituloErro, mensagemErro, opcoes);
        }

        if (acao === 'local') {
          try {
            await iniciarBackendLocal();
            return;
          } catch (localErr) {
            dialog.showErrorBox(
              'Erro ao iniciar servidor local',
              `${localErr.message}\n\nDB_DIR: ${process.env.DB_DIR}`
            );
          }
        }

        app.quit();
        return;
      }

      dialog.showErrorBox(
        tituloErro,
        mensagemErro(error)
      );
      app.quit();
    });
}

function createWindow(serverPort) {
  definirSessaoClienteRemoto(null);
  return abrirJanelaApp(
    `http://127.0.0.1:${serverPort}/login`,
    'Erro ao iniciar servidor',
    (error) => `O backend do sistema não respondeu.\n\n${error.message}\n\nDB_DIR: ${process.env.DB_DIR}`
  );
}

function createWindowRemote(remoteUrl, configServidor = {}) {
  definirSessaoClienteRemoto({
    ipServidor: configServidor.ipServidor,
    porta: configServidor.porta
  });

  return abrirJanelaApp(
    `${remoteUrl}/login`,
    'Erro ao carregar servidor remoto',
    (error) => `Não foi possível conectar ao servidor remoto.\n\n${error.message}`,
    {
      modoClienteRemoto: {
        ipServidor: configServidor.ipServidor,
        porta: configServidor.porta
      }
    }
  );
}


app.whenReady().then(() => {
  try {
    // Garante que os diretórios existam
    if (!fs.existsSync(process.env.DB_DIR)) {
      fs.mkdirSync(process.env.DB_DIR, { recursive: true });
    }
    
    const fiscalDir = path.join(process.env.DB_DIR, 'fiscal');
    if (!fs.existsSync(fiscalDir)) {
      fs.mkdirSync(fiscalDir, { recursive: true });
    }
    
    ['xml', 'danfe', 'debug', 'certificados'].forEach(sub => {
      const dir = path.join(fiscalDir, sub);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    
    process.env.FISCAL_DIR = fiscalDir;
    console.log('FISCAL_DIR definido para:', process.env.FISCAL_DIR);

    const configServidor = carregarConfiguracaoServidor();
    console.log('CONFIG SERVIDOR:', configServidor);

    if (configServidor.modo === 'cliente') {
      const urlRemota = `http://${configServidor.ipServidor}:${configServidor.porta}`;
      console.log(`Modo CLIENTE ativado. Conectando ao servidor remoto: ${urlRemota}`);
      createWindowRemote(urlRemota, configServidor);
      return;
    }

    const portaPreferida = obterPortaServidor();
    encontrarPortaDisponivel(portaPreferida)
      .then((portaLivre) => {
        process.env.PORT = String(portaLivre);
        console.log(`Porta escolhida para backend: ${portaLivre}`);
        console.log('Iniciando backend...');
        const server = require('./backend/server');
        console.log('Backend iniciado com sucesso.');
        return aguardarListening(server).then(() => server);
      })
      .then((server) => {
        const address = server.address();
        const portaReal = address && typeof address === 'object' ? address.port : obterPortaServidor();
        createWindow(portaReal);
      })
      .catch((error) => {
        console.error('Erro ao aguardar backend ficar pronto:', error);
        dialog.showErrorBox(
          'Erro ao iniciar servidor',
          `O backend do sistema não respondeu.\n\n${error.message}\n\nDB_DIR: ${process.env.DB_DIR}`
        );
        app.quit();
      });
  } catch (error) {
    console.error('Erro ao iniciar o backend:', error);
    dialog.showErrorBox(
      'Erro ao iniciar o sistema',
      error.stack || String(error)
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ipcMain.handle('imprimir-danfe-nfce', async (event, html) => {
//   return new Promise((resolve, reject) => {
//     const janelaImpressao = new BrowserWindow({
//       width: 420,
//       height: 700,
//       show: false,
//       webPreferences: {
//         nodeIntegration: false,
//         contextIsolation: true
//       }
//     });

//     janelaImpressao.loadURL(
//       'data:text/html;charset=utf-8,' + encodeURIComponent(html)
//     );

//     janelaImpressao.webContents.once('did-finish-load', () => {
//       setTimeout(() => {
//         janelaImpressao.webContents.print(
//           {
//             silent: true,
//             printBackground: true,
//             margins: {
//               marginType: 'none'
//             }
//           },
//           (success, errorType) => {
//             janelaImpressao.close();

//             if (!success) {
//               console.error('Erro ao imprimir DANFE:', errorType);
//               reject(errorType);
//               return;
//             }

//             resolve(true);
//           }
//         );
//       }, 500);
//     });
//   });
// });