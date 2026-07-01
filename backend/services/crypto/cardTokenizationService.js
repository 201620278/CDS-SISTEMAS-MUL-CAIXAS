const cryptoService = require('./cryptoService');
const db = require('../../database');

/**
 * Serviço de tokenização de dados de cartão
 * Conforme PCI-DSS 3.2.1 — não armazena CVV/PIN
 */
class CardTokenizationService {

  constructor() {
    this.tokenStore = new Map();
  }

  /**
   * Tokeniza dados de cartão (CVV é usado apenas na validação, nunca persistido)
   */
  async tokenizar(dadosCartao) {
    try {
      this._validarDadosCartao(dadosCartao);

      const token = this._gerarToken();

      const dadosCriptografados = {
        numero: cryptoService.criptografar(dadosCartao.numero),
        validade: cryptoService.criptografar(dadosCartao.validade),
        bandeira: dadosCartao.bandeira || 'desconhecida',
        nome_portador: dadosCartao.nome_portador ? cryptoService.criptografar(dadosCartao.nome_portador) : null
      };

      this.tokenStore.set(token, dadosCriptografados);
      await this._persistirToken(token, dadosCriptografados);

      return token;
    } catch (error) {
      console.error('Erro ao tokenizar cartão:', error);
      throw new Error('Falha na tokenização do cartão');
    }
  }

  /**
   * Detokeniza um token (sem CVV — PCI-DSS proíbe armazenamento)
   */
  async detokenizar(token) {
    try {
      const dadosCriptografados = await this._buscarToken(token);

      if (!dadosCriptografados) {
        throw new Error('Token não encontrado');
      }

      return {
        numero: cryptoService.descriptografar(dadosCriptografados.numero),
        validade: cryptoService.descriptografar(dadosCriptografados.validade),
        bandeira: dadosCriptografados.bandeira,
        nome_portador: dadosCriptografados.nome_portador
          ? cryptoService.descriptografar(dadosCriptografados.nome_portador)
          : null
      };
    } catch (error) {
      console.error('Erro ao detokenizar cartão:', error);
      throw new Error('Falha na detokenização do cartão');
    }
  }

  _validarDadosCartao(dadosCartao) {
    if (!dadosCartao.numero || !dadosCartao.validade) {
      throw new Error('Dados do cartão incompletos');
    }

    if (!this._validarLuhn(dadosCartao.numero)) {
      throw new Error('Número do cartão inválido');
    }

    if (!/^\d{2}\/\d{2}$/.test(dadosCartao.validade)) {
      throw new Error('Validade do cartão inválida');
    }
  }

  _validarLuhn(numero) {
    const numeroLimpo = numero.replace(/\D/g, '');

    if (numeroLimpo.length < 13 || numeroLimpo.length > 19) {
      return false;
    }

    let soma = 0;
    let alternar = false;

    for (let i = numeroLimpo.length - 1; i >= 0; i--) {
      let digito = parseInt(numeroLimpo[i], 10);

      if (alternar) {
        digito *= 2;
        if (digito > 9) {
          digito -= 9;
        }
      }

      soma += digito;
      alternar = !alternar;
    }

    return soma % 10 === 0;
  }

  _gerarToken() {
    const timestamp = Date.now().toString(36);
    const random = cryptoService.gerarToken(16);
    return `TKN_${timestamp}_${random}`;
  }

  async _persistirToken(token, dadosCriptografados) {
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO tef_tokens_cartao (
          token,
          dados_criptografados,
          bandeira,
          criado_em
        ) VALUES (?, ?, ?, datetime('now'))
      `, [
        token,
        JSON.stringify(dadosCriptografados),
        dadosCriptografados.bandeira
      ], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async _buscarToken(token) {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT dados_criptografados
        FROM tef_tokens_cartao
        WHERE token = ?
        AND ativo = 1
      `, [token], (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        resolve(JSON.parse(row.dados_criptografados));
      });
    });
  }

  async revogarToken(token) {
    return new Promise((resolve, reject) => {
      db.run(`
        UPDATE tef_tokens_cartao
        SET ativo = 0,
        revogado_em = datetime('now')
        WHERE token = ?
      `, [token], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async obterInfoToken(token) {
    return new Promise((resolve, reject) => {
      db.get(`
        SELECT token,
               bandeira,
               criado_em,
               revogado_em,
               ativo
        FROM tef_tokens_cartao
        WHERE token = ?
      `, [token], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  }

  async limparTokensExpirados() {
    const dataExpiracao = new Date();
    dataExpiracao.setDate(dataExpiracao.getDate() - 30);

    return new Promise((resolve, reject) => {
      db.run(`
        UPDATE tef_tokens_cartao
        SET ativo = 0,
        revogado_em = datetime('now')
        WHERE criado_em < ?
        AND ativo = 1
      `, [dataExpiracao.toISOString()], function(err) {
        if (err) return reject(err);
        resolve(this.changes || 0);
      });
    });
  }
}

module.exports = new CardTokenizationService();
