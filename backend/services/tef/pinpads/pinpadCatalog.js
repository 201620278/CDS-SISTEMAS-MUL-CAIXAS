/**
 * Catálogo de modelos PinPad suportados pelo CDS.
 * Comunicação real via middleware (CliSiTef / PayGo).
 */

const MODELOS = {
  GERTEC_PPC930: {
    codigo: 'GERTEC_PPC930',
    nome: 'Gertec PPC930',
    nomeExibicao: 'Gertec PPC930 (Rede/Itaú)',
    fabricante: 'Gertec',
    modelo: 'PPC930',
    adquirenteSugerido: 'Rede',
    ativo: true,
    aliases: ['PPC930', 'GERTEC PPC930', 'Gertec PPC930', 'Gertec PPC930 (Rede/Itaú)']
  }
};

const ALIAS_MAP = {};

Object.values(MODELOS).forEach((item) => {
  ALIAS_MAP[item.codigo] = item;
  ALIAS_MAP[item.codigo.toLowerCase()] = item;
  ALIAS_MAP[item.modelo] = item;
  ALIAS_MAP[item.modelo.toLowerCase()] = item;
  ALIAS_MAP[item.nomeExibicao] = item;
  ALIAS_MAP[item.nomeExibicao.toLowerCase()] = item;
  (item.aliases || []).forEach((alias) => {
    ALIAS_MAP[alias] = item;
    ALIAS_MAP[String(alias).toLowerCase()] = item;
  });
});

function listarAtivos() {
  return Object.values(MODELOS).filter((m) => m.ativo !== false);
}

function resolverPorCodigo(codigo) {
  if (!codigo) return null;
  return ALIAS_MAP[codigo] || ALIAS_MAP[String(codigo).toLowerCase()] || null;
}

function resolver(config = {}) {
  const codigo = config.codigo || config.pinpadCodigo || config.pinpad_codigo;
  if (codigo) {
    const porCodigo = resolverPorCodigo(codigo);
    if (porCodigo) return porCodigo;
  }

  const modelo = String(config.modelo || config.pinpadModelo || '').trim();
  const fabricante = String(config.fabricante || '').trim();

  if (modelo) {
    const porModelo = ALIAS_MAP[modelo] || ALIAS_MAP[modelo.toLowerCase()];
    if (porModelo) return porModelo;
  }

  if (fabricante === 'Gertec' && /^ppc\s*930$/i.test(modelo)) {
    return MODELOS.GERTEC_PPC930;
  }

  return null;
}

function isGertecPPC930(config = {}) {
  const meta = resolver(config);
  return meta?.codigo === 'GERTEC_PPC930';
}

module.exports = {
  MODELOS,
  listarAtivos,
  resolverPorCodigo,
  resolver,
  isGertecPPC930
};
