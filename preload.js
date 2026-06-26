const { contextBridge, ipcRenderer } = require('electron');
const os = require('os');

function obterDestinoClienteRemoto() {
  const arg = process.argv.find((item) => item.startsWith('--cds-modo-cliente='));
  if (!arg) {
    return null;
  }
  return arg.replace('--cds-modo-cliente=', '');
}

const destinoClienteRemoto = obterDestinoClienteRemoto();

contextBridge.exposeInMainWorld('electronAPI', {
  app: 'cds-sistemas',

  getTerminalInfo: () => ({
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch()
  }),

  forcarReflow: () => ipcRenderer.send('forcar-reflow'),

  abrirComprovante: (html, options) =>
    ipcRenderer.send('abrir-comprovante', html, options || {}),

  selecionarPastaBackup: () =>
    ipcRenderer.invoke('selecionar-pasta-backup'),

  listarImpressoras: () =>
    ipcRenderer.invoke('listar-impressoras'),

  imprimirDANFESilencioso: (html, deviceName) =>
    ipcRenderer.invoke('imprimir-danfe-silencioso', html, deviceName),

  fecharJanela: () => window.close(),

  obterModoEstacao: () => ipcRenderer.invoke('rede-obter-modo-estacao'),
  voltarModoLocal: () => ipcRenderer.invoke('rede-voltar-modo-local'),
  salvarModoEstacao: (config) => ipcRenderer.invoke('rede-salvar-modo-estacao', config),
  obterHostnameEstacao: () => ipcRenderer.invoke('rede-obter-hostname'),
  estaEmModoClienteRemoto: () => ipcRenderer.invoke('rede-esta-em-modo-cliente'),
  obterServidorRemoto: () => destinoClienteRemoto
});
