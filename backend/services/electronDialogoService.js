function isElectronRuntime() {
  return Boolean(process.versions && process.versions.electron);
}

function obterJanelaAtiva(event) {
  if (!isElectronRuntime()) {
    return null;
  }

  const { BrowserWindow } = require('electron');

  if (event && event.sender) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      return win;
    }
  }

  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return focused;
  }

  const globalWin = global.mainWindow;
  if (globalWin && !globalWin.isDestroyed()) {
    return globalWin;
  }

  return BrowserWindow.getAllWindows().find((win) => win && !win.isDestroyed()) || null;
}

function selecionarPastaBackup(event) {
  if (!isElectronRuntime()) {
    return { sucesso: false, erro: 'NOT_ELECTRON' };
  }

  const { dialog, app } = require('electron');
  const win = obterJanelaAtiva(event);

  if (win) {
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
  }

  if (typeof app.focus === 'function') {
    app.focus({ steal: true });
  }

  const result = dialog.showOpenDialogSync(win || undefined, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Selecione a pasta de backup',
    buttonLabel: 'Selecionar pasta'
  });

  if (!result || result.canceled || !result.filePaths?.length) {
    return { sucesso: false, cancelado: true };
  }

  return { sucesso: true, caminho: result.filePaths[0] };
}

module.exports = {
  isElectronRuntime,
  selecionarPastaBackup
};
