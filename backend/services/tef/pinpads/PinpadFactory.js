const GertecPinpad = require('./GertecPinpad');
const GertecPPC930 = require('./GertecPPC930');
const IngenicoPinpad = require('./IngenicoPinpad');
const VerifonePinpad = require('./VerifonePinpad');
const PaxPinpad = require('./PaxPinpad');
const pinpadCatalog = require('./pinpadCatalog');

function normalizarConfig(config = {}) {
  const meta = pinpadCatalog.resolver(config);
  if (!meta) {
    return config;
  }

  return {
    ...config,
    codigo: meta.codigo,
    pinpadCodigo: meta.codigo,
    fabricante: meta.fabricante,
    modelo: meta.modelo,
    pinpadNome: meta.nome,
    pinpadNomeExibicao: meta.nomeExibicao
  };
}

function resolverClassePinpad(config = {}) {
  const meta = pinpadCatalog.resolver(config);

  if (meta?.codigo === 'GERTEC_PPC930') {
    return GertecPPC930;
  }

  const fabricante = String(config.fabricante || meta?.fabricante || '').trim();

  switch (fabricante) {
    case 'Gertec':
      return GertecPinpad;
    case 'Ingenico':
      return IngenicoPinpad;
    case 'Verifone':
      return VerifonePinpad;
    case 'PAX':
      return PaxPinpad;
    default:
      return null;
  }
}

async function obterPinpad(config = {}) {
  const configNorm = normalizarConfig(config);
  const Classe = resolverClassePinpad(configNorm);

  if (!Classe) {
    const chave = configNorm.codigo || configNorm.fabricante || 'desconhecido';
    throw new Error(`PinPad não suportado: ${chave}`);
  }

  return new Classe(configNorm);
}

function reconhecerAutomaticamente(config = {}) {
  const meta = pinpadCatalog.resolver(config);
  return {
    reconhecido: Boolean(meta),
    codigo: meta?.codigo || null,
    nomeExibicao: meta?.nomeExibicao || null,
    fabricante: meta?.fabricante || config.fabricante || null,
    modelo: meta?.modelo || config.modelo || null
  };
}

module.exports = {
  obterPinpad,
  normalizarConfig,
  reconhecerAutomaticamente,
  resolverClassePinpad
};
