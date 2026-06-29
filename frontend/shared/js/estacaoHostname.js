function capturarHostnameDaUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const hostname = params.get('estacao_hostname');
    if (hostname) {
      sessionStorage.setItem('cds_estacao_hostname', hostname);
      window.__CDS_ESTACAO_HOSTNAME__ = hostname;
      return hostname;
    }
  } catch (e) { /* ignore */ }
  return null;
}

function estaEmElectron() {
  return Boolean(window.electronAPI);
}

async function resolverHostnameEstacao() {
  if (typeof window.electronAPI !== 'undefined' && typeof window.electronAPI.getTerminalInfo === 'function') {
    try {
      const info = window.electronAPI.getTerminalInfo();
      if (info && info.hostname) {
        sessionStorage.setItem('cds_estacao_hostname', info.hostname);
        return info.hostname;
      }
    } catch (e) { /* ignore */ }
  }

  if (typeof window.electronAPI !== 'undefined' && typeof window.electronAPI.obterHostnameEstacao === 'function') {
    try {
      const hostname = await window.electronAPI.obterHostnameEstacao();
      if (hostname) {
        sessionStorage.setItem('cds_estacao_hostname', hostname);
        window.__CDS_ESTACAO_HOSTNAME__ = hostname;
        return hostname;
      }
    } catch (e) { /* ignore */ }
  }

  if (window.__CDS_ESTACAO_HOSTNAME__) {
    return window.__CDS_ESTACAO_HOSTNAME__;
  }

  try {
    const armazenado = sessionStorage.getItem('cds_estacao_hostname');
    if (armazenado) return armazenado;
  } catch (e) { /* ignore */ }

  const daUrl = capturarHostnameDaUrl();
  if (daUrl) return daUrl;

  if (!estaEmElectron()) {
    try {
      const key = 'cds_pdv_hostname_fallback';
      let fallback = localStorage.getItem(key);
      if (!fallback) {
        fallback = `pdv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem(key, fallback);
      }
      sessionStorage.setItem('cds_estacao_hostname', fallback);
      return fallback;
    } catch (e) { /* ignore */ }
  }

  return null;
}

capturarHostnameDaUrl();

window.capturarHostnameDaUrl = capturarHostnameDaUrl;
window.estaEmElectron = estaEmElectron;
window.resolverHostnameEstacao = resolverHostnameEstacao;
