const db = require('../database');
const { isMultiCaixaAtivo, obterTerminalIdDaRequisicao, parsePositiveInteger } = require('../utils/multiCaixa');
const { obterCaixaTurnoId } = require('../utils/caixaSessaoHelpers');

function obterTerminalId(req) {
  return obterTerminalIdDaRequisicao(req);
}

function obterSessaoId(req) {
  const rawId = req.body?.caixa_sessao_id || req.query?.caixa_sessao_id || req.headers['x-caixa-sessao-id'] || req.user?.caixa_sessao_id;
  return parsePositiveInteger(rawId);
}

function validarCaixaAberto(req, res, next) {
  const terminalId = obterTerminalId(req);
  const sessaoId = obterSessaoId(req);

  if (isMultiCaixaAtivo() && !sessaoId && !terminalId) {
    return res.status(400).json({
      error: 'terminal_id é obrigatório no modo multi-caixa.'
    });
  }

  let sql;
  let params;

  if (sessaoId) {
    sql = `SELECT * FROM caixa_sessoes WHERE id = ? AND status = 'aberto'`;
    params = [sessaoId];
  } else if (terminalId) {
    sql = `SELECT * FROM caixa_sessoes WHERE status = 'aberto' AND terminal_id = ? ORDER BY id DESC LIMIT 1`;
    params = [terminalId];
  } else if (!isMultiCaixaAtivo()) {
    sql = `SELECT * FROM caixa_sessoes WHERE status = 'aberto' ORDER BY id DESC LIMIT 1`;
    params = [];
  } else {
    return res.status(400).json({ error: 'Nenhum caixa aberto neste terminal.' });
  }

  db.get(sql, params, (err, sessao) => {
    if (err) {
      console.error('Erro ao verificar sessão de caixa:', err);
      return res.status(500).json({ error: 'Erro ao verificar sessão de caixa.' });
    }

    if (!sessao) {
      const mensagem = sessaoId
        ? 'Nenhuma sessão de caixa aberta para esta sessão.'
        : terminalId
          ? 'Nenhum caixa aberto neste terminal.'
          : 'Nenhum caixa aberto.';
      return res.status(400).json({ error: mensagem });
    }

    req.caixaSessaoId = sessao.id;
    req.caixaId = obterCaixaTurnoId(sessao);
    req.caixaConfigId = sessao.caixa_id || null;
    req.terminalId = terminalId || sessao.terminal_id || null;
    req.operadorId = req.user?.id || sessao.operador_id || null;
    req.caixaSessao = sessao;

    next();
  });
}

module.exports = { validarCaixaAberto };
