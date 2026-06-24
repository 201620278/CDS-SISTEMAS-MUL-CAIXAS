const BaseAdapter = require('./BaseAdapter');
const tefContrato = require('../tefContrato');
const tefEvents = require('../tefEvents');

/**
 * Adapter base para gateways simulados (Stone, Cielo, Rede, Getnet).
 */
class SimulatedGatewayAdapter extends BaseAdapter {
  constructor(config, { nome, adquirente, bandeiraPadrao = 'VISA' } = {}) {
    super(config);
    this.nome = nome;
    this.adquirente = adquirente || nome;
    this.bandeiraPadrao = bandeiraPadrao;
    this.modo = 'simulacao';
  }

  async autorizarPagamento(dados) {
    const tipoNorm = String(dados.tipo || '').toLowerCase().trim();
    const ehPix = tipoNorm === 'pix' || tipoNorm === 'pix_tef';

    if (ehPix) {
      this.emitirEventoPinpad(tefEvents.estadosPinpad.PROCESSANDO);
    } else {
      this.emitirEventoPinpad(tefEvents.estadosPinpad.INSIRA_CARTAO);
      await this._aguardar(400);
      this.emitirEventoPinpad(tefEvents.estadosPinpad.PROCESSANDO);
    }

    const aprovado = true;
    const agora = Date.now();
    const nsu = `NSU${agora}`;
    const autorizacao = `AUT${String(agora).slice(-6)}`;
    const valor = Number(dados.valor || 0).toFixed(2);
    const bandeira = ehPix ? 'PIX' : this.bandeiraPadrao;
    const pixCopiaCola = ehPix
      ? `00020126580014br.gov.bcb.pix0136${agora}520400005303986540${valor}5802BR5925CDS SISTEMAS TEF SIM6009SAO PAULO62070503***6304ABCD`
      : null;

    if (!aprovado) {
      this.emitirEventoPinpad(tefEvents.estadosPinpad.TRANSACAO_NEGADA);
      return tefContrato.criarRespostaAutorizacao({
        sucesso: false,
        status: tefContrato.STATUS.NEGADO,
        adquirente: this.adquirente,
        bandeira,
        mensagem: 'Pagamento negado pelo TEF',
        modo: this.modo
      });
    }

    this.emitirEventoPinpad(tefEvents.estadosPinpad.TRANSACAO_APROVADA);

    return tefContrato.criarRespostaAutorizacao({
      sucesso: true,
      status: tefContrato.STATUS.APROVADO,
      adquirente: this.adquirente,
      bandeira,
      nsu,
      autorizacao,
      transacaoId: `TEF${agora}`,
      comprovanteCliente: ehPix
        ? `PIX TEF - CLIENTE\nVALOR: R$ ${valor}\nNSU: ${nsu}\nAUT: ${autorizacao}`
        : `COMPROVANTE CLIENTE\nADQUIRENTE: ${this.adquirente}\nVALOR: R$ ${valor}\nNSU: ${nsu}\nAUT: ${autorizacao}`,
      comprovanteLoja: ehPix
        ? `PIX TEF - LOJA\nVALOR: R$ ${valor}\nNSU: ${nsu}\nAUT: ${autorizacao}`
        : `COMPROVANTE LOJA\nADQUIRENTE: ${this.adquirente}\nVALOR: R$ ${valor}\nNSU: ${nsu}\nAUT: ${autorizacao}`,
      mensagem: ehPix ? 'PIX TEF aprovado (simulação)' : 'Pagamento aprovado (simulação)',
      payloadRetorno: {
        ambiente: 'simulacao',
        tipo: dados.tipo,
        valor: dados.valor,
        exibir_qr_tela: ehPix,
        pix_copia_cola: pixCopiaCola,
        pix_qr_texto: pixCopiaCola
      },
      modo: this.modo
    });
  }

  async cancelarPagamento(dados) {
    const info = this._normalizarDadosCancelamento(dados);
    await this._aguardar(300);

    return tefContrato.criarRespostaCancelamento({
      sucesso: true,
      status: tefContrato.STATUS.CANCELADO,
      nsu: info.nsu,
      autorizacao: info.autorizacao,
      transacaoId: info.transacao_id,
      mensagem: 'Transação TEF cancelada com sucesso (simulação)',
      payloadRetorno: {
        ambiente: 'simulacao',
        transacao_id: info.transacao_id,
        motivo: info.motivo
      },
      modo: this.modo
    });
  }

  async consultarTransacao(transacaoId) {
    const db = require('../../../database');
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM tef_transacoes WHERE id = ?', [transacaoId], (err, r) => {
        if (err) return reject(err);
        resolve(r || null);
      });
    });

    if (!row) {
      return tefContrato.criarRespostaConsulta({
        sucesso: false,
        suportado: true,
        transacaoId,
        mensagem: 'Transação não encontrada no banco local',
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
      mensagem: 'Consulta local (simulador — sem consulta ao adquirente)',
      dados: {
        venda_id: row.venda_id,
        valor: row.valor,
        provedor: row.provedor,
        adquirente: row.adquirente
      },
      modo: this.modo
    });
  }

  async reimprimirComprovante(transacaoId, tipo = 'cliente') {
    const db = require('../../../database');
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM tef_transacoes WHERE id = ?', [transacaoId], (err, r) => {
        if (err) return reject(err);
        resolve(r || null);
      });
    });

    if (!row) {
      return tefContrato.criarRespostaReimpressao({
        sucesso: false,
        suportado: true,
        tipo,
        mensagem: 'Transação não encontrada',
        modo: this.modo
      });
    }

    const comprovante = tipo === 'loja'
      ? row.comprovante_estabelecimento
      : row.comprovante_cliente;

    return tefContrato.criarRespostaReimpressao({
      sucesso: Boolean(comprovante),
      suportado: true,
      tipo,
      comprovante,
      mensagem: comprovante ? 'Comprovante disponível (simulação)' : 'Comprovante não disponível',
      modo: this.modo
    });
  }

  async diagnosticar() {
    return tefContrato.criarRespostaDiagnostico({
      sucesso: true,
      mensagem: `Adapter ${this.nome} em modo simulação`,
      detalhes: {
        provedor: this.nome,
        modo: this.modo,
        middlewareInstalado: false,
        dllEncontrada: false,
        configuracaoValida: Boolean(this.config?.provedor || this.nome)
      }
    });
  }

  async testarConexao() {
    return this.diagnosticar();
  }

  _aguardar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = SimulatedGatewayAdapter;
