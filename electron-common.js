const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');

process.env.DB_DIR = process.env.DB_DIR || path.join(
  process.env.PROGRAMDATA || 'C:\\ProgramData',
  'MercantilFiscal',
  'dados'
);

let mainWindow;
let appModuloAtual = 'erp';

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

  return result.canceled ? null : result.filePaths[0];
});

ipcMain.removeHandler('rede-obter-modo-estacao');
ipcMain.handle('rede-obter-modo-estacao', async () => {
  const configService = require('./backend/services/configuracaoService');
  return configService.obterModoEstacaoLocal();
});

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

function obterPortaServidor() {
  const porta = Number.parseInt(process.env.PORT, 10);
  return Number.isFinite(porta) && porta > 0 ? porta : 3001;
}

function checarPortaLivre(porta) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => tester.close(() => resolve(true)));
    tester.listen(porta);
  });
}

async function encontrarPortaDisponivel(portaInicial, tentativas = 20) {
  let portaAtual = portaInicial;
  for (let i = 0; i < tentativas; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const livre = await checarPortaLivre(portaAtual);
    if (livre) return portaAtual;
    portaAtual += 1;
  }
  throw new Error(`Nenhuma porta disponível encontrada a partir de ${portaInicial}.`);
}

function carregarJanelaComRobustez(window, url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    let finalizado = false;
    const timer = setTimeout(() => finalizarComErro(new Error(`Timeout ao carregar ${url}`)), timeout);

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

    function onFinish() { finalizarComSucesso(); }

    function onFail(event, errorCode, errorDescription, validatedURL, isMainFrame) {
      if (!isMainFrame || errorCode === -3) return;
      finalizarComErro(new Error(`${errorDescription || 'Falha ao carregar página'} (${errorCode}) em ${validatedURL || url}`));
    }

    window.webContents.on('did-finish-load', onFinish);
    window.webContents.on('did-fail-load', onFail);
    window.loadURL(url).catch((error) => {
      const mensagem = String(error && error.message ? error.message : error);
      if (!mensagem.includes('ERR_ABORTED')) finalizarComErro(error);
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

    function onListening() { cleanup(); resolve(); }
    function onError(error) { cleanup(); reject(error); }

    server.once('listening', onListening);
    server.once('error', onError);
  });
}

function carregarConfiguracaoServidor() {
  try {
    const configService = require('./backend/services/configuracaoService');
    configService.ensureConfigFile();
    return configService.getModoRedeElectron();
  } catch (err) {
    console.warn('Não foi possível ler configuracoes.json, usando configuração padrão.', err.message);
    return { modo: 'local', ipServidor: '127.0.0.1', porta: 3001 };
  }
}

function registrarHandlersIpc() {
  ipcMain.removeAllListeners('forcar-reflow');
  ipcMain.on('forcar-reflow', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        document.body.style.display = 'none';
        document.body.offsetHeight;
        document.body.style.display = '';
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
      @page { size: 80mm auto; margin: 0; }
      html, body {
        width: 76mm !important; max-width: 76mm !important;
        margin: 0 auto !important; padding: 2mm !important;
        background: #fff !important; color: #000 !important;
        font-family: "Courier New", monospace !important;
        font-size: 11px !important; line-height: 1.18 !important;
      }
      img { display: block !important; margin: 8px auto !important; width: 180px !important; height: 180px !important; }
      table { width: 100% !important; border-collapse: collapse !important; }
    </style>
  </head>`);

    cupomWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlFinal)}`);
    cupomWindow.webContents.once('did-finish-load', async () => {
      await cupomWindow.webContents.executeJavaScript(`new Promise(r => setTimeout(r, 800));`);
      const printOptions = { silent: true, printBackground: true, margins: { marginType: 'none' } };
      if (deviceName) printOptions.deviceName = deviceName;
      cupomWindow.webContents.print(printOptions, () => {
        if (!cupomWindow.isDestroyed()) cupomWindow.close();
      });
    });
  });

  ipcMain.removeHandler('imprimir-danfe-silencioso');
  ipcMain.handle('imprimir-danfe-silencioso', async (event, html, deviceName) => {
    const printWindow = new BrowserWindow({
      width: 420,
      height: 720,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise(resolve => setTimeout(resolve, 500));
    const printOptions = { silent: true, printBackground: true };
    if (deviceName) printOptions.deviceName = deviceName;
    return new Promise((resolve, reject) => {
      printWindow.webContents.print(printOptions, (success, errorType) => {
        if (!printWindow.isDestroyed()) printWindow.close();
        if (success) resolve({ sucesso: true });
        else reject(new Error(`Falha na impressão: ${errorType}`));
      });
    });
  });

  ipcMain.removeHandler('selecionar-pasta-backup');
  ipcMain.handle('selecionar-pasta-backup', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Selecione a pasta de backup'
    });
    return result.canceled ? null : result.filePaths[0];
  });
}

function criarMainWindow(tituloJanela, opcoes = {}) {
  const argumentosExtras = [];
  if (opcoes.modoClienteRemoto) {
    const { ipServidor, porta } = opcoes.modoClienteRemoto;
    argumentosExtras.push(`--cds-modo-cliente=${ipServidor}:${porta}`);
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: tituloJanela || 'CDS Sistemas',
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
  registrarHandlersIpc();

  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 420,
      height: 720,
      title: 'Comprovante',
      alwaysOnTop: true,
      autoHideMenuBar: true,
      parent: mainWindow,
      modal: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    }
  }));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  return mainWindow;
}

function montarUrlLogin(baseUrl) {
  const modulo = appModuloAtual === 'pdv' ? 'pdv' : 'erp';
  return `${baseUrl}/login?modulo=${modulo}`;
}

function abrirJanelaApp(url, tituloErro, mensagemErro, tituloJanela, opcoes = {}) {
  criarMainWindow(tituloJanela, opcoes);
  return carregarJanelaComRobustez(mainWindow, url)
    .then(() => {
      mainWindow.maximize();
      mainWindow.show();
    })
    .catch((error) => {
      dialog.showErrorBox(tituloErro, mensagemErro(error));
      app.quit();
    });
}

function createWindow(serverPort, tituloJanela) {
  return abrirJanelaApp(
    montarUrlLogin(`http://127.0.0.1:${serverPort}`),
    'Erro ao iniciar servidor',
    (error) => `O backend do sistema não respondeu.\n\n${error.message}\n\nDB_DIR: ${process.env.DB_DIR}`,
    tituloJanela
  );
}

function createWindowRemote(remoteUrl, tituloJanela, configServidor = {}) {
  return abrirJanelaApp(
    montarUrlLogin(remoteUrl),
    'Erro ao carregar servidor remoto',
    (error) => `Não foi possível conectar ao servidor remoto.\n\n${error.message}`,
    tituloJanela,
    {
      modoClienteRemoto: {
        ipServidor: configServidor.ipServidor,
        porta: configServidor.porta
      }
    }
  );
}

function iniciarAplicacaoElectron(options = {}) {
  const { modulo = 'erp', tituloJanela = 'CDS Sistemas' } = options;
  appModuloAtual = modulo;
  process.env.CDS_APP_MODULO = modulo;

  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-features', 'UseSkiaRenderer');

  app.whenReady().then(() => {
    try {
      if (!fs.existsSync(process.env.DB_DIR)) {
        fs.mkdirSync(process.env.DB_DIR, { recursive: true });
      }

      const fiscalDir = path.join(process.env.DB_DIR, 'fiscal');
      if (!fs.existsSync(fiscalDir)) fs.mkdirSync(fiscalDir, { recursive: true });
      ['xml', 'danfe', 'debug', 'certificados'].forEach(sub => {
        const dir = path.join(fiscalDir, sub);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      });

      process.env.FISCAL_DIR = fiscalDir;
      const configServidor = carregarConfiguracaoServidor();

      if (configServidor.modo === 'cliente') {
        const urlRemota = `http://${configServidor.ipServidor}:${configServidor.porta}`;
        createWindowRemote(urlRemota, tituloJanela, configServidor);
        return;
      }

      if (modulo === 'pdv') {
        console.log('PDV local: iniciando backend compartilhado...');
      }

      const portaPreferida = obterPortaServidor();
      encontrarPortaDisponivel(portaPreferida)
        .then((portaLivre) => {
          process.env.PORT = String(portaLivre);
          const server = require('./backend/server');
          return aguardarListening(server).then(() => server);
        })
        .then((server) => {
          const address = server.address();
          const portaReal = address && typeof address === 'object' ? address.port : obterPortaServidor();
          createWindow(portaReal, tituloJanela);
        })
        .catch((error) => {
          dialog.showErrorBox('Erro ao iniciar servidor', `${error.message}\n\nDB_DIR: ${process.env.DB_DIR}`);
          app.quit();
        });
    } catch (error) {
      dialog.showErrorBox('Erro ao iniciar o sistema', error.stack || String(error));
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

module.exports = { iniciarAplicacaoElectron };
