const EventEmitter = require('events');

class TefEvents extends EventEmitter {
  constructor() {
    super();

    /** Estados legados (mantidos para compatibilidade) */
    this.estados = {
      AGUARDANDO_CARTAO: 'AGUARDANDO_CARTAO',
      INSIRA_CARTAO: 'INSIRA_CARTAO',
      APROXIME_CARTAO: 'APROXIME_CARTAO',
      DIGITE_SENHA: 'DIGITE_SENHA',
      PROCESSANDO: 'PROCESSANDO',
      REMOVA_CARTAO: 'REMOVA_CARTAO',
      APROVADO: 'APROVADO',
      NEGADO: 'NEGADO',
      CANCELADO: 'CANCELADO',
      ERRO_COMUNICACAO: 'ERRO_COMUNICACAO'
    };

    /** Estados oficiais PinPad (homologação / frontend futuro) */
    this.estadosPinpad = {
      AGUARDE: 'AGUARDE',
      INSIRA_CARTAO: 'INSIRA_CARTAO',
      DIGITE_SENHA: 'DIGITE_SENHA',
      REMOVA_CARTAO: 'REMOVA_CARTAO',
      PROCESSANDO: 'PROCESSANDO',
      TRANSACAO_APROVADA: 'TRANSACAO_APROVADA',
      TRANSACAO_NEGADA: 'TRANSACAO_NEGADA',
      ERRO_COMUNICACAO: 'ERRO_COMUNICACAO'
    };
  }

  emitirEstado(estado, dados = {}) {
    const payload = { estado, ...dados, timestamp: new Date().toISOString() };
    this.emit('estado', payload);
    this.emit('pinpad', payload);
  }

  emitirEstadoPinpad(estado, dados = {}) {
    const payload = {
      estado,
      origem: 'pinpad',
      ...dados,
      timestamp: new Date().toISOString()
    };
    this.emit('pinpad', payload);
    this.emit('estado', payload);

    const mapaLegado = {
      AGUARDE: this.estados.AGUARDANDO_CARTAO,
      INSIRA_CARTAO: this.estados.INSIRA_CARTAO,
      DIGITE_SENHA: this.estados.DIGITE_SENHA,
      REMOVA_CARTAO: this.estados.REMOVA_CARTAO,
      PROCESSANDO: this.estados.PROCESSANDO,
      TRANSACAO_APROVADA: this.estados.APROVADO,
      TRANSACAO_NEGADA: this.estados.NEGADO
    };
    if (mapaLegado[estado]) {
      this.emit('estado_legado', { estado: mapaLegado[estado], ...payload });
    }
  }

  onEstado(callback) {
    this.on('estado', callback);
  }

  onPinpad(callback) {
    this.on('pinpad', callback);
  }

  emitirErro(erro, dados = {}) {
    this.emit('erro', { erro, ...dados, timestamp: new Date().toISOString() });
  }

  onErro(callback) {
    this.on('erro', callback);
  }

  emitirTransacao(transacao, dados = {}) {
    this.emit('transacao', { transacao, ...dados, timestamp: new Date().toISOString() });
  }

  onTransacao(callback) {
    this.on('transacao', callback);
  }

  emitirPinpadStatus(status, dados = {}) {
    this.emit('pinpad_status', { status, ...dados, timestamp: new Date().toISOString() });
  }

  onPinpadStatus(callback) {
    this.on('pinpad_status', callback);
  }

  emitirServidorStatus(status, dados = {}) {
    this.emit('servidor_status', { status, ...dados, timestamp: new Date().toISOString() });
  }

  onServidorStatus(callback) {
    this.on('servidor_status', callback);
  }

  removerTodosListeners() {
    this.removeAllListeners();
  }
}

const tefEvents = new TefEvents();

module.exports = tefEvents;
