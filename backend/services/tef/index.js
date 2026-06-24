const tefManager = require('./TefManager');
const tefContrato = require('./tefContrato');

/**
 * Fachada única TEF — delega sempre ao TefManager.
 * Elimina duplicação de fluxo entre rotas e vendas.
 */
async function iniciarPagamento(dados) {
  const resultado = await tefManager.autorizar(dados);

  if (resultado.transacao_id || resultado.transacaoId) {
    return tefContrato.paraRespostaApi(resultado, resultado.transacao_id || resultado.transacaoId);
  }

  if (resultado.transacao_existente && resultado.transacao_id) {
    return tefContrato.paraRespostaApi({
      sucesso: resultado.status === tefContrato.STATUS.APROVADO,
      status: resultado.status || tefContrato.STATUS.PENDENTE,
      codigo: resultado.codigo,
      mensagem: resultado.mensagem
    }, resultado.transacao_id);
  }

  return resultado;
}

async function cancelarPagamento(transacaoId, motivo = 'Cancelamento da venda') {
  return tefManager.cancelar(Number(transacaoId), motivo);
}

async function consultarPagamento(transacaoId) {
  return tefManager.consultar(Number(transacaoId));
}

async function reimprimirPagamento(transacaoId, tipo = 'cliente') {
  return tefManager.reimprimir(Number(transacaoId), tipo);
}

module.exports = {
  iniciarPagamento,
  cancelarPagamento,
  consultarPagamento,
  reimprimirPagamento
};
