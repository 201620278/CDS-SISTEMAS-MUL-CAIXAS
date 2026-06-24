const { recalcularEstoqueConsolidado } = require('./estoqueFiscalService');

function produtoTemMovimentacoes(db, produtoId, callback) {
  db.get(`
    SELECT
      (SELECT COUNT(*) FROM compras_itens WHERE produto_id = ?) AS compras,
      (SELECT COUNT(*) FROM vendas_itens WHERE produto_id = ?) AS vendas,
      (SELECT COUNT(*) FROM compras_devolucoes WHERE produto_id = ?) AS devolucoes,
      (SELECT COUNT(*) FROM produtos_ajustes_estoque WHERE produto_id = ?) AS ajustes,
      (SELECT COUNT(*) FROM produtos_lotes
        WHERE produto_id = ? AND COALESCE(origem, '') != 'ESTOQUE_INICIAL') AS lotes_mov
  `, [produtoId, produtoId, produtoId, produtoId, produtoId], (err, row) => {
    if (err) return callback(err);

    const tem = (
      Number(row?.compras || 0) > 0
      || Number(row?.vendas || 0) > 0
      || Number(row?.devolucoes || 0) > 0
      || Number(row?.ajustes || 0) > 0
      || Number(row?.lotes_mov || 0) > 0
    );

    callback(null, tem);
  });
}

function registrarAjusteEstoque(db, dados, callback) {
  db.run(`
    INSERT INTO produtos_ajustes_estoque (
      produto_id, usuario_id, usuario_nome, motivo,
      ajuste_fiscal, ajuste_nao_fiscal,
      saldo_fiscal_antes, saldo_fiscal_depois,
      saldo_nao_fiscal_antes, saldo_nao_fiscal_depois,
      estoque_total_antes, estoque_total_depois
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    dados.produto_id,
    dados.usuario_id || null,
    dados.usuario_nome || null,
    dados.motivo,
    dados.ajuste_fiscal,
    dados.ajuste_nao_fiscal,
    dados.saldo_fiscal_antes,
    dados.saldo_fiscal_depois,
    dados.saldo_nao_fiscal_antes,
    dados.saldo_nao_fiscal_depois,
    dados.estoque_total_antes,
    dados.estoque_total_depois
  ], callback);
}

function aplicarAjusteEstoqueProduto(db, opcoes, callback) {
  const {
    produtoId,
    ajusteFiscal,
    ajusteNaoFiscal,
    motivo,
    usuarioId,
    usuarioNome,
    lote,
    dataFabricacao,
    dataValidade,
    lotesService
  } = opcoes;

  const ajusteF = Number(ajusteFiscal || 0);
  const ajusteNF = Number(ajusteNaoFiscal || 0);

  if (ajusteF === 0 && ajusteNF === 0) {
    return callback(new Error('Informe ao menos um ajuste fiscal ou não fiscal diferente de zero.'));
  }

  if (!motivo || !String(motivo).trim()) {
    return callback(new Error('Motivo do ajuste é obrigatório.'));
  }

  db.get('SELECT saldo_fiscal, saldo_nao_fiscal, controlar_validade FROM produtos WHERE id = ?', [produtoId], (getErr, produto) => {
    if (getErr) return callback(getErr);
    if (!produto) return callback(new Error('Produto não encontrado.'));

    const saldoFiscalAntes = Number(produto.saldo_fiscal || 0);
    const saldoNaoFiscalAntes = Number(produto.saldo_nao_fiscal || 0);
    const estoqueTotalAntes = saldoFiscalAntes + saldoNaoFiscalAntes;

    const saldoFiscalDepois = Number((saldoFiscalAntes + ajusteF).toFixed(3));
    const saldoNaoFiscalDepois = Number((saldoNaoFiscalAntes + ajusteNF).toFixed(3));
    const estoqueTotalDepois = Number((saldoFiscalDepois + saldoNaoFiscalDepois).toFixed(3));

    if (saldoFiscalDepois < 0) {
      return callback(new Error('Ajuste fiscal resultaria em saldo fiscal negativo.'));
    }
    if (saldoNaoFiscalDepois < 0) {
      return callback(new Error('Ajuste não fiscal resultaria em saldo não fiscal negativo.'));
    }

    const controlaValidade = produto.controlar_validade === 1;
    const ajusteTotalPositivo = Math.max(0, ajusteF) + Math.max(0, ajusteNF);
    const ajusteTotalNegativo = Math.abs(Math.min(0, ajusteF)) + Math.abs(Math.min(0, ajusteNF));

    const finalizarComSaldos = () => {
      db.run(`
        UPDATE produtos
        SET saldo_fiscal = ?,
            saldo_nao_fiscal = ?,
            estoque_atual = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [saldoFiscalDepois, saldoNaoFiscalDepois, estoqueTotalDepois, produtoId], (upErr) => {
        if (upErr) return callback(upErr);

        registrarAjusteEstoque(db, {
          produto_id: produtoId,
          usuario_id: usuarioId,
          usuario_nome: usuarioNome,
          motivo: String(motivo).trim(),
          ajuste_fiscal: ajusteF,
          ajuste_nao_fiscal: ajusteNF,
          saldo_fiscal_antes: saldoFiscalAntes,
          saldo_fiscal_depois: saldoFiscalDepois,
          saldo_nao_fiscal_antes: saldoNaoFiscalAntes,
          saldo_nao_fiscal_depois: saldoNaoFiscalDepois,
          estoque_total_antes: estoqueTotalAntes,
          estoque_total_depois: estoqueTotalDepois
        }, (histErr) => {
          if (histErr) return callback(histErr);
          callback(null, {
            saldo_fiscal: saldoFiscalDepois,
            saldo_nao_fiscal: saldoNaoFiscalDepois,
            estoque_atual: estoqueTotalDepois
          });
        });
      });
    };

    if (!controlaValidade) {
      return finalizarComSaldos();
    }

    if (ajusteTotalPositivo > 0) {
      if (!dataValidade) {
        return callback(new Error('Para produtos com controle de validade, informe a data de validade no ajuste positivo.'));
      }

      const hoje = new Date().toISOString().split('T')[0];
      return lotesService.criarLote({
        produto_id: produtoId,
        lote: lote || undefined,
        quantidade_inicial: ajusteTotalPositivo,
        data_fabricacao: dataFabricacao || null,
        data_validade: dataValidade,
        data_entrada: hoje,
        origem: 'AJUSTE_ESTOQUE',
        compra_id: null
      }, (loteErr) => {
        if (loteErr) return callback(loteErr);
        finalizarComSaldos();
      });
    }

    if (ajusteTotalNegativo > 0) {
      return lotesService.consumirLotesFEFO(produtoId, ajusteTotalNegativo, (consumoErr) => {
        if (consumoErr) return callback(consumoErr);
        finalizarComSaldos();
      });
    }

    finalizarComSaldos();
  });
}

function definirSaldosIniciaisProduto(saldoFiscal, saldoNaoFiscal) {
  const fiscal = Number(saldoFiscal || 0);
  const naoFiscal = Number(saldoNaoFiscal || 0);
  if (fiscal < 0 || naoFiscal < 0) {
    throw new Error('Saldos iniciais não podem ser negativos.');
  }
  const estoqueAtual = Number((fiscal + naoFiscal).toFixed(3));
  return {
    saldo_fiscal: fiscal,
    saldo_nao_fiscal: naoFiscal,
    estoque_atual: estoqueAtual
  };
}

module.exports = {
  produtoTemMovimentacoes,
  registrarAjusteEstoque,
  aplicarAjusteEstoqueProduto,
  definirSaldosIniciaisProduto
};
