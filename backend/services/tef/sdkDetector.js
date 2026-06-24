const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SITEF_DLL_NAMES = [
  'Clisitef64I.dll',
  'Clisitef32I.dll',
  'clisitef.dll',
  'libclisitef.so'
];

const PAYGO_DLL_NAMES = [
  'PayGo.dll',
  'paygo.dll',
  'libpaygo.so'
];

const SITEF_SEARCH_ROOTS = [
  'C:/CliSiTef',
  'C:/Program Files/CliSiTef',
  'C:/Program Files (x86)/CliSiTef',
  'C:/SiTef',
  'C:/TEF'
];

const PAYGO_SEARCH_ROOTS = [
  'C:/PayGo',
  'C:/Program Files/PayGo',
  'C:/Program Files (x86)/PayGo'
];

const SITEF_INI_NAMES = ['clisitef.ini', 'CliSiTef.ini'];
const PAYGO_INI_NAMES = ['paygo.ini', 'PayGo.ini'];

const GERTEC_DRIVER_PATHS = [
  'C:/Program Files/Gertec',
  'C:/Program Files (x86)/Gertec',
  'C:/Gertec',
  'C:/Program Files/Gertec/GerPCD',
  'C:/Program Files (x86)/Gertec/GerPCD'
];

const GERTEC_DRIVER_FILES = [
  'GerPCD.dll',
  'gertec.dll',
  'PPC930.dll'
];

const SITEF_SERVICO_NOMES = ['CliSiTef', 'SiTef', 'TEF'];
const PAYGO_SERVICO_NOMES = ['PayGo', 'PayGoTEF'];

class SDKDetector {
  localizarSDKs() {
    const encontrados = [];
    const vistos = new Set();

    for (const root of SITEF_SEARCH_ROOTS) {
      for (const dll of SITEF_DLL_NAMES) {
        this._adicionarSeExistir(path.join(root, dll), 'sitef', encontrados, vistos);
      }
    }

    for (const root of PAYGO_SEARCH_ROOTS) {
      for (const dll of PAYGO_DLL_NAMES) {
        this._adicionarSeExistir(path.join(root, dll), 'paygo', encontrados, vistos);
      }
    }

    return encontrados;
  }

  _adicionarSeExistir(caminho, tipo, lista, vistos) {
    const key = caminho.toLowerCase();
    if (vistos.has(key)) return;
    if (!fs.existsSync(caminho)) return;
    vistos.add(key);
    lista.push({
      tipo,
      caminho,
      encontrado: true,
      pasta: path.dirname(caminho),
      nome: path.basename(caminho)
    });
  }

  _buscarIni(pasta, nomes) {
    for (const nome of nomes) {
      const caminho = path.join(pasta, nome);
      if (fs.existsSync(caminho)) {
        return { encontrado: true, caminho, conteudo: fs.readFileSync(caminho, 'utf8') };
      }
    }
    return { encontrado: false, caminho: null, conteudo: null };
  }

  _validarIniBasico(conteudo) {
    if (!conteudo || !String(conteudo).trim()) return false;
    const texto = String(conteudo);
    return texto.includes('=') && (texto.includes('[') || texto.includes('Terminal') || texto.includes('IP'));
  }

  _detectarServicosWindows(nomes) {
    if (process.platform !== 'win32') {
      return { verificado: false, servicos: [] };
    }

    const encontrados = [];
    for (const nome of nomes) {
      try {
        const saida = execSync(`sc query "${nome}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        if (/STATE\s+:\s+\d+\s+RUNNING/i.test(saida)) {
          encontrados.push({ nome, status: 'RUNNING' });
        } else if (/STATE/i.test(saida)) {
          encontrados.push({ nome, status: 'INSTALADO' });
        }
      } catch {
        // serviço não existe
      }
    }

    return { verificado: true, servicos: encontrados };
  }

  detectarSitef() {
    const sdks = this.localizarSDKs().filter((s) => s.tipo === 'sitef');
    const dll = sdks[0] || null;
    const pasta = dll?.pasta || SITEF_SEARCH_ROOTS[0];
    const ini = dll ? this._buscarIni(dll.pasta, SITEF_INI_NAMES) : this._buscarIni(pasta, SITEF_INI_NAMES);
    const servicos = this._detectarServicosWindows(SITEF_SERVICO_NOMES);

    return {
      sitefInstalado: Boolean(dll),
      dllEncontrada: Boolean(dll),
      caminho: dll?.caminho || null,
      pasta: dll?.pasta || null,
      ini,
      configuracaoValida: ini.encontrado && this._validarIniBasico(ini.conteudo),
      servicosWindows: servicos,
      sdks: sdks
    };
  }

  detectarPaygo() {
    const sdks = this.localizarSDKs().filter((s) => s.tipo === 'paygo');
    const dll = sdks[0] || null;
    const pasta = dll?.pasta || PAYGO_SEARCH_ROOTS[0];
    const ini = dll ? this._buscarIni(dll.pasta, PAYGO_INI_NAMES) : this._buscarIni(pasta, PAYGO_INI_NAMES);
    const servicos = this._detectarServicosWindows(PAYGO_SERVICO_NOMES);

    return {
      paygoInstalado: Boolean(dll),
      dllEncontrada: Boolean(dll),
      caminho: dll?.caminho || null,
      pasta: dll?.pasta || null,
      ini,
      configuracaoValida: ini.encontrado && this._validarIniBasico(ini.conteudo),
      servicosWindows: servicos,
      sdks: sdks
    };
  }

  diagnosticarCompleto() {
    const sitef = this.detectarSitef();
    const paygo = this.detectarPaygo();
    const gertecPPC930 = this.detectarGertecPPC930();

    return {
      sitefInstalado: sitef.sitefInstalado,
      paygoInstalado: paygo.paygoInstalado,
      dllEncontrada: sitef.dllEncontrada || paygo.dllEncontrada,
      caminho: sitef.caminho || paygo.caminho || null,
      configuracaoValida: sitef.configuracaoValida || paygo.configuracaoValida,
      sitef,
      paygo,
      gertecPPC930,
      plataforma: process.platform,
      timestamp: new Date().toISOString()
    };
  }

  _listarPortasCOM() {
    if (process.platform !== 'win32') {
      return [];
    }

    try {
      const saida = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_SerialPort | Select-Object DeviceID,Name,Description | ConvertTo-Json -Compress"',
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const parsed = JSON.parse(saida || '[]');
      const lista = Array.isArray(parsed) ? parsed : [parsed];
      return lista
        .filter(Boolean)
        .map((item) => ({
          porta: item.DeviceID || null,
          nome: item.Name || '',
          descricao: item.Description || ''
        }));
    } catch {
      return [];
    }
  }

  _verificarDriversGertec() {
    const encontrados = [];
    let usbDetectado = false;

    for (const root of GERTEC_DRIVER_PATHS) {
      if (!fs.existsSync(root)) continue;
      encontrados.push({ tipo: 'pasta', caminho: root });
      for (const arquivo of GERTEC_DRIVER_FILES) {
        const caminho = path.join(root, arquivo);
        if (fs.existsSync(caminho)) {
          encontrados.push({ tipo: 'dll', caminho });
        }
      }
    }

    if (process.platform === 'win32') {
      try {
        const pnp = execSync(
          'powershell -NoProfile -Command "Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match \'Gertec|PPC930\' } | Select-Object FriendlyName,Status | ConvertTo-Json -Compress"',
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        const dispositivos = JSON.parse(pnp || '[]');
        const lista = Array.isArray(dispositivos) ? dispositivos : (dispositivos ? [dispositivos] : []);
        usbDetectado = lista.some((d) => /gertec|ppc930/i.test(d.FriendlyName || ''));
        lista.forEach((d) => {
          if (d?.FriendlyName) {
            encontrados.push({ tipo: 'usb', nome: d.FriendlyName, status: d.Status });
          }
        });
      } catch {
        // sem permissão ou cmdlet indisponível
      }
    }

    return {
      instalado: encontrados.length > 0,
      usbDetectado,
      itens: encontrados
    };
  }

  detectarGertecPPC930() {
    const drivers = this._verificarDriversGertec();
    const portas = this._listarPortasCOM();
    const portasGertec = portas.filter((p) => /gertec|ppc\s*930|ppc930/i.test(`${p.nome} ${p.descricao}`));
    const porta = portasGertec[0]?.porta || portas[0]?.porta || null;

    return {
      codigo: 'GERTEC_PPC930',
      modelo: 'Gertec PPC930',
      detectado: drivers.instalado || drivers.usbDetectado || portasGertec.length > 0,
      porta,
      driver: drivers.instalado,
      usb: drivers.usbDetectado,
      portasCOM: portas,
      portasProvaveis: portasGertec,
      drivers: drivers.itens,
      observacao: 'Detecção indicativa — operação via CliSiTef ou PayGo'
    };
  }
}

module.exports = new SDKDetector();
