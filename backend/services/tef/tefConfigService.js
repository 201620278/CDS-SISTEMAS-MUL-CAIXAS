const repository = require('../../repositories/tefConfigRepository');
const pinpadCatalog = require('./pinpads/pinpadCatalog');

function resolverPinpadPayload(payload = {}) {
  const codigo = normalizarTexto(payload.pinpadModelo || payload.pinpadCodigo) || null;
  const meta = pinpadCatalog.resolver({
    codigo,
    fabricante: payload.fabricante,
    modelo: payload.modelo
  });

  return {
    habilitado: normalizarBoolean(payload.pinpadHabilitado),
    codigo: meta?.codigo || codigo || null,
    nome: meta?.nome || normalizarTexto(payload.pinpadNome) || null,
    fabricante: meta?.fabricante || normalizarTexto(payload.fabricante) || null,
    modelo: meta?.modelo || normalizarTexto(payload.modelo) || null,
    tipo_conexao: inferirTipoConexaoPinpad(payload),
    porta_com: normalizarTexto(payload.portaCom) || null,
    ip: normalizarTexto(payload.pinpadIp) || null,
    porta: normalizarNumero(payload.pinpadPorta),
    serial: normalizarTexto(payload.serial) || null,
    ativo: 1
  };
}

function normalizarTexto(valor) {
  if (valor === null || valor === undefined) {
    return '';
  }
  return String(valor);
}

function normalizarNumero(valor) {
  if (valor === '' || valor === null || valor === undefined) {
    return null;
  }
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function normalizarBoolean(valor) {
  return valor === true || valor === 'true' || valor === '1' || valor === 1;
}

function inferirTipoConexaoPinpad(dados) {
  if (dados.pinpadIp || dados.ip) {
    return 'ip';
  }
  if (dados.portaCom || dados.porta_com) {
    return 'serial';
  }
  return '';
}

function mapearPayloadEntrada(payload = {}) {
  return {
    principal: {
      habilitado: normalizarBoolean(payload.tefHabilitado),
      provedor: normalizarTexto(payload.tefProvedor) || null,
      ambiente: normalizarTexto(payload.tefAmbiente) || null,
      timeout: normalizarNumero(payload.tefTimeout),
      tentativas: normalizarNumero(payload.tefTentativas),
      empresa_codigo: normalizarTexto(payload.empresaCodigo) || null,
      loja_codigo: normalizarTexto(payload.lojaCodigo) || null,
      pdv_codigo: normalizarTexto(payload.pdvCodigo) || null,
      terminal_codigo: normalizarTexto(payload.terminalCodigo) || null,
      caixa_codigo: normalizarTexto(payload.caixaCodigo) || null
    },
    servidor: {
      base_url: normalizarTexto(payload.baseUrl) || null,
      ip: normalizarTexto(payload.ipServidor) || null,
      porta: normalizarNumero(payload.portaServidor),
      client_id: normalizarTexto(payload.clientId) || null,
      client_secret: normalizarTexto(payload.clientSecret) || null,
      access_token: normalizarTexto(payload.accessToken) || null,
      refresh_token: normalizarTexto(payload.refreshToken) || null,
      chave_comunicacao: normalizarTexto(payload.chaveComunicacao) || null,
      operador: normalizarTexto(payload.operador) || null
    },
    pinpad: resolverPinpadPayload(payload),
    operacoes: {
      debito: normalizarBoolean(payload.debito),
      credito_avista: normalizarBoolean(payload.creditoAvista),
      credito_parcelado: normalizarBoolean(payload.creditoParcelado),
      voucher: normalizarBoolean(payload.voucher),
      pix: normalizarBoolean(payload.pix),
      cancelamento: normalizarBoolean(payload.cancelamento),
      reimpressao: normalizarBoolean(payload.reimpressao),
      pre_autorizacao: normalizarBoolean(payload.preAutorizacao),
      confirmacao_manual: normalizarBoolean(payload.confirmacaoManual)
    }
  };
}

function mapearPayloadLegado(payload = {}) {
  return mapearPayloadEntrada({
    tefHabilitado: payload.tefHabilitado,
    tefProvedor: payload.tefProvedor,
    tefAmbiente: payload.tefAmbiente,
    tefTimeout: payload.tefTimeout,
    tefTentativas: payload.tefTentativas,
    empresaCodigo: payload.empresaCodigo,
    lojaCodigo: payload.lojaCodigo,
    pdvCodigo: payload.pdvCodigo,
    terminalCodigo: payload.terminalCodigo,
    caixaCodigo: payload.caixaCodigo,
    baseUrl: payload.baseUrl,
    ipServidor: payload.ipServidor,
    portaServidor: payload.portaServidor,
    clientId: payload.clientId,
    clientSecret: payload.clientSecret,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    chaveComunicacao: payload.chaveComunicacao,
    operador: payload.operador,
    pinpadHabilitado: payload.pinpadHabilitado,
    pinpadModelo: payload.pinpadModelo,
    pinpadCodigo: payload.pinpadCodigo,
    fabricante: payload.fabricante,
    modelo: payload.modelo,
    portaCom: payload.portaCom,
    pinpadIp: payload.pinpadIp,
    pinpadPorta: payload.pinpadPorta,
    serial: payload.serial,
    debito: payload.debito,
    creditoAvista: payload.creditoAvista,
    creditoParcelado: payload.creditoParcelado,
    voucher: payload.voucher,
    pix: payload.pix,
    cancelamento: payload.cancelamento,
    reimpressao: payload.reimpressao,
    preAutorizacao: payload.preAutorizacao,
    confirmacaoManual: payload.confirmacaoManual
  });
}

function boolParaResposta(valor) {
  return repository.intToBool(valor) ? 'true' : 'false';
}

function mapearConfiguracaoSaida(registro) {
  if (!registro?.principal) {
    return {};
  }

  const { principal, servidor, pinpad, operacoes } = registro;

  return {
    id: principal.id,
    tefHabilitado: boolParaResposta(principal.habilitado),
    tefProvedor: principal.provedor || '',
    tefAmbiente: principal.ambiente || '',
    tefTimeout: principal.timeout ?? '',
    tefTentativas: principal.tentativas ?? '',
    empresaCodigo: principal.empresa_codigo || '',
    lojaCodigo: principal.loja_codigo || '',
    pdvCodigo: principal.pdv_codigo || '',
    terminalCodigo: principal.terminal_codigo || '',
    caixaCodigo: principal.caixa_codigo || '',
    baseUrl: servidor?.base_url || '',
    ipServidor: servidor?.ip || '',
    portaServidor: servidor?.porta ?? '',
    clientId: servidor?.client_id || '',
    clientSecret: servidor?.client_secret || '',
    accessToken: servidor?.access_token || '',
    refreshToken: servidor?.refresh_token || '',
    chaveComunicacao: servidor?.chave_comunicacao || '',
    operador: servidor?.operador || '',
    pinpadHabilitado: boolParaResposta(pinpad?.habilitado),
    pinpadModelo: pinpad?.codigo || '',
    pinpadCodigo: pinpad?.codigo || '',
    pinpadNome: pinpad?.nome || '',
    pinpadNomeExibicao: pinpadCatalog.resolverPorCodigo(pinpad?.codigo)?.nomeExibicao || pinpad?.nome || '',
    fabricante: pinpad?.fabricante || '',
    modelo: pinpad?.modelo || '',
    tipoConexao: pinpad?.tipo_conexao || '',
    portaCom: pinpad?.porta_com || '',
    pinpadIp: pinpad?.ip || '',
    pinpadPorta: pinpad?.porta ?? '',
    serial: pinpad?.serial || '',
    pinpadStatus: pinpad?.status || 'desconhecido',
    pinpadUltimaConexao: pinpad?.ultima_conexao || '',
    debito: boolParaResposta(operacoes?.debito),
    creditoAvista: boolParaResposta(operacoes?.credito_avista),
    creditoParcelado: boolParaResposta(operacoes?.credito_parcelado),
    voucher: boolParaResposta(operacoes?.voucher),
    pix: boolParaResposta(operacoes?.pix),
    cancelamento: boolParaResposta(operacoes?.cancelamento),
    reimpressao: boolParaResposta(operacoes?.reimpressao),
    preAutorizacao: boolParaResposta(operacoes?.pre_autorizacao),
    confirmacaoManual: boolParaResposta(operacoes?.confirmacao_manual)
  };
}

async function migrarConfiguracaoLegadaSeNecessario() {
  const total = await repository.contarConfiguracoes();
  if (total > 0) {
    return false;
  }

  const legado = await repository.listarConfiguracaoLegada();
  if (!Object.keys(legado).length) {
    return false;
  }

  const dados = mapearPayloadLegado(legado);
  await repository.salvarConfiguracaoCompleta(dados, { atualizar: false });
  return true;
}

async function obterConfiguracao() {
  await migrarConfiguracaoLegadaSeNecessario();
  const registro = await repository.buscarConfiguracaoCompleta();
  return mapearConfiguracaoSaida(registro);
}

async function criarConfiguracao(payload) {
  const existente = await repository.buscarConfiguracaoPrincipal();
  if (existente) {
    const erro = new Error('Configuração TEF já existe. Utilize PUT para atualizar.');
    erro.statusCode = 409;
    throw erro;
  }

  const dados = mapearPayloadEntrada(payload);
  const registro = await repository.salvarConfiguracaoCompleta(dados, { atualizar: false });
  return mapearConfiguracaoSaida(registro);
}

async function atualizarConfiguracao(payload) {
  const dados = mapearPayloadEntrada(payload);
  const registro = await repository.salvarConfiguracaoCompleta(dados, { atualizar: true });
  return mapearConfiguracaoSaida(registro);
}

async function salvarConfiguracao(payload) {
  const existente = await repository.buscarConfiguracaoPrincipal();
  const dados = mapearPayloadEntrada(payload);
  const registro = await repository.salvarConfiguracaoCompleta(dados, {
    atualizar: Boolean(existente)
  });
  return mapearConfiguracaoSaida(registro);
}

function validarServidorConfigurado(servidor) {
  return Boolean(
    servidor?.base_url ||
    servidor?.ip ||
    servidor?.client_id ||
    servidor?.access_token
  );
}

function validarPinpadConfigurado(pinpad) {
  if (!repository.intToBool(pinpad?.habilitado)) {
    return false;
  }

  return Boolean(
    pinpad?.codigo ||
    pinpad?.porta_com ||
    pinpad?.ip ||
    pinpad?.serial
  );
}

async function obterStatus() {
  await migrarConfiguracaoLegadaSeNecessario();
  const registro = await repository.buscarConfiguracaoCompleta();

  if (!registro?.principal) {
    return {
      configurado: false,
      tefHabilitado: false,
      mensagem: 'Configuração TEF não encontrada.'
    };
  }

  const { principal, servidor, pinpad, operacoes } = registro;
  const tefHabilitado = repository.intToBool(principal.habilitado);
  const servidorConfigurado = validarServidorConfigurado(servidor);
  const pinpadConfigurado = validarPinpadConfigurado(pinpad);

  return {
    configurado: true,
    tefHabilitado,
    provedor: principal.provedor || '',
    ambiente: principal.ambiente || '',
    servidor: {
      configurado: servidorConfigurado,
      conectado: false,
      baseUrl: servidor?.base_url || '',
      ip: servidor?.ip || '',
      porta: servidor?.porta ?? null
    },
    pinpad: {
      habilitado: repository.intToBool(pinpad?.habilitado),
      configurado: pinpadConfigurado,
      codigo: pinpad?.codigo || '',
      nome: pinpad?.nome || '',
      nomeExibicao: pinpadCatalog.resolverPorCodigo(pinpad?.codigo)?.nomeExibicao || pinpad?.nome || '',
      status: pinpad?.status || 'desconhecido',
      fabricante: pinpad?.fabricante || '',
      modelo: pinpad?.modelo || '',
      ultimaConexao: pinpad?.ultima_conexao || null
    },
    operacoes: {
      debito: repository.intToBool(operacoes?.debito),
      creditoAvista: repository.intToBool(operacoes?.credito_avista),
      creditoParcelado: repository.intToBool(operacoes?.credito_parcelado),
      voucher: repository.intToBool(operacoes?.voucher),
      pix: repository.intToBool(operacoes?.pix),
      cancelamento: repository.intToBool(operacoes?.cancelamento),
      reimpressao: repository.intToBool(operacoes?.reimpressao),
      preAutorizacao: repository.intToBool(operacoes?.pre_autorizacao),
      confirmacaoManual: repository.intToBool(operacoes?.confirmacao_manual)
    }
  };
}

async function testarConexao() {
  await migrarConfiguracaoLegadaSeNecessario();
  const registro = await repository.buscarConfiguracaoCompleta();

  if (!registro?.principal) {
    const erro = new Error('Configuração TEF não encontrada.');
    erro.statusCode = 404;
    throw erro;
  }

  const { principal, servidor, pinpad } = registro;
  const testes = [];
  let sucessoGeral = true;

  if (!repository.intToBool(principal.habilitado)) {
    return {
      sucesso: false,
      mensagem: 'TEF está desabilitado na configuração.',
      testes: [{
        tipo: 'geral',
        sucesso: false,
        mensagem: 'Habilite o TEF antes de testar.'
      }]
    };
  }

  const servidorConfigurado = validarServidorConfigurado(servidor);
  testes.push({
    tipo: 'servidor',
    sucesso: servidorConfigurado,
    mensagem: servidorConfigurado
      ? 'Parâmetros de servidor encontrados.'
      : 'Servidor TEF não configurado.'
  });

  if (!servidorConfigurado) {
    sucessoGeral = false;
  }

  const pinpadHabilitado = repository.intToBool(pinpad?.habilitado);
  if (pinpadHabilitado) {
    const pinpadConfigurado = validarPinpadConfigurado(pinpad);
    testes.push({
      tipo: 'pinpad',
      sucesso: pinpadConfigurado,
      mensagem: pinpadConfigurado
        ? 'PinPad configurado e pronto para teste.'
        : 'PinPad habilitado, mas sem parâmetros de conexão.'
    });

    if (pinpadConfigurado) {
      await repository.atualizarStatusPinpad(principal.id, 'testado');
    } else {
      sucessoGeral = false;
    }
  } else {
    testes.push({
      tipo: 'pinpad',
      sucesso: true,
      mensagem: 'PinPad desabilitado. Teste ignorado.'
    });
  }

  testes.push({
    tipo: 'provedor',
    sucesso: Boolean(principal.provedor),
    mensagem: principal.provedor
      ? `Provedor ${principal.provedor} configurado.`
      : 'Provedor TEF não informado.'
  });

  if (!principal.provedor) {
    sucessoGeral = false;
  }

  return {
    sucesso: sucessoGeral,
    mensagem: sucessoGeral
      ? 'Teste de configuração TEF concluído com sucesso.'
      : 'Teste de configuração TEF concluído com pendências.',
    ambiente: principal.ambiente || '',
    provedor: principal.provedor || '',
    servidor: {
      baseUrl: servidor?.base_url || '',
      ip: servidor?.ip || '',
      porta: servidor?.porta ?? null
    },
    testes
  };
}

module.exports = {
  obterConfiguracao,
  criarConfiguracao,
  atualizarConfiguracao,
  salvarConfiguracao,
  obterStatus,
  testarConexao,
  mapearConfiguracaoSaida
};
