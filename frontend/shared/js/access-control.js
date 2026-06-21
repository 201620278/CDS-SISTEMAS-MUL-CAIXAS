/**
 * Controle de acesso entre módulos ERP e PDV.
 * Administrador → ERP (+ PDV via link)
 * Caixa → somente PDV
 */

const PERMISSOES_PAGINAS = {
    pdv: 'pdv',
    caixa: 'caixa',
    caixas: 'caixa',
    'fechamento-caixa': 'caixa',
    produtos: 'produtos',
    clientes: 'clientes',
    compras: 'compras',
    fornecedores: 'fornecedores',
    vendas: 'vendas',
    consulta: 'pdv',
    reimpressao: 'vendas',
    financeiro: 'financeiro',
    categorias: 'categorias',
    fiscal: 'fiscal',
    configuracoes: 'configuracoes',
    licenca: 'configuracoes',
    dashboard: 'relatorios',
    usuarios: 'usuarios',
    relatorios: 'relatorios',
    auditoria: 'auditoria',
    'configuracoes-avancadas': 'configuracoes',
    estoque: 'produtos'
};

const PERMISSOES_MODULO_PDV = new Set(['pdv', 'caixa', 'vendas', 'clientes', 'fiscal']);

const PERMISSOES_MODULO_ERP = new Set([
    'produtos', 'clientes', 'compras', 'fornecedores', 'vendas',
    'financeiro', 'categorias', 'fiscal', 'configuracoes', 'usuarios',
    'relatorios', 'auditoria', 'caixa', 'caixas'
]);

function normalizarPermissoes(permissoes) {
    if (typeof permissoes === 'string') {
        return permissoes.split(',').map(p => String(p || '').trim()).filter(Boolean);
    }
    return Array.isArray(permissoes) ? permissoes : [];
}

function obterUsuarioLogado() {
    try {
        return JSON.parse(localStorage.getItem('user') || '{}');
    } catch (e) {
        return {};
    }
}

function obterPermissoesUsuario() {
    const user = obterUsuarioLogado();
    return {
        role: user.role || 'operador',
        perfil: String(user.perfil || 'USUARIO').toUpperCase(),
        permissoes: normalizarPermissoes(user.permissoes)
    };
}

function isSuperAdminUser() {
    return obterPermissoesUsuario().perfil === 'SUPER_ADMIN';
}

function isUsuarioAdministrador(user) {
    const u = user || obterUsuarioLogado();
    const role = u.role || 'operador';
    const perfil = String(u.perfil || 'USUARIO').toUpperCase();

    if (role === 'admin') return true;
    if (['SUPER_ADMIN', 'ADMIN'].includes(perfil)) return true;

    const permissoes = normalizarPermissoes(u.permissoes);
    const temPermissaoErp = permissoes.some(p => PERMISSOES_MODULO_ERP.has(p) && p !== 'pdv');
    return temPermissaoErp;
}

function isUsuarioCaixa(user) {
    const u = user || obterUsuarioLogado();
    if (isUsuarioAdministrador(u)) return false;

    const perfil = String(u.perfil || 'USUARIO').toUpperCase();
    if (perfil === 'CAIXA') return true;

    const permissoes = normalizarPermissoes(u.permissoes);
    if (!permissoes.length) return false;

    return permissoes.every(p => PERMISSOES_MODULO_PDV.has(p));
}

function podeAcessarModulo(modulo) {
    const user = obterUsuarioLogado();
    if (!localStorage.getItem('token')) return false;

    if (modulo === 'erp') {
        return isUsuarioAdministrador(user);
    }

    if (modulo === 'pdv') {
        if (isUsuarioAdministrador(user)) return true;
        if (isUsuarioCaixa(user)) return true;
        const { role, permissoes } = obterPermissoesUsuario();
        if (role === 'admin') return true;
        return permissoes.includes('pdv') || permissoes.includes('caixa');
    }

    return false;
}

function obterDestinoPosLogin(user) {
  const moduloPreferido = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const queryModulo = params.get('modulo');
      if (queryModulo) {
        localStorage.setItem('cds_app_modulo', queryModulo);
        return queryModulo;
      }
    } catch (e) { /* ignore */ }
    return localStorage.getItem('cds_app_modulo') || window.CDS_APP_MODULO || '';
  })();

  if (moduloPreferido === 'pdv' && podeAcessarModulo('pdv')) return '/pdv';
  if (moduloPreferido === 'erp' && podeAcessarModulo('erp')) return '/erp';

  if (isUsuarioCaixa(user)) return '/pdv';
  if (isUsuarioAdministrador(user)) return '/erp';
  if (podeAcessarModulo('erp')) return '/erp';
  if (podeAcessarModulo('pdv')) return '/pdv';
  return '/login';
}

function usuarioTemPermissao(page) {
    const { role, permissoes } = obterPermissoesUsuario();

    if (page === 'configuracoes-avancadas') {
        return isSuperAdminUser();
    }

    if (role === 'admin') return true;

    const permissaoNecessaria = PERMISSOES_PAGINAS[page];
    if (!permissaoNecessaria) return false;

    return permissoes.includes(permissaoNecessaria);
}

function redirecionarSeModuloNegado(moduloAtual) {
    if (podeAcessarModulo(moduloAtual)) return false;

    if (moduloAtual === 'erp' && podeAcessarModulo('pdv')) {
        window.location.replace('/pdv');
        return true;
    }

    if (moduloAtual === 'pdv' && podeAcessarModulo('erp')) {
        window.location.replace('/erp');
        return true;
    }

    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.replace('/login');
    return true;
}

window.obterUsuarioLogado = obterUsuarioLogado;
window.PERMISSOES_PAGINAS = PERMISSOES_PAGINAS;
window.obterPermissoesUsuario = obterPermissoesUsuario;
window.isSuperAdminUser = isSuperAdminUser;
window.isUsuarioAdministrador = isUsuarioAdministrador;
window.isUsuarioCaixa = isUsuarioCaixa;
window.podeAcessarModulo = podeAcessarModulo;
window.obterDestinoPosLogin = obterDestinoPosLogin;
window.usuarioTemPermissao = usuarioTemPermissao;
window.redirecionarSeModuloNegado = redirecionarSeModuloNegado;
