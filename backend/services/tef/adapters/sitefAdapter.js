const BaseAdapter = require('./BaseAdapter');
const tefContrato = require('../tefContrato');
const sdkDetector = require('../sdkDetector');
const fs = require('fs');
const path = require('path');

/**
 * Adapter CliSiTef simulado — para desenvolvimento e ambiente simulacao.
 * Em homologação/produção com DLL, o tefFactory usa sitefRealAdapter.
 */
class SitefAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this.nome = 'CliSiTef';
    this.modo = 'simulacao';
    this.sdkEncontrado = false;
    this.configuracaoIni = null;
    this.inicializado = false;
    this._carregarDeteccao();
  }

  _carregarDeteccao() {
    const det = sdkDetector.detectarSitef();
    if (det.dllEncontrada) {
      this.sdkEncontrado = true;
      this.sdkCaminho = det.caminho;
      this._lerIni(det);
    }
  }

  _lerIni(det) {
    try {
      const iniPath = det.ini?.caminho;
      if (iniPath && fs.existsSync(iniPath)) {
        this.configuracaoIni = this._parseConfig(fs.readFileSync(iniPath, 'utf8'));
      }
    } catch (error) {
      console.error('Erro ao ler clisitef.ini:', error);
    }
  }

  _parseConfig(config) {
    const configObj = {};
    let secaoAtual = '';
    String(config).split('\n').forEach((linha) => {
      linha = linha.trim();
      if (!linha || linha.startsWith(';')) return;
      if (linha.startsWith('[') && linha.endsWith(']')) {
        secaoAtual = linha.substring(1, linha.length - 1);
        configObj[secaoAtual] = {};
      } else if (linha.includes('=')) {
        const [chave, valor] = linha.split('=');
        if (secaoAtual) configObj[secaoAtual][chave.trim()] = valor.trim();
      }
    });
    return configObj;
  }

  async inicializar() {
    this.inicializado = true;
    return true;
  }

  async autorizarPagamento(dados) {
    await this.inicializar();

    this.emitirEventoPinpad(require('../tefEvents').estadosPinpad.AGUARDE);
    await this._aguardar(300);
    this.emitirEventoPinpad(require('../tefEvents').estadosPinpad.INSIRA_CARTAO);
    await this._aguardar(500);
    this.emitirEventoPinpad(require('../tefEvents').estadosPinpad.PROCESSANDO);

    const tipoOperacao = this._mapearTipoOperacao(dados.tipo, dados.parcelas);
    const valorCentavos = this._formatarValorCentavos(dados.valor);
    const dataHora = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const resultado = await this._executarTransacaoSiTef({
      valor: valorCentavos,
      tipoOperacao,
      parcelas: dados.parcelas || 1,
      dataHora,
      terminal: this.configuracaoIni?.Terminal?.CodigoTerminal || this.config.terminal_codigo || '001'
    });

    if (resultado.status === tefContrato.STATUS.APROVADO) {
      this.emitirEventoPinpad(require('../tefEvents').estadosPinpad.TRANSACAO_APROVADA);
    } else {
      this.emitirEventoPinpad(require('../tefEvents').estadosPinpad.TRANSACAO_NEGADA);
    }

    return tefContrato.criarRespostaAutorizacao({
      sucesso: resultado.status === tefContrato.STATUS.APROVADO,
      status: resultado.status,
      adquirente: resultado.adquirente || 'SiTef',
      bandeira: resultado.bandeira,
      nsu: resultado.nsu,
      autorizacao: resultado.autorizacao,
      transacaoId: resultado.codigoTransacao,
      comprovanteCliente: resultado.comprovanteCliente,
      comprovanteLoja: resultado.comprovanteEstabelecimento,
      mensagem: resultado.mensagem,
      payloadRetorno: { ...resultado, sdkDetectado: this.sdkEncontrado },
      modo: this.modo
    });
  }

  async cancelarPagamento(dados) {
    const info = this._normalizarDadosCancelamento(dados);
    let transacao = null;

    if (info.transacao_id) {
      transacao = await this._buscarTransacao(info.transacao_id);
    }

    const nsu = info.nsu || transacao?.nsu;
    const autorizacao = info.autorizacao || transacao?.autorizacao;

    const resultado = await this._executarCancelamentoSiTef({
      nsu,
      autorizacao,
      valor: transacao?.valor,
      dataHora: new Date().toISOString().replace('T', ' ').substring(0, 19)
    });

    return tefContrato.criarRespostaCancelamento({
      sucesso: resultado.status === tefContrato.STATUS.CANCELADO,
      status: resultado.status,
      nsu: resultado.nsu,
      autorizacao: resultado.autorizacao,
      transacaoId: info.transacao_id,
      mensagem: resultado.mensagem,
      payloadRetorno: resultado,
      modo: this.modo
    });
  }

  async consultarTransacao(transacaoId) {
    const row = await this._buscarTransacao(transacaoId);
    if (!row) {
      return tefContrato.criarRespostaConsulta({
        sucesso: false,
        suportado: true,
        transacaoId,
        mensagem: 'Transação não encontrada',
        modo: this.modo
      });
    }

    return tefContrato.criarRespostaConsulta({
      sucesso: true,
      suportado: true,
      status: row.status,
      nsu: row.nsu,
      autorizacao: row.autorizacao,
      transacaoId: row.id,
      mensagem: 'Consulta local (simulador CliSiTef)',
      dados: row,
      modo: this.modo
    });
  }

  async reimprimirComprovante(transacaoId, tipo = 'cliente') {
    const row = await this._buscarTransacao(transacaoId);
    if (!row) {
      return tefContrato.criarRespostaReimpressao({
        sucesso: false,
        suportado: true,
        tipo,
        mensagem: 'Transação não encontrada',
        modo: this.modo
      });
    }

    const comprovante = tipo === 'loja' ? row.comprovante_estabelecimento : row.comprovante_cliente;
    return tefContrato.criarRespostaReimpressao({
      sucesso: Boolean(comprovante),
      suportado: true,
      tipo,
      comprovante,
      mensagem: comprovante ? 'Comprovante disponível' : 'Comprovante não disponível',
      modo: this.modo
    });
  }

  async diagnosticar() {
    const det = sdkDetector.detectarSitef();
    return tefContrato.criarRespostaDiagnostico({
      sucesso: true,
      mensagem: 'Adapter CliSiTef em modo simulação',
      detalhes: {
        provedor: 'sitef',
        modo: this.modo,
        sitefInstalado: det.sitefInstalado,
        dllEncontrada: det.dllEncontrada,
        caminho: det.caminho,
        configuracaoValida: det.configuracaoValida,
        sdkDetectado: this.sdkEncontrado
      }
    });
  }

  async testarConexao() {
    return this.diagnosticar();
  }

  async _executarTransacaoSiTef(dados) {
    // Simulação — substituída por sitefRealAdapter em homologação/produção
    await this._aguardar(1200);

    const nsu = this._gerarNSU();
    const autorizacao = this._gerarAutorizacao();

    return {
      status: tefContrato.STATUS.APROVADO,
      adquirente: 'SiTef',
      bandeira: 'Visa',
      nsu,
      autorizacao,
      codigoTransacao: String(Date.now()),
      comprovanteCliente: this._gerarComprovante(dados, nsu, autorizacao, 'CLIENTE'),
      comprovanteEstabelecimento: this._gerarComprovante(dados, nsu, autorizacao, 'LOJA'),
      mensagem: this.sdkEncontrado
        ? 'Transação aprovada (simulação — DLL detectada, SDK não conectado)'
        : 'Transação aprovada (simulação — DLL não detectada)'
    };
  }

  async _executarCancelamentoSiTef(dados) {
    await this._aguardar(800);
    return {
      status: tefContrato.STATUS.CANCELADO,
      nsu: dados.nsu,
      autorizacao: dados.autorizacao,
      mensagem: 'Cancelamento realizado (simulação)'
    };
  }

  async _buscarTransacao(transacaoId) {
    const db = require('../../../database');
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT id, nsu, autorizacao, valor, status, comprovante_cliente, comprovante_estabelecimento FROM tef_transacoes WHERE id = ?',
        [transacaoId],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });
  }

  _mapearTipoOperacao(tipo, parcelas) {
    const t = String(tipo || '').toLowerCase();
    if (t.includes('debito')) return '10';
    if (t.includes('credito')) return parcelas > 1 ? '12' : '11';
    return '10';
  }

  _gerarNSU() {
    return Date.now().toString().substring(8) + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  }

  _gerarAutorizacao() {
    return Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  }

  _gerarComprovante(dados, nsu, autorizacao, tipo) {
    const valor = (Number(dados.valor) / 100).toFixed(2);
    return `COMPROVANTE ${tipo}\nDATA: ${dados.dataHora}\nVALOR: R$ ${valor}\nNSU: ${nsu}\nAUT: ${autorizacao}`;
  }

  _aguardar(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = SitefAdapter;
