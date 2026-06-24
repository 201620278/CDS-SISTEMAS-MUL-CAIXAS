const BasePinpad = require('./BasePinpad');
const pinpadCatalog = require('./pinpadCatalog');

/**
 * Gertec PPC930 — abstração estrutural (sem comunicação com hardware).
 *
 * IMPORTANTE — FASE 7 / CliSiTef & PayGo:
 * A PPC930 NÃO é controlada diretamente pelo CDS.
 * O middleware TEF (CliSiTef ou PayGo) gerencia o equipamento.
 * Este módulo apenas identifica o PinPad selecionado (GERTEC_PPC930)
 * para que os adapters reais repassem o controle ao SDK.
 */
class GertecPPC930 extends BasePinpad {
  constructor(config = {}) {
    super(config);
    const meta = pinpadCatalog.MODELOS.GERTEC_PPC930;
    this.codigo = meta.codigo;
    this.fabricante = meta.fabricante;
    this.modelo = meta.modelo;
    this.nomeExibicao = meta.nomeExibicao;
    this.adquirenteSugerido = meta.adquirenteSugerido;
    this.controleViaMiddleware = true;
  }

  async conectar() {
    return {
      conectado: false,
      codigo: this.codigo,
      modelo: this.nomeExibicao,
      mensagem: 'PPC930 aguardando middleware TEF (CliSiTef/PayGo) — sem conexão direta CDS',
      middleware: this._middlewareEsperado()
    };
  }

  async desconectar() {
    return {
      desconectado: true,
      codigo: this.codigo,
      mensagem: 'Desconexão lógica PPC930 (hardware controlado pelo middleware)'
    };
  }

  async diagnosticar() {
    const sdkDetector = require('../sdkDetector');
    const deteccao = sdkDetector.detectarGertecPPC930();

    return {
      sucesso: true,
      codigo: this.codigo,
      modelo: this.nomeExibicao,
      fabricante: this.fabricante,
      detectadoFisicamente: deteccao.detectado,
      deteccao,
      controleViaMiddleware: true,
      middleware: this._middlewareEsperado(),
      mensagem: deteccao.detectado
        ? 'PPC930 detectada no sistema — aguardando middleware para operação'
        : 'PPC930 configurada — driver/porta não detectados (normal sem hardware conectado)'
    };
  }

  async obterInformacoes() {
    const diag = await this.diagnosticar();
    return {
      codigo: this.codigo,
      nome: this.nomeExibicao,
      fabricante: this.fabricante,
      modelo: this.modelo,
      adquirenteSugerido: this.adquirenteSugerido,
      tipoConexao: this.config.tipo_conexao || this.config.tipoConexao || null,
      portaCom: this.config.porta_com || this.config.portaCom || null,
      ip: this.config.ip || this.config.pinpadIp || null,
      serial: this.config.serial || null,
      controleViaMiddleware: true,
      observacao: 'Equipamento operado exclusivamente via CliSiTef ou PayGo',
      diagnostico: diag
    };
  }

  async status() {
    const diag = await this.diagnosticar();
    return {
      online: false,
      codigo: this.codigo,
      fabricante: this.fabricante,
      modelo: this.modelo,
      nomeExibicao: this.nomeExibicao,
      porta: this.config.porta_com || this.config.ip || diag.deteccao?.porta || null,
      detectado: diag.deteccao?.detectado || false,
      ultima_verificacao: new Date().toISOString(),
      aguardandoMiddleware: true
    };
  }

  _middlewareEsperado() {
    return {
      responsavel: 'CliSiTef ou PayGo',
      cdsControlaHardware: false,
      pinpadCodigo: this.codigo
    };
  }
}

module.exports = GertecPPC930;
