const sdkDetector = require('./sdkDetector');
const { obterAdapter } = require('./tefFactory');
const tefConfigService = require('./tefConfigService');
const pinpadCatalog = require('./pinpads/pinpadCatalog');
const { obterPinpad, reconhecerAutomaticamente } = require('./pinpads/PinpadFactory');
const db = require('../../database');

function promisifyGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function promisifyRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes });
    });
  });
}

async function verificarBanco() {
  try {
    await promisifyGet('SELECT COUNT(*) AS total FROM tef_transacoes');
    return { acessivel: true, mensagem: 'Tabela tef_transacoes acessível' };
  } catch (error) {
    return { acessivel: false, mensagem: error.message };
  }
}

function validarConfiguracao(config, status) {
  const pendencias = [];

  if (!config.tefHabilitado || config.tefHabilitado === 'false') {
    pendencias.push('TEF desabilitado na configuração');
  }
  if (!config.tefProvedor) {
    pendencias.push('Provedor TEF não informado');
  }
  if (!config.tefAmbiente) {
    pendencias.push('Ambiente TEF não informado');
  }
  if (!config.empresaCodigo && !config.lojaCodigo) {
    pendencias.push('Códigos empresa/loja não configurados');
  }
  if (!config.terminalCodigo) {
    pendencias.push('Código do terminal não configurado');
  }
  if (status?.pinpad?.habilitado && !status.pinpad.configurado) {
    pendencias.push('PinPad habilitado sem parâmetros de conexão');
  }

  return {
    valida: pendencias.length === 0,
    pendencias
  };
}

function resolverStatusPinpadMiddleware(provedor, middlewareInstalado, pinpadConfigurado) {
  if (!pinpadConfigurado) {
    return 'Não configurado';
  }
  if (['sitef', 'paygo'].includes(provedor)) {
    return middlewareInstalado ? 'Pronto para homologação' : 'Aguardando Middleware';
  }
  return middlewareInstalado ? 'Pronto para homologação' : 'Aguardando Middleware';
}

function montarDiagnosticoPinpad(config, statusConfig, sdk, provedor, middlewareInstalado) {
  const codigo = config.pinpadCodigo || config.pinpadModelo || statusConfig?.pinpad?.codigo || '';
  const meta = pinpadCatalog.resolver({
    codigo,
    fabricante: config.fabricante,
    modelo: config.modelo
  });
  const reconhecimento = reconhecerAutomaticamente({ codigo, fabricante: config.fabricante, modelo: config.modelo });
  const middlewareNome = provedor === 'sitef'
    ? 'CliSiTef'
    : provedor === 'paygo'
      ? 'PayGo'
      : (provedor ? String(provedor).toUpperCase() : 'não definido');

  const pinpadHabilitado = config.pinpadHabilitado === 'true' || config.pinpadHabilitado === true;
  const pinpadConfigurado = pinpadHabilitado && Boolean(meta || codigo);

  const deteccaoFisica = (meta?.codigo === 'GERTEC_PPC930' || codigo === 'GERTEC_PPC930')
    ? (sdk.gertecPPC930 || sdkDetector.detectarGertecPPC930())
    : null;

  return {
    configurado: meta?.nomeExibicao || meta?.nome || statusConfig?.pinpad?.nomeExibicao || null,
    codigo: meta?.codigo || codigo || null,
    fabricante: meta?.fabricante || config.fabricante || null,
    modelo: meta?.modelo || config.modelo || null,
    middleware: middlewareNome,
    status: resolverStatusPinpadMiddleware(provedor, middlewareInstalado, pinpadConfigurado),
    habilitado: pinpadHabilitado,
    reconhecimentoAutomatico: reconhecimento,
    deteccaoFisica,
    observacao: 'PPC930 e demais PinPads são operados via CliSiTef ou PayGo — CDS não controla hardware diretamente'
  };
}

async function executarDiagnosticoCompleto() {
  const sdk = sdkDetector.diagnosticarCompleto();
  let config = {};
  let statusConfig = null;
  let adapter = null;
  let adapterDiag = null;
  let adapterTeste = null;
  let erroAdapter = null;

  try {
    config = await tefConfigService.obterConfiguracao();
    statusConfig = await tefConfigService.obterStatus();
  } catch (error) {
    config = {};
    statusConfig = { configurado: false, mensagem: error.message };
  }

  const banco = await verificarBanco();
  const configVal = validarConfiguracao(config, statusConfig);

  const provedor = String(config.tefProvedor || '').toLowerCase();
  const ambiente = String(config.tefAmbiente || 'simulacao').toLowerCase();

  try {
    if (statusConfig?.configurado !== false) {
      adapter = await obterAdapter();
      adapterDiag = await adapter.diagnosticar();
      adapterTeste = await adapter.testarConexao();
    }
  } catch (error) {
    erroAdapter = error.message;
  }

  const middlewareSitef = sdk.sitef;
  const middlewarePaygo = sdk.paygo;
  const middlewareInstalado = (
    (provedor === 'sitef' && middlewareSitef.sitefInstalado) ||
    (provedor === 'paygo' && middlewarePaygo.paygoInstalado) ||
    ['stone', 'cielo', 'rede', 'getnet'].includes(provedor)
  );

  const pinpadDiagnostico = montarDiagnosticoPinpad(
    config,
    statusConfig,
    sdk,
    provedor,
    middlewareInstalado
  );

  let pinpadInstancia = null;
  if (pinpadDiagnostico.codigo) {
    try {
      pinpadInstancia = await obterPinpad({
        codigo: pinpadDiagnostico.codigo,
        fabricante: pinpadDiagnostico.fabricante,
        modelo: pinpadDiagnostico.modelo,
        porta_com: config.portaCom,
        ip: config.pinpadIp,
        serial: config.serial
      });
    } catch {
      pinpadInstancia = null;
    }
  }

  const itens = [
    {
      chave: 'adapter_selecionado',
      ok: Boolean(provedor),
      detalhe: provedor || 'não configurado'
    },
    {
      chave: 'middleware_instalado',
      ok: middlewareInstalado,
      detalhe: provedor === 'sitef'
        ? (middlewareSitef.sitefInstalado ? middlewareSitef.caminho : 'CliSiTef não detectado')
        : provedor === 'paygo'
          ? (middlewarePaygo.paygoInstalado ? middlewarePaygo.caminho : 'PayGo não detectado')
          : 'Gateway em modo API/simulação'
    },
    {
      chave: 'dll_encontrada',
      ok: sdk.dllEncontrada || ['stone', 'cielo', 'rede', 'getnet'].includes(provedor),
      detalhe: sdk.caminho || 'N/A para gateway simulado'
    },
    {
      chave: 'ini_configuracao',
      ok: sdk.configuracaoValida || !['sitef', 'paygo'].includes(provedor),
      detalhe: middlewareSitef.ini?.caminho || middlewarePaygo.ini?.caminho || 'sem INI'
    },
    {
      chave: 'pinpad_configurado',
      ok: !statusConfig?.pinpad?.habilitado || (statusConfig?.pinpad?.configurado && Boolean(pinpadDiagnostico.codigo)),
      detalhe: pinpadDiagnostico.configurado || pinpadDiagnostico.codigo || 'não configurado'
    },
    {
      chave: 'pinpad_gertec_ppc930',
      ok: pinpadDiagnostico.codigo !== 'GERTEC_PPC930' || pinpadDiagnostico.habilitado,
      detalhe: pinpadDiagnostico.codigo === 'GERTEC_PPC930'
        ? pinpadDiagnostico.deteccaoFisica
        : 'não selecionado'
    },
    {
      chave: 'banco_acessivel',
      ok: banco.acessivel,
      detalhe: banco.mensagem
    },
    {
      chave: 'configuracao_valida',
      ok: configVal.valida,
      detalhe: configVal.pendencias
    },
    {
      chave: 'ambiente_homologacao',
      ok: ambiente === 'homologacao',
      detalhe: ambiente
    },
    {
      chave: 'ambiente_producao',
      ok: ambiente === 'producao' || ambiente === 'produção',
      detalhe: ambiente
    },
    {
      chave: 'adapter_operacional',
      ok: Boolean(adapter) && !erroAdapter,
      detalhe: erroAdapter || adapter?.nome || 'não carregado'
    }
  ];

  const totalOk = itens.filter((i) => i.ok).length;
  const percentual = Math.round((totalOk / itens.length) * 100);

  return {
    sucesso: percentual >= 70,
    percentualProntidao: percentual,
    timestamp: new Date().toISOString(),
    resumo: {
      provedor,
      ambiente,
      modoAdapter: adapter?.modo || null,
      tefHabilitado: config.tefHabilitado === 'true' || config.tefHabilitado === true,
      pinpad: pinpadDiagnostico.configurado || pinpadDiagnostico.codigo || null
    },
    pinpad: pinpadDiagnostico,
    pinpadAbstracao: pinpadInstancia
      ? await pinpadInstancia.obterInformacoes().catch(() => null)
      : null,
    middleware: sdk,
    configuracao: config,
    statusConfiguracao: statusConfig,
    adapter: {
      nome: adapter?.nome || null,
      modo: adapter?.modo || null,
      diagnostico: adapterDiag,
      testeConexao: adapterTeste,
      erro: erroAdapter
    },
    validacao: configVal,
    banco,
    itens,
    pendencias: [
      ...configVal.pendencias,
      ...(erroAdapter ? [erroAdapter] : []),
      ...(!middlewareInstalado && ['sitef', 'paygo'].includes(provedor)
        ? ['Middleware do cliente não instalado nesta máquina']
        : []),
      ...(adapter?.modo === 'real_pendente_sdk'
        ? ['Estrutura real pronta — falta conectar SDK no adapter']
        : [])
    ]
  };
}

module.exports = {
  executarDiagnosticoCompleto,
  verificarBanco,
  validarConfiguracao
};
