/**
 * Migração legado: vendido_por_peso → produto_fracionado (Motor de Conversão de Unidades).
 * Preserva todos os dados históricos (peso_total_compra, custo_por_kg, etc.).
 */

function runUpdate(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, function onRun(err) {
      if (err) return reject(err);
      resolve(this.changes || 0);
    });
  });
}

async function executarMigracaoConversaoUnidades(db) {
  const migradosParaFracionado = await runUpdate(db, `
    UPDATE produtos
    SET produto_fracionado = 1
    WHERE COALESCE(vendido_por_peso, 0) = 1
      AND COALESCE(produto_fracionado, 0) = 0
  `);

  const sincronizadosLegado = await runUpdate(db, `
    UPDATE produtos
    SET vendido_por_peso = 1
    WHERE COALESCE(produto_fracionado, 0) = 1
      AND COALESCE(vendido_por_peso, 0) = 0
  `);

  let comprasItensSincronizados = 0;
  try {
    comprasItensSincronizados = await runUpdate(db, `
      UPDATE compras_itens
      SET vendido_por_peso = 1
      WHERE COALESCE(vendido_por_peso, 0) = 0
        AND produto_id IN (
          SELECT id FROM produtos WHERE COALESCE(produto_fracionado, 0) = 1
        )
    `);
  } catch (err) {
    if (!String(err.message || '').includes('no such column')) {
      throw err;
    }
  }

  return {
    migradosParaFracionado,
    sincronizadosLegado,
    comprasItensSincronizados
  };
}

function executarMigracaoConversaoUnidadesCallback(db, callback) {
  executarMigracaoConversaoUnidades(db)
    .then((stats) => callback(null, stats))
    .catch((err) => callback(err));
}

const executarMigracaoProdutosFracionados = executarMigracaoConversaoUnidades;
const executarMigracaoProdutosFracionadosCallback = executarMigracaoConversaoUnidadesCallback;

module.exports = {
  executarMigracaoConversaoUnidades,
  executarMigracaoConversaoUnidadesCallback,
  executarMigracaoProdutosFracionados,
  executarMigracaoProdutosFracionadosCallback
};
