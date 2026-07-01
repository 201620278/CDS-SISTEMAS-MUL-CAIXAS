const crypto = require('crypto');

/**
 * Serviço de criptografia AES-256 para dados sensíveis
 * Conforme PCI-DSS 3.2.1 - Armazenamento seguro de dados sensíveis
 */
class CryptoService {
  
  constructor() {
    // Chave de criptografia (em produção, deve vir de variável de ambiente ou HSM)
    this.algorithm = 'aes-256-cbc';
    this.secretKey = this._getSecretKey();
    this.ivLength = 16;
  }
  
  /**
   * Obtém a chave de criptografia
   * Em produção, deve vir de variável de ambiente ou HSM
   */
  _getSecretKey() {
    const envKey = process.env.TEF_ENCRYPTION_KEY;
    if (envKey) {
      return Buffer.from(envKey, 'hex');
    }

    if (process.env.NODE_ENV === 'production') {
      console.error('[SEGURANÇA] TEF_ENCRYPTION_KEY não definido em produção.');
    } else {
      console.warn('[SEGURANÇA] TEF_ENCRYPTION_KEY não definido — usando chave de desenvolvimento.');
    }

    const defaultKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    return Buffer.from(defaultKey, 'hex');
  }
  
  /**
   * Criptografa dados usando AES-256-CBC
   * @param {string} texto - Texto a ser criptografado
   * @returns {string} Texto criptografado em formato hex
   */
  criptografar(texto) {
    if (!texto) return null;
    
    try {
      const iv = crypto.randomBytes(this.ivLength);
      const cipher = crypto.createCipheriv(this.algorithm, this.secretKey, iv);
      
      let criptografado = cipher.update(texto, 'utf8', 'hex');
      criptografado += cipher.final('hex');
      
      // Concatenar IV com o texto criptografado
      return iv.toString('hex') + ':' + criptografado;
    } catch (error) {
      console.error('Erro ao criptografar dados:', error);
      throw new Error('Falha na criptografia de dados');
    }
  }
  
  /**
   * Descriptografa dados usando AES-256-CBC
   * @param {string} textoCriptografado - Texto criptografado em formato hex
   * @returns {string} Texto descriptografado
   */
  descriptografar(textoCriptografado) {
    if (!textoCriptografado) return null;
    
    try {
      const partes = textoCriptografado.split(':');
      if (partes.length !== 2) {
        throw new Error('Formato de criptografia inválido');
      }
      
      const iv = Buffer.from(partes[0], 'hex');
      const criptografado = partes[1];
      
      const decipher = crypto.createDecipheriv(this.algorithm, this.secretKey, iv);
      
      let descriptografado = decipher.update(criptografado, 'hex', 'utf8');
      descriptografado += decipher.final('utf8');
      
      return descriptografado;
    } catch (error) {
      console.error('Erro ao descriptografar dados:', error);
      throw new Error('Falha na descriptografia de dados');
    }
  }
  
  /**
   * Criptografa objeto JSON
   * @param {Object} objeto - Objeto a ser criptografado
   * @returns {string} Objeto criptografado em formato hex
   */
  criptografarObjeto(objeto) {
    if (!objeto) return null;
    
    try {
      const texto = JSON.stringify(objeto);
      return this.criptografar(texto);
    } catch (error) {
      console.error('Erro ao criptografar objeto:', error);
      throw new Error('Falha na criptografia de objeto');
    }
  }
  
  /**
   * Descriptografa objeto JSON
   * @param {string} textoCriptografado - Objeto criptografado em formato hex
   * @returns {Object} Objeto descriptografado
   */
  descriptografarObjeto(textoCriptografado) {
    if (!textoCriptografado) return null;
    
    try {
      const texto = this.descriptografar(textoCriptografado);
      return JSON.parse(texto);
    } catch (error) {
      console.error('Erro ao descriptografar objeto:', error);
      throw new Error('Falha na descriptografia de objeto');
    }
  }
  
  /**
   * Gera hash SHA-256 para integridade de dados
   * @param {string} texto - Texto para gerar hash
   * @returns {string} Hash em formato hex
   */
  gerarHash(texto) {
    if (!texto) return null;
    
    return crypto.createHash('sha256').update(texto).digest('hex');
  }
  
  /**
   * Gera token aleatório seguro
   * @param {number} tamanho - Tamanho do token em bytes
   * @returns {string} Token em formato hex
   */
  gerarToken(tamanho = 32) {
    return crypto.randomBytes(tamanho).toString('hex');
  }
}

module.exports = new CryptoService();
