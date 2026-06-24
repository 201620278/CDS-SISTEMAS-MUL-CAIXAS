// Validador de regras fiscais para transações TEF
// Baseado em requisitos da SEFAZ para NFC-e

class TefFiscalValidator {
  
  // Regras fiscais configuráveis
  static REGRAS_FISCAIS = {
    // Limites de parcelamento por bandeira e tipo
    LIMITE_PARCELAMENTO: {
      visa: { credito: 12, debito: 1 },
      mastercard: { credito: 12, debito: 1 },
      elo: { credito: 12, debito: 1 },
      hipercard: { credito: 12, debito: 1 },
      amex: { credito: 12, debito: 1 },
      discover: { credito: 12, debito: 1 },
      jcb: { credito: 12, debito: 1 },
      diners: { credito: 12, debito: 1 },
      aura: { credito: 12, debito: 1 },
      default: { credito: 12, debito: 1 }
    },
    
    // Valor mínimo por parcela (pode variar por bandeira)
    VALOR_MINIMO_PARCELA: {
      visa: 10.00,
      mastercard: 10.00,
      elo: 10.00,
      hipercard: 10.00,
      amex: 15.00,
      discover: 10.00,
      jcb: 10.00,
      diners: 15.00,
      aura: 10.00,
      default: 10.00
    },
    
    // Tipos de cartão permitidos
    TIPOS_PERMITIDOS: ['debito', 'credito', 'pix', 'pix_tef'],
    
    // Bandeiras permitidas
    BANDEIRAS_PERMITIDAS: ['visa', 'mastercard', 'elo', 'hipercard', 'amex', 'discover', 'jcb', 'diners', 'aura'],
    
    // Valor máximo por transação (pode variar por bandeira)
    VALOR_MAXIMO_TRANSACAO: {
      visa: 50000.00,
      mastercard: 50000.00,
      elo: 50000.00,
      hipercard: 50000.00,
      amex: 100000.00,
      discover: 50000.00,
      jcb: 50000.00,
      diners: 100000.00,
      aura: 50000.00,
      default: 50000.00
    },
    
    // Valor mínimo por transação
    VALOR_MINIMO_TRANSACAO: 1.00,
    
    // Regras específicas por tipo de cartão
    REGRAS_TIPO_CARTAO: {
      debito: {
        parcelas_maximas: 1,
        valor_minimo: 1.00
      },
      credito: {
        parcelas_maximas: 12,
        valor_minimo: 10.00
      },
      pix: {
        parcelas_maximas: 1,
        valor_minimo: 1.00
      },
      pix_tef: {
        parcelas_maximas: 1,
        valor_minimo: 1.00
      }
    },
    
    // Limites de valor por parcelamento
    LIMITE_VALOR_PARCELAMENTO: {
      '2x': 20.00,
      '3x': 30.00,
      '4x': 40.00,
      '5x': 50.00,
      '6x': 60.00,
      '7x': 70.00,
      '8x': 80.00,
      '9x': 90.00,
      '10x': 100.00,
      '11x': 110.00,
      '12x': 120.00
    }
  };
  
  /**
   * Valida uma transação TEF de acordo com as regras fiscais
   * @param {Object} dados - Dados da transação TEF
   * @returns {Object} Resultado da validação { valido: boolean, erros: string[] }
   */
  static validarTransacao(dados) {
    const erros = [];
    const bandeira = dados.bandeira?.toLowerCase().trim() || 'default';
    
    // Validar valor
    this._validarValor(dados.valor, erros, bandeira);
    
    // Validar tipo de pagamento
    this._validarTipoPagamento(dados.tipo, erros);
    
    // Validar parcelamento
    this._validarParcelamento(dados, erros);

    const tipoNorm = String(dados.tipo || '').toLowerCase().trim();
    const ehPix = tipoNorm === 'pix' || tipoNorm === 'pix_tef';

    // Validar bandeira (PIX TEF não usa bandeira de cartão)
    if (!ehPix) {
      this._validarBandeira(dados.bandeira, erros);
    }
    
    return {
      valido: erros.length === 0,
      erros
    };
  }
  
  /**
   * Valida o valor da transação
   */
  static _validarValor(valor, erros, bandeira = 'default') {
    const valorNum = Number(valor);
    
    if (isNaN(valorNum)) {
      erros.push('Valor da transação inválido');
      return;
    }
    
    if (valorNum < this.REGRAS_FISCAIS.VALOR_MINIMO_TRANSACAO) {
      erros.push(`Valor mínimo por transação é R$ ${this.REGRAS_FISCAIS.VALOR_MINIMO_TRANSACAO.toFixed(2)}`);
    }
    
    const valorMaximo = this.REGRAS_FISCAIS.VALOR_MAXIMO_TRANSACAO[bandeira] || 
                       this.REGRAS_FISCAIS.VALOR_MAXIMO_TRANSACAO.default;
    
    if (valorNum > valorMaximo) {
      erros.push(`Valor máximo por transação para ${bandeira} é R$ ${valorMaximo.toFixed(2)}`);
    }
  }
  
  /**
   * Valida o tipo de pagamento
   */
  static _validarTipoPagamento(tipo, erros) {
    if (!tipo) {
      erros.push('Tipo de pagamento não informado');
      return;
    }
    
    const tipoNormalizado = String(tipo).toLowerCase().trim();
    const tiposPermitidos = this.REGRAS_FISCAIS.TIPOS_PERMITIDOS.map(t => t.toLowerCase());
    
    if (!tiposPermitidos.includes(tipoNormalizado)) {
      erros.push(`Tipo de pagamento não permitido: ${tipo}. Tipos permitidos: ${this.REGRAS_FISCAIS.TIPOS_PERMITIDOS.join(', ')}`);
    }
  }
  
  /**
   * Valida o parcelamento
   */
  static _validarParcelamento(dados, erros) {
    const parcelas = Number(dados.parcelas) || 1;
    const valor = Number(dados.valor) || 0;
    const tipo = dados.tipo?.toLowerCase().trim() || 'credito';
    const bandeira = dados.bandeira?.toLowerCase().trim() || 'default';
    
    // Validar número de parcelas por tipo de cartão
    const regrasTipo = this.REGRAS_FISCAIS.REGRAS_TIPO_CARTAO[tipo] || 
                      this.REGRAS_FISCAIS.REGRAS_TIPO_CARTAO.credito;
    
    if (parcelas < 1) {
      erros.push('Número de parcelas deve ser maior que zero');
    }
    
    if (parcelas > regrasTipo.parcelas_maximas) {
      erros.push(`Número máximo de parcelas para ${tipo} é ${regrasTipo.parcelas_maximas}`);
    }
    
    // Validar limite de parcelamento por bandeira e tipo
    const limiteParcelas = this.REGRAS_FISCAIS.LIMITE_PARCELAMENTO[bandeira]?.[tipo] || 
                          this.REGRAS_FISCAIS.LIMITE_PARCELAMENTO.default[tipo];
    
    if (parcelas > limiteParcelas) {
      erros.push(`Número máximo de parcelas para ${bandeira} (${tipo}) é ${limiteParcelas}`);
    }
    
    // Validar valor mínimo por parcela (específico por bandeira)
    if (parcelas > 1) {
      const valorPorParcela = valor / parcelas;
      const valorMinimoParcela = this.REGRAS_FISCAIS.VALOR_MINIMO_PARCELA[bandeira] || 
                               this.REGRAS_FISCAIS.VALOR_MINIMO_PARCELA.default;
      
      if (valorPorParcela < valorMinimoParcela) {
        erros.push(`Valor mínimo por parcela para ${bandeira} é R$ ${valorMinimoParcela.toFixed(2)}. Valor atual: R$ ${valorPorParcela.toFixed(2)}`);
      }
      
      // Validar limite de valor por número de parcelas
      const chaveParcelamento = `${parcelas}x`;
      const limiteValorParcelamento = this.REGRAS_FISCAIS.LIMITE_VALOR_PARCELAMENTO[chaveParcelamento];
      
      if (limiteValorParcelamento && valor < limiteValorParcelamento) {
        erros.push(`Valor mínimo para parcelamento em ${parcelas}x é R$ ${limiteValorParcelamento.toFixed(2)}. Valor atual: R$ ${valor.toFixed(2)}`);
      }
    }
  }
  
  /**
   * Valida a bandeira do cartão
   */
  static _validarBandeira(bandeira, erros) {
    if (!bandeira) {
      erros.push('Bandeira do cartão não informada');
      return;
    }
    
    const bandeiraNormalizada = String(bandeira).toLowerCase().trim();
    const bandeirasPermitidas = this.REGRAS_FISCAIS.BANDEIRAS_PERMITIDAS.map(b => b.toLowerCase());
    
    if (!bandeirasPermitidas.includes(bandeiraNormalizada)) {
      erros.push(`Bandeira não permitida: ${bandeira}. Bandeiras permitidas: ${this.REGRAS_FISCAIS.BANDEIRAS_PERMITIDAS.join(', ')}`);
    }
  }
  
  /**
   * Configura regras fiscais personalizadas
   */
  static configurarRegras(regras) {
    if (regras.limiteParcelamento) {
      this.REGRAS_FISCAIS.LIMITE_PARCELAMENTO = {
        ...this.REGRAS_FISCAIS.LIMITE_PARCELAMENTO,
        ...regras.limiteParcelamento
      };
    }
    
    if (regras.valorMinimoParcela !== undefined) {
      this.REGRAS_FISCAIS.VALOR_MINIMO_PARCELA = regras.valorMinimoParcela;
    }
    
    if (regras.valorMaximoTransacao !== undefined) {
      this.REGRAS_FISCAIS.VALOR_MAXIMO_TRANSACAO = regras.valorMaximoTransacao;
    }
    
    if (regras.tiposPermitidos) {
      this.REGRAS_FISCAIS.TIPOS_PERMITIDOS = regras.tiposPermitidos;
    }
    
    if (regras.bandeirasPermitidas) {
      this.REGRAS_FISCAIS.BANDEIRAS_PERMITIDAS = regras.bandeirasPermitidas;
    }
  }
  
  /**
   * Retorna as regras fiscais atuais
   */
  static obterRegras() {
    return { ...this.REGRAS_FISCAIS };
  }
}

module.exports = TefFiscalValidator;
