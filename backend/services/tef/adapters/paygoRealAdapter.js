const BaseAdapter = require('./BaseAdapter');
const tefContrato = require('../tefContrato');
const sdkDetector = require('../sdkDetector');

/**
 * Adapter PayGo — estrutura pronta para ligação do middleware.
 * NÃO chama o SDK real: apenas define os pontos de integração.
 *
 * Conectar middleware em:
 *  - inicializar()  → carga da DLL / serviço PayGo
 *  - autorizar()    → PGO_IniciaFuncao + loop
 *  - cancelar()     → cancelamento PayGo
 *  - consultar()    → consulta de status
 *  - reimprimir()   → reimpressão de comprovante
 */
class PaygoRealAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this.nome = 'PayGo';
    this.modo = 'real_pendente_sdk';
    this.paygoInicializado = false;
    this.paygo = null;
    this._deteccao = sdkDetector.detectarPaygo();
  }

  async inicializar() {
    if (!this._deteccao.dllEncontrada) {
      return {
        sucesso: false,
        mensagem: 'DLL PayGo não encontrada no sistema',
        caminho: null
      };
    }

    // TODO SDK: const ffi = require('ffi-napi');
    // TODO SDK: this.paygo = ffi.Library(this._deteccao.caminho, { ... });
    // TODO SDK: this.paygoInicializado = true;

    return {
      sucesso: false,
      mensagem: 'Ponto de integração inicializar() — aguardando middleware PayGo',
      caminho: this._deteccao.caminho,
      paygoInicializado: this.paygoInicializado
    };
  }

  async autorizar(dados) {
    this.emitirEventoPinpad(require('../tefEvents').estadosPinpad.INSIRA_CARTAO);

    // TODO SDK: PGO_VerificaPinPad + PGO_IniciaFuncao + PGO_ContinuaFuncao
    void dados;

    return {
      sucesso: false,
      mensagem: 'Ponto de integração autorizar() — aguardando SDK PayGo'
    };
  }

  async cancelar(dados) {
    // TODO SDK: cancelamento via PayGo
    void dados;

    return {
      sucesso: false,
      mensagem: 'Ponto de integração cancelar() — aguardando SDK PayGo'
    };
  }

  async consultar(transacaoId) {
    // TODO SDK: consulta PayGo
    void transacaoId;

    return {
      sucesso: false,
      mensagem: 'Ponto de integração consultar() — aguardando SDK PayGo'
    };
  }

  async reimprimir(transacaoId, tipo = 'cliente') {
    // TODO SDK: reimpressão PayGo
    void transacaoId;
    void tipo;

    return {
      sucesso: false,
      mensagem: 'Ponto de integração reimprimir() — aguardando SDK PayGo'
    };
  }

  // ─── Interface oficial ───────────────────────────────────────────────────

  async autorizarPagamento(dados) {
    this.emitirEventoPinpad(require('../tefEvents').estadosPinpad.AGUARDE);

    const init = await this.inicializar();
    if (!init.sucesso && !this.paygoInicializado) {
      return tefContrato.criarRespostaAutorizacao({
        sucesso: false,
        status: tefContrato.STATUS.ERRO,
        adquirente: 'PayGo',
        codigo: 'SDK_NAO_CONECTADO',
        mensagem: init.mensagem || 'PayGo não inicializado — conecte o SDK em paygoRealAdapter.js',
        modo: this.modo
      });
    }

    await this.autorizar(dados);

    return tefContrato.criarRespostaAutorizacao({
      sucesso: false,
      status: tefContrato.STATUS.ERRO,
      adquirente: 'PayGo',
      codigo: 'SDK_PENDENTE',
      mensagem: 'Estrutura PayGo pronta — aguardando ligação do middleware',
      modo: this.modo
    });
  }

  async cancelarPagamento(dados) {
    const info = this._normalizarDadosCancelamento(dados);
    const resultado = await this.cancelar(info);

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
    const r = await this.consultar(transacaoId);
    return tefContrato.criarRespostaConsulta({
      sucesso: false,
      suportado: true,
      transacaoId,
      mensagem: r.mensagem,
      modo: this.modo
    });
  }

  async reimprimirComprovante(transacaoId, tipo = 'cliente') {
    const r = await this.reimprimir(transacaoId, tipo);
    return tefContrato.criarRespostaReimpressao({
      sucesso: false,
      suportado: true,
      tipo,
      mensagem: r.mensagem,
      modo: this.modo
    });
  }

  async diagnosticar() {
    return tefContrato.criarRespostaDiagnostico({
      sucesso: this._deteccao.dllEncontrada,
      mensagem: this._deteccao.dllEncontrada
        ? 'DLL PayGo detectada — SDK ainda não conectado no código'
        : 'DLL PayGo não encontrada',
      detalhes: {
        provedor: 'paygo',
        modo: this.modo,
        paygoInstalado: this._deteccao.paygoInstalado,
        dllEncontrada: this._deteccao.dllEncontrada,
        caminho: this._deteccao.caminho,
        configuracaoValida: this._deteccao.configuracaoValida,
        servicosWindows: this._deteccao.servicosWindows,
        paygoInicializado: this.paygoInicializado
      }
    });
  }

  async testarConexao() {
    const init = await this.inicializar();
    const diag = await this.diagnosticar();

    return tefContrato.criarRespostaDiagnostico({
      sucesso: diag.sucesso && init.sucesso,
      mensagem: 'Teste PayGo — estrutura pronta; ligação SDK pendente',
      detalhes: { diagnostico: diag.detalhes, inicializar: init }
    });
  }

  static podeUsarModoReal() {
    return sdkDetector.detectarPaygo().dllEncontrada;
  }

  /**
   * FASE 7 — Gertec PPC930
   * O CDS NÃO controla o PinPad diretamente.
   * Identifica GERTEC_PPC930 (ou outro) e repassa ao PayGo na integração SDK.
   */
  identificarPinPadSelecionado() {
    const pinpadCatalog = require('../pinpads/pinpadCatalog');
    const meta = pinpadCatalog.resolver(this.config);
    return {
      pinpadCodigo: meta?.codigo || this.config.pinpadCodigo || this.config.codigo || null,
      pinpadNome: meta?.nomeExibicao || meta?.nome || null,
      controleViaMiddleware: true,
      middleware: 'PayGo',
      mensagem: 'PinPad será operado pelo PayGo — não pelo CDS diretamente'
    };
  }
}

module.exports = PaygoRealAdapter;
