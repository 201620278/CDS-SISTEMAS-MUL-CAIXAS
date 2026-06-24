const db = require('../../database');
const pinpadCatalog = require('./pinpads/pinpadCatalog');

function promisifyAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function listarCatalogoAtivo() {
  try {
    const rows = await promisifyAll(`
      SELECT codigo, nome, fabricante, modelo, adquirente_sugerido AS adquirenteSugerido, ativo
      FROM tef_pinpad_catalogo
      WHERE ativo = 1
      ORDER BY nome ASC
    `);

    if (rows.length > 0) {
      return rows.map((row) => ({
        ...row,
        nomeExibicao: pinpadCatalog.resolverPorCodigo(row.codigo)?.nomeExibicao || row.nome
      }));
    }
  } catch {
    // tabela pode não existir em bases antigas até migração
  }

  return pinpadCatalog.listarAtivos();
}

module.exports = {
  listarCatalogoAtivo
};
