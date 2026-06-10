const verificarLicenca = require('../services/verificarLicenca');
const licencaService = require('../services/licencaService');

function normalizeApiPath(req) {
  const url = req.originalUrl || req.url || '';
  return url.split('?')[0];
}

function isProtectedRoute(req) {
  const method = req.method.toUpperCase();
  const apiPath = normalizeApiPath(req);

  const protecaoProdutos = apiPath.startsWith('/api/produtos');
  const protecaoClientes = apiPath.startsWith('/api/clientes');
  const protecaoCompras = apiPath.startsWith('/api/compras');
  const protecaoVendas = apiPath.startsWith('/api/vendas');
  const protecaoFiscal = apiPath.startsWith('/api/fiscal');
  const protecaoFinanceiro = apiPath.startsWith('/api/financeiro');
  const protecaoConfiguracoes = apiPath.startsWith('/api/configuracoes');
  const protecaoFornecedores = apiPath.startsWith('/api/fornecedores');
  const protecaoCategorias = apiPath.startsWith('/api/categorias');
  const protecaoSubcategorias = apiPath.startsWith('/api/subcategorias');
  const protecaoDashboard = apiPath.startsWith('/api/dashboard');
  const protecaoImpressao = apiPath.startsWith('/api/impressao');
  const protecaoTef = apiPath.startsWith('/api/tef');
  const protecaoPix = apiPath.startsWith('/api/pix');
  const protecaoBackup = apiPath.startsWith('/api/backup');

  return (
    protecaoProdutos ||
    protecaoClientes ||
    protecaoCompras ||
    protecaoVendas ||
    protecaoFiscal ||
    protecaoFinanceiro ||
    protecaoConfiguracoes ||
    protecaoFornecedores ||
    protecaoCategorias ||
    protecaoSubcategorias ||
    protecaoDashboard ||
    protecaoImpressao ||
    protecaoTef ||
    protecaoPix ||
    protecaoBackup
  );
}

function isAllowedDuringExpired(req) {
  const method = req.method.toUpperCase();
  const apiPath = normalizeApiPath(req);

  if (apiPath.startsWith('/api/clientes')) {
    return ['GET', 'POST'].includes(method);
  }

  if (apiPath.startsWith('/api/produtos')) {
    return method === 'GET';
  }

  if (apiPath.startsWith('/api/vendas')) {
    return method === 'GET';
  }

  return false;
}

async function licencaMiddleware(req, res, next) {
  const apiPath = normalizeApiPath(req);

  if (
    apiPath.startsWith('/api/licenca') ||
    apiPath.startsWith('/api/auth') ||
    apiPath.startsWith('/api/configuracoes/login_background')
  ) {
    return next();
  }

  if (!isProtectedRoute(req)) {
    return next();
  }

  const resultado = await verificarLicenca();

  if (!resultado.valido) {
    if (resultado.motivo === 'DATA_ALTERADA') {
      licencaService.gravarLog('Tentativa de alteração de data', `Tentativa de uso com data alterada. Última execução: ${resultado.ultima_execucao}`);
      return res.status(403).json({ error: 'Foi detectada inconsistência na data do computador.' });
    }

    if (resultado.motivo === 'VENCIDA') {
      if (isAllowedDuringExpired(req)) {
        return next();
      }
      licencaService.gravarLog('Licença vencida', `Tentativa de uso bloqueado em rota ${req.baseUrl}`);
      return res.status(403).json({ error: 'Sistema com licença expirada. Entre em contato com o suporte.' });
    }

    return res.status(403).json({
      error: 'Sistema não ativado.',
      codigo_instalacao: resultado.codigo_instalacao
    });
  }

  next();
}

module.exports = licencaMiddleware;
