/**
 * Contrato oficial de resposta dos adapters TEF.
 * Todos os adapters devem normalizar retornos via estas funções.
 */

const STATUS = {
  APROVADO: 'aprovado',
  NEGADO: 'negado',
  PENDENTE: 'pendente',
  CANCELADO: 'cancelado',
  ERRO: 'erro'
};

function normalizarStatus(valor) {
  const s = String(valor || '').toLowerCase();
  if (['aprovado', 'approved', 'ok', 'success'].includes(s)) return STATUS.APROVADO;
  if (['negado', 'negada', 'denied', 'reprovado'].includes(s)) return STATUS.NEGADO;
  if (['cancelado', 'cancelada', 'cancelled'].includes(s)) return STATUS.CANCELADO;
  if (['pendente', 'pending', 'processando'].includes(s)) return STATUS.PENDENTE;
  return STATUS.ERRO;
}

function estaAprovado(retorno) {
  if (!retorno) return false;
  if (retorno.sucesso === true && normalizarStatus(retorno.status) === STATUS.APROVADO) return true;
  return normalizarStatus(retorno.status) === STATUS.APROVADO;
}

/**
 * @param {object} params
 * @returns {object} Contrato padronizado de autorização
 */
function criarRespostaAutorizacao({
  sucesso = false,
  status = STATUS.ERRO,
  nsu = null,
  autorizacao = null,
  adquirente = null,
  bandeira = null,
  comprovanteCliente = null,
  comprovanteLoja = null,
  transacaoId = null,
  codigo = null,
  mensagem = '',
  payloadRetorno = null,
  modo = 'simulacao'
} = {}) {
  const statusNorm = normalizarStatus(status);
  return {
    sucesso: sucesso === true || statusNorm === STATUS.APROVADO,
    status: statusNorm,
    nsu: nsu || null,
    autorizacao: autorizacao || null,
    adquirente: adquirente || null,
    bandeira: bandeira || null,
    comprovanteCliente: comprovanteCliente || null,
    comprovanteLoja: comprovanteLoja || null,
    transacaoId: transacaoId != null ? String(transacaoId) : null,
    codigo: codigo || null,
    mensagem: mensagem || '',
    payloadRetorno: payloadRetorno || null,
    modo
  };
}

function criarRespostaCancelamento({
  sucesso = false,
  status = STATUS.CANCELADO,
  nsu = null,
  autorizacao = null,
  transacaoId = null,
  codigo = null,
  mensagem = '',
  payloadRetorno = null,
  modo = 'simulacao'
} = {}) {
  const statusNorm = normalizarStatus(status);
  return {
    sucesso: sucesso === true || statusNorm === STATUS.CANCELADO,
    status: statusNorm,
    nsu: nsu || null,
    autorizacao: autorizacao || null,
    transacaoId: transacaoId != null ? String(transacaoId) : null,
    codigo: codigo || null,
    mensagem: mensagem || '',
    payloadRetorno: payloadRetorno || null,
    modo
  };
}

function criarRespostaConsulta({
  sucesso = false,
  status = STATUS.PENDENTE,
  nsu = null,
  autorizacao = null,
  transacaoId = null,
  suportado = true,
  mensagem = '',
  dados = null,
  modo = 'simulacao'
} = {}) {
  return {
    sucesso,
    status: normalizarStatus(status),
    nsu: nsu || null,
    autorizacao: autorizacao || null,
    transacaoId: transacaoId != null ? String(transacaoId) : null,
    suportado,
    mensagem,
    dados: dados || null,
    modo
  };
}

function criarRespostaReimpressao({
  sucesso = false,
  tipo = 'cliente',
  comprovante = null,
  suportado = true,
  mensagem = '',
  modo = 'simulacao'
} = {}) {
  return {
    sucesso,
    tipo,
    comprovante: comprovante || null,
    suportado,
    mensagem,
    modo
  };
}

function criarRespostaDiagnostico({
  sucesso = false,
  mensagem = '',
  detalhes = {}
} = {}) {
  return {
    sucesso,
    mensagem,
    detalhes: detalhes || {},
    timestamp: new Date().toISOString()
  };
}

/** Mapeia contrato padronizado → campos do banco / legado API */
function paraPersistencia(retorno) {
  return {
    status: retorno.status,
    adquirente: retorno.adquirente,
    bandeira: retorno.bandeira,
    nsu: retorno.nsu,
    autorizacao: retorno.autorizacao,
    codigo_transacao: retorno.transacaoId || retorno.codigo_transacao || null,
    comprovante_cliente: retorno.comprovanteCliente || retorno.comprovante_cliente || null,
    comprovante_estabelecimento: retorno.comprovanteLoja || retorno.comprovante_estabelecimento || null,
    payload_retorno: retorno.payloadRetorno || retorno.payload_retorno || retorno
  };
}

/** Mapeia contrato → resposta HTTP (compatível PDV e vendas) */
function paraRespostaApi(retorno, transacaoId = null) {
  const id = transacaoId || retorno.transacaoId || retorno.transacao_id;
  return {
    sucesso: retorno.sucesso === true,
    status: retorno.status,
    aprovado: estaAprovado(retorno),
    nsu: retorno.nsu,
    autorizacao: retorno.autorizacao,
    adquirente: retorno.adquirente,
    bandeira: retorno.bandeira,
    comprovanteCliente: retorno.comprovanteCliente,
    comprovanteLoja: retorno.comprovanteLoja,
    comprovante_cliente: retorno.comprovanteCliente || retorno.comprovante_cliente || null,
    comprovante_estabelecimento: retorno.comprovanteLoja || retorno.comprovante_estabelecimento || null,
    transacaoId: id != null ? String(id) : null,
    transacao_id: id != null ? Number(id) : null,
    codigo: retorno.codigo,
    mensagem: retorno.mensagem || '',
    modo: retorno.modo || null,
    payloadRetorno: retorno.payloadRetorno || retorno.payload_retorno || null,
    pix_copia_cola: retorno.pixCopiaCola
      || retorno.pix_copia_cola
      || retorno.payloadRetorno?.pix_copia_cola
      || retorno.payload_retorno?.pix_copia_cola
      || null,
    exibir_qr_tela: retorno.exibirQrTela
      || retorno.exibir_qr_tela
      || retorno.payloadRetorno?.exibir_qr_tela
      || retorno.payload_retorno?.exibir_qr_tela
      || false
  };
}

module.exports = {
  STATUS,
  normalizarStatus,
  estaAprovado,
  criarRespostaAutorizacao,
  criarRespostaCancelamento,
  criarRespostaConsulta,
  criarRespostaReimpressao,
  criarRespostaDiagnostico,
  paraPersistencia,
  paraRespostaApi
};
