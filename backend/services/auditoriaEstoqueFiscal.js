function validarSaldos(produto) {
  const consolidado =
    Number(produto.estoque_atual || 0);

  const calculado =
    Number(produto.saldo_fiscal || 0) +
    Number(produto.saldo_nao_fiscal || 0);

  return consolidado === calculado;
}

module.exports = {
  validarSaldos
};
