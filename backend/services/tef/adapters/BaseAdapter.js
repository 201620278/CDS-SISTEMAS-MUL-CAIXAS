const tefContrato = require('../tefContrato');
const tefEvents = require('../tefEvents');

/**
 * Interface oficial dos adapters TEF.
 * Todos os provedores devem estender esta classe.
 */
class BaseAdapter {
  constructor(config = {}) {
    this.config = config || {};
    this.nome = 'base';
    this.modo = 'simulacao';
  }

  async autorizarPagamento(dados) {
    throw new Error(`autorizarPagamento não implementado em ${this.nome}`);
  }

  async cancelarPagamento(dados) {
    throw new Error(`cancelarPagamento não implementado em ${this.nome}`);
  }

  async consultarTransacao(transacaoId) {
    return tefContrato.criarRespostaConsulta({
      sucesso: false,
      suportado: false,
      status: tefContrato.STATUS.PENDENTE,
      transacaoId,
      mensagem: `Consulta não implementada para ${this.nome}`,
      modo: this.modo
    });
  }

  async reimprimirComprovante(transacaoId, tipo = 'cliente') {
    return tefContrato.criarRespostaReimpressao({
      sucesso: false,
      suportado: false,
      tipo,
      mensagem: `Reimpressão não implementada para ${this.nome}`,
      modo: this.modo
    });
  }

  async diagnosticar() {
    return tefContrato.criarRespostaDiagnostico({
      sucesso: false,
      mensagem: `Diagnóstico não implementado para ${this.nome}`,
      detalhes: { provedor: this.nome, modo: this.modo }
    });
  }

  async testarConexao() {
    return tefContrato.criarRespostaDiagnostico({
      sucesso: false,
      mensagem: `Teste de conexão não implementado para ${this.nome}`,
      detalhes: { provedor: this.nome, modo: this.modo }
    });
  }

  async status() {
    const diag = await this.diagnosticar();
    return {
      ativo: diag.sucesso === true,
      provedor: this.nome,
      modo: this.modo,
      ...diag.detalhes
    };
  }

  emitirEventoPinpad(estado, dados = {}) {
    tefEvents.emitirEstadoPinpad(estado, {
      provedor: this.nome,
      ...dados
    });
  }

  _normalizarDadosCancelamento(dados) {
    if (dados && typeof dados === 'object' && !Array.isArray(dados)) {
      return {
        transacao_id: dados.transacao_id || dados.transacaoId || null,
        nsu: dados.nsu || null,
        autorizacao: dados.autorizacao || null,
        motivo: dados.motivo || 'Cancelamento'
      };
    }
    return {
      transacao_id: dados,
      nsu: null,
      autorizacao: null,
      motivo: 'Cancelamento'
    };
  }

  _formatarValorCentavos(valor) {
    return Math.round(Number(valor) * 100).toString().padStart(10, '0');
  }
}

module.exports = BaseAdapter;
