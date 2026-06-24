function resolverQuantidadesCompraItemPersistido(item = {}) {
  const quantidade = Number(item.quantidade || 0);
  let quantidade_fiscal = item.quantidade_fiscal !== undefined && item.quantidade_fiscal !== null
    ? Number(item.quantidade_fiscal || 0)
    : null;
  let quantidade_nao_fiscal = item.quantidade_nao_fiscal !== undefined && item.quantidade_nao_fiscal !== null
    ? Number(item.quantidade_nao_fiscal || 0)
    : null;

  // Registros antigos: colunas criadas com DEFAULT 0 ficaram 0 em vez de NULL
  if (
    quantidade > 0
    && quantidade_fiscal === 0
    && quantidade_nao_fiscal === 0
    && (item.quantidade_fiscal !== undefined || item.quantidade_nao_fiscal !== undefined)
  ) {
    if (Number(item.item_fiscal) === 0) {
      quantidade_nao_fiscal = quantidade;
      quantidade_fiscal = 0;
    } else {
      quantidade_fiscal = quantidade;
      quantidade_nao_fiscal = 0;
    }
  }

  if (quantidade_fiscal === null) {
    quantidade_fiscal = Number(item.item_fiscal) === 0 ? 0 : quantidade;
  }
  if (quantidade_nao_fiscal === null) {
    quantidade_nao_fiscal = Number(item.item_fiscal) === 0 ? quantidade : 0;
  }

  const quantidadeResolvida = quantidade > 0 ? quantidade : (quantidade_fiscal + quantidade_nao_fiscal);

  return {
    quantidade_fiscal,
    quantidade_nao_fiscal,
    quantidade: quantidadeResolvida
  };
}

function resolverQuantidadesVendaItem(item = {}) {
  const quantidade = Number(item.quantidade || 0);
  let quantidade_fiscal = item.quantidade_fiscal !== undefined && item.quantidade_fiscal !== null
    ? Number(item.quantidade_fiscal || 0)
    : null;
  let quantidade_nao_fiscal = item.quantidade_nao_fiscal !== undefined && item.quantidade_nao_fiscal !== null
    ? Number(item.quantidade_nao_fiscal || 0)
    : null;

  if (
    quantidade > 0
    && quantidade_fiscal === 0
    && quantidade_nao_fiscal === 0
    && (item.quantidade_fiscal !== undefined || item.quantidade_nao_fiscal !== undefined)
  ) {
    if (Number(item.item_fiscal) === 0) {
      quantidade_nao_fiscal = quantidade;
      quantidade_fiscal = 0;
    } else {
      quantidade_fiscal = quantidade;
      quantidade_nao_fiscal = 0;
    }
  }

  if (quantidade_fiscal === null) {
    quantidade_fiscal = Number(item.item_fiscal) === 0 ? 0 : quantidade;
  }
  if (quantidade_nao_fiscal === null) {
    quantidade_nao_fiscal = Number(item.item_fiscal) === 0 ? quantidade : 0;
  }

  const quantidadeResolvida = quantidade > 0 ? quantidade : (quantidade_fiscal + quantidade_nao_fiscal);

  return {
    quantidade_fiscal,
    quantidade_nao_fiscal,
    quantidade: quantidadeResolvida
  };
}

function calcularDevolucaoFiscalPrimeiro(qtds, qtdDevolver, jaDevolvido = {}) {
  const fiscalRestante = Math.max(
    0,
    Number(qtds.quantidade_fiscal || 0) - Number(jaDevolvido.fiscal || 0)
  );
  const naoFiscalRestante = Math.max(
    0,
    Number(qtds.quantidade_nao_fiscal || 0) - Number(jaDevolvido.nao_fiscal || 0)
  );
  const qtd = Number(qtdDevolver || 0);

  if (qtd <= 0) {
    return { qtdFiscal: 0, qtdNaoFiscal: 0, qtdTotal: 0 };
  }

  const maxDevolver = fiscalRestante + naoFiscalRestante;
  const qtdEfetiva = Math.min(qtd, maxDevolver);
  const qtdFiscal = Math.min(qtdEfetiva, fiscalRestante);
  const qtdNaoFiscal = Math.min(qtdEfetiva - qtdFiscal, naoFiscalRestante);

  return {
    qtdFiscal: Number(qtdFiscal.toFixed(3)),
    qtdNaoFiscal: Number(qtdNaoFiscal.toFixed(3)),
    qtdTotal: Number(qtdEfetiva.toFixed(3))
  };
}

function calcularDevolucaoVendaFiscalPrimeiro(itemVenda, qtdDevolver, jaDevolvido = {}) {
  return calcularDevolucaoFiscalPrimeiro(
    resolverQuantidadesVendaItem(itemVenda),
    qtdDevolver,
    jaDevolvido
  );
}

function calcularDevolucaoCompraFiscalPrimeiro(itemCompra, qtdDevolver, jaDevolvido = {}) {
  return calcularDevolucaoFiscalPrimeiro(
    resolverQuantidadesCompraItemPersistido(itemCompra),
    qtdDevolver,
    jaDevolvido
  );
}

function resolverJaDevolvidoCompraFiscalPrimeiro(itemCompra, qtdJaDevolvida) {
  const qtd = Number(qtdJaDevolvida || 0);
  if (qtd <= 0) {
    return { fiscal: 0, nao_fiscal: 0 };
  }
  const split = calcularDevolucaoCompraFiscalPrimeiro(itemCompra, qtd, { fiscal: 0, nao_fiscal: 0 });
  return { fiscal: split.qtdFiscal, nao_fiscal: split.qtdNaoFiscal };
}

function recalcularEstoqueConsolidado(produto) {
  return (
    Number(produto.saldo_fiscal || 0) +
    Number(produto.saldo_nao_fiscal || 0)
  );
}

function recalcularSaldosProduto(db, produtoId, callback) {
  db.get('SELECT id FROM produtos WHERE id = ?', [produtoId], (errProduto, produto) => {
    if (errProduto) return callback(errProduto);
    if (!produto) return callback(new Error('Produto não encontrado'));

    db.all(`
      SELECT
        ci.quantidade,
        ci.quantidade_fiscal,
        ci.quantidade_nao_fiscal,
        ci.item_fiscal
      FROM compras_itens ci
      INNER JOIN compras c ON c.id = ci.compra_id
      WHERE ci.produto_id = ?
        AND COALESCE(c.status, 'concluida') = 'concluida'
    `, [produtoId], (errCompras, comprasItens) => {
      if (errCompras) return callback(errCompras);

      db.all(`
        SELECT
          vi.quantidade,
          vi.quantidade_fiscal,
          vi.quantidade_nao_fiscal,
          vi.item_fiscal
        FROM vendas_itens vi
        INNER JOIN vendas v ON v.id = vi.venda_id
        WHERE vi.produto_id = ?
          AND COALESCE(v.status, '') != 'cancelada'
      `, [produtoId], (errVendas, vendasItens) => {
        if (errVendas) return callback(errVendas);

        db.all(`
          SELECT
            cd.quantidade,
            ci.quantidade AS qtd_comprada,
            ci.quantidade_fiscal,
            ci.quantidade_nao_fiscal,
            ci.item_fiscal
          FROM compras_devolucoes cd
          INNER JOIN compras_itens ci ON ci.id = cd.compra_item_id
          WHERE cd.produto_id = ?
        `, [produtoId], (errDev, devolucoes) => {
          if (errDev) return callback(errDev);

          let saldoFiscal = 0;
          let saldoNaoFiscal = 0;

          (comprasItens || []).forEach((item) => {
            const qtds = resolverQuantidadesCompraItemPersistido(item);
            saldoFiscal += qtds.quantidade_fiscal;
            saldoNaoFiscal += qtds.quantidade_nao_fiscal;
          });

          (vendasItens || []).forEach((item) => {
            const qtds = resolverQuantidadesVendaItem(item);
            saldoFiscal -= qtds.quantidade_fiscal;
            saldoNaoFiscal -= qtds.quantidade_nao_fiscal;
          });

          (devolucoes || []).forEach((dev) => {
            const qtds = resolverQuantidadesCompraItemPersistido(dev);
            const totalComprado = qtds.quantidade;
            const qtdDevolver = Number(dev.quantidade || 0);
            if (totalComprado <= 0 || qtdDevolver <= 0) return;

            const proporcaoFiscal = qtds.quantidade_fiscal / totalComprado;
            const qtdFiscal = Number((proporcaoFiscal * qtdDevolver).toFixed(3));
            const qtdNaoFiscal = Number((qtdDevolver - qtdFiscal).toFixed(3));
            saldoFiscal -= qtdFiscal;
            saldoNaoFiscal -= qtdNaoFiscal;
          });

          saldoFiscal = Number(Math.max(0, saldoFiscal).toFixed(3));
          saldoNaoFiscal = Number(Math.max(0, saldoNaoFiscal).toFixed(3));
          const estoqueAtual = Number((saldoFiscal + saldoNaoFiscal).toFixed(3));

          db.run(`
            UPDATE produtos
            SET saldo_fiscal = ?,
                saldo_nao_fiscal = ?,
                estoque_atual = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [saldoFiscal, saldoNaoFiscal, estoqueAtual, produtoId], (upErr) => {
            if (upErr) return callback(upErr);
            callback(null, {
              produto_id: produtoId,
              saldo_fiscal: saldoFiscal,
              saldo_nao_fiscal: saldoNaoFiscal,
              estoque_atual: estoqueAtual
            });
          });
        });
      });
    });
  });
}

function recalcularSaldosTodosProdutos(db, callback) {
  db.all('SELECT id FROM produtos', [], (err, produtos) => {
    if (err) return callback(err);

    let index = 0;
    let atualizados = 0;
    const erros = [];

    function proximo() {
      if (index >= (produtos || []).length) {
        return callback(null, { atualizados, erros });
      }

      const produtoId = produtos[index].id;
      index += 1;

      recalcularSaldosProduto(db, produtoId, (recErr) => {
        if (recErr) {
          erros.push({ produto_id: produtoId, erro: recErr.message });
        } else {
          atualizados += 1;
        }
        proximo();
      });
    }

    proximo();
  });
}

module.exports = {
  resolverQuantidadesCompraItemPersistido,
  resolverQuantidadesVendaItem,
  calcularDevolucaoFiscalPrimeiro,
  calcularDevolucaoVendaFiscalPrimeiro,
  calcularDevolucaoCompraFiscalPrimeiro,
  resolverJaDevolvidoCompraFiscalPrimeiro,
  recalcularEstoqueConsolidado,
  recalcularSaldosProduto,
  recalcularSaldosTodosProdutos
};
