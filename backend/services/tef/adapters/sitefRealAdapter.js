const BaseAdapter = require('./BaseAdapter');
const tefContrato = require('../tefContrato');
const sdkDetector = require('../sdkDetector');
const fs = require('fs');
const path = require('path');

/**
 * Adapter CliSiTef — estrutura pronta para ligação da DLL.
 * NÃO chama o SDK real: apenas define os pontos de integração.
 *
 * Conectar SDK em:
 *  - carregarDLL()           → ffi-napi / wrapper oficial
 *  - inicializarSitef()      → ConfiguraIntegracao
 *  - iniciarTransacao()      → IniciaFuncaoSiTefInterativo
 *  - continuarTransacao()    → ContinuaFuncaoSiTefInterativo
 *  - finalizarTransacao()    → FinalizaFuncaoSiTefInterativo
 *  - cancelarTransacao()     → função de cancelamento SiTef
 */
class SitefRealAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this.nome = 'CliSiTef';
    this.modo = 'real_pendente_sdk';
    this.dllCarregada = false;
    this.sitefInicializado = false;
    this.clisitef = null;
    this._deteccao = sdkDetector.detectarSitef();
  }

  // ─── Pontos de integração DLL (conectar SDK aqui) ───────────────────────

  async carregarDLL() {
    if (!this._deteccao.dllEncontrada) {
      return {
        sucesso: false,
        mensagem: 'DLL CliSiTef não encontrada no sistema',
        caminho: null
      };
    }

    // TODO SDK: const ffi = require('ffi-napi');
    // TODO SDK: this.clisitef = ffi.Library(this._deteccao.caminho, { ... });
    // TODO SDK: this.dllCarregada = true;

    return {
      sucesso: false,
      mensagem: 'Ponto de integração carregarDLL() — aguardando ffi-napi e definições da Software Express',
      caminho: this._deteccao.caminho,
      dllCarregada: this.dllCarregada
    };
  }

  async inicializarSitef() {
    const dll = await this.carregarDLL();
    if (!dll.sucesso && !this.dllCarregada) {
      return dll;
    }

    const terminal = this.config.terminal_codigo || this.config.terminalCodigo || '';
    const loja = this.config.loja_codigo || this.config.lojaCodigo || '';
    const empresa = this.config.empresa_codigo || this.config.empresaCodigo || '';

    // TODO SDK: resultado = clisitef.ConfiguraIntegracao(terminal, loja, empresa, parametros, rede);
    void terminal;
    void loja;
    void empresa;

    this.sitefInicializado = false;

    return {
      sucesso: false,
      mensagem: 'Ponto de integração inicializarSitef() — aguardando credenciais e IP do servidor TEF',
      sitefInicializado: this.sitefInicializado
    };
  }

  async iniciarTransacao(dados) {
    this.emitirEventoPinpad(require('../tefEvents').estadosPinpad.INSIRA_CARTAO);

    // TODO SDK: buffer + IniciaFuncaoSiTefInterativo(funcao, valorFormatado, buffer)
    void dados;

    return {
      sucesso: false,
      mensagem: 'Ponto de integração iniciarTransacao() — aguardando SDK',
      codigoRetorno: null
    };
  }

  async continuarTransacao(contexto) {
    this.emitirEventoPinpad(require('../tefEvents').estadosPinpad.PROCESSANDO);

    // TODO SDK: ContinuaFuncaoSiTefInterativo — loop até conclusão ou solicitação de senha
    // TODO SDK: mapear comandos do PinPad → emitirEventoPinpad(DIGITE_SENHA | REMOVA_CARTAO)
    void contexto;

    return {
      sucesso: false,
      mensagem: 'Ponto de integração continuarTransacao() — aguardando SDK',
      proximoComando: null
    };
  }

  async finalizarTransacao(contexto) {
    // TODO SDK: FinalizaFuncaoSiTefInterativo
    void contexto;

    return {
      sucesso: false,
      mensagem: 'Ponto de integração finalizarTransacao() — aguardando SDK'
    };
  }

  async cancelarTransacao(dados) {
    // TODO SDK: função de cancelamento via CliSiTef
    void dados;

    return {
      sucesso: false,
      mensagem: 'Ponto de integração cancelarTransacao() — aguardando SDK'
    };
  }

  // ─── Interface oficial ───────────────────────────────────────────────────

  async autorizarPagamento(dados) {
    this.emitirEventoPinpad(require('../tefEvents').estadosPinpad.AGUARDE);

    const init = await this.inicializarSitef();
    if (!init.sucesso && !this.sitefInicializado) {
      return tefContrato.criarRespostaAutorizacao({
        sucesso: false,
        status: tefContrato.STATUS.ERRO,
        adquirente: 'SiTef',
        codigo: 'SDK_NAO_CONECTADO',
        mensagem: init.mensagem || 'CliSiTef não inicializado — conecte o SDK em sitefRealAdapter.js',
        modo: this.modo
      });
    }

    await this.iniciarTransacao(dados);
    await this.continuarTransacao({ dados });
    await this.finalizarTransacao({ dados });

    return tefContrato.criarRespostaAutorizacao({
      sucesso: false,
      status: tefContrato.STATUS.ERRO,
      adquirente: 'SiTef',
      codigo: 'SDK_PENDENTE',
      mensagem: 'Estrutura CliSiTef pronta — aguardando ligação da DLL',
      modo: this.modo
    });
  }

  async cancelarPagamento(dados) {
    const info = this._normalizarDadosCancelamento(dados);
    const resultado = await this.cancelarTransacao(info);

    return tefContrato.criarRespostaCancelamento({
      sucesso: false,
      status: tefContrato.STATUS.ERRO,
      nsu: info.nsu,
      autorizacao: info.autorizacao,
      transacaoId: info.transacao_id,
      codigo: 'SDK_PENDENTE',
      mensagem: resultado.mensagem,
      modo: this.modo
    });
  }

  async consultarTransacao(transacaoId) {
    return tefContrato.criarRespostaConsulta({
      sucesso: false,
      suportado: true,
      transacaoId,
      mensagem: 'Consulta CliSiTef — aguardando SDK (ContinuaFuncao/consulta)',
      modo: this.modo
    });
  }

  async reimprimirComprovante(transacaoId, tipo = 'cliente') {
    return tefContrato.criarRespostaReimpressao({
      sucesso: false,
      suportado: true,
      tipo,
      mensagem: 'Reimpressão CliSiTef — aguardando SDK',
      modo: this.modo
    });
  }

  async diagnosticar() {
    const iniPath = this._deteccao.ini?.caminho;
    let iniResumo = null;
    if (iniPath && fs.existsSync(iniPath)) {
      iniResumo = path.basename(iniPath);
    }

    return tefContrato.criarRespostaDiagnostico({
      sucesso: this._deteccao.dllEncontrada,
      mensagem: this._deteccao.dllEncontrada
        ? 'DLL CliSiTef detectada — SDK ainda não conectado no código'
        : 'DLL CliSiTef não encontrada',
      detalhes: {
        provedor: 'sitef',
        modo: this.modo,
        sitefInstalado: this._deteccao.sitefInstalado,
        dllEncontrada: this._deteccao.dllEncontrada,
        caminho: this._deteccao.caminho,
        configuracaoValida: this._deteccao.configuracaoValida,
        ini: iniResumo,
        servicosWindows: this._deteccao.servicosWindows,
        dllCarregada: this.dllCarregada,
        sitefInicializado: this.sitefInicializado
      }
    });
  }

  async testarConexao() {
    const diag = await this.diagnosticar();
    const carregar = await this.carregarDLL();
    const init = await this.inicializarSitef();

    return tefContrato.criarRespostaDiagnostico({
      sucesso: diag.sucesso && carregar.sucesso && init.sucesso,
      mensagem: 'Teste CliSiTef — estrutura pronta; ligação SDK pendente',
      detalhes: {
        diagnostico: diag.detalhes,
        carregarDLL: carregar,
        inicializarSitef: init
      }
    });
  }

  static podeUsarModoReal() {
    return sdkDetector.detectarSitef().dllEncontrada;
  }

  /**
   * FASE 7 — Gertec PPC930
   * O CDS NÃO controla o PinPad diretamente.
   * Identifica GERTEC_PPC930 (ou outro) e repassa ao CliSiTef na integração SDK.
   */
  identificarPinPadSelecionado() {
    const pinpadCatalog = require('../pinpads/pinpadCatalog');
    const meta = pinpadCatalog.resolver(this.config);
    return {
      pinpadCodigo: meta?.codigo || this.config.pinpadCodigo || this.config.codigo || null,
      pinpadNome: meta?.nomeExibicao || meta?.nome || null,
      controleViaMiddleware: true,
      middleware: 'CliSiTef',
      mensagem: 'PinPad será operado pelo CliSiTef — não pelo CDS diretamente'
    };
  }
}

module.exports = SitefRealAdapter;
