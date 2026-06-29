const configService = require('../services/configuracaoService');

function isMultiCaixaAtivo() {
  try {
    return configService.getRecursos().recursos.multiCaixa === true;
  } catch (e) {
    return false;
  }
}

function parsePositiveInteger(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function obterTerminalIdDaRequisicao(req) {
  const rawId = req.body?.terminal_id || req.query?.terminal_id || req.headers['x-terminal-id'] || req.user?.terminal_id;
  return parsePositiveInteger(rawId);
}

function exigirTerminalId(req, res, next) {
  if (!isMultiCaixaAtivo()) {
    return next();
  }

  const terminalId = obterTerminalIdDaRequisicao(req);
  if (!terminalId) {
    return res.status(400).json({
      error: 'terminal_id é obrigatório no modo multi-caixa. Aguarde o registro do terminal ou reinicie o PDV.'
    });
  }

  req.terminalId = terminalId;
  next();
}

module.exports = {
  isMultiCaixaAtivo,
  parsePositiveInteger,
  obterTerminalIdDaRequisicao,
  exigirTerminalId
};
