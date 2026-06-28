# Arquitetura Oficial de Pagamentos - CDS Sistemas

## Visão Geral

Este documento descreve a arquitetura oficial de pagamentos restaurada para o sistema CDS Sistemas, eliminando as desvios arquiteturais onde o PDV (frontend) tomava decisões que pertencem ao backend.

## Fluxo Oficial de Pagamento

### Fluxo Obrigatório para Vendas com Componentes Fiscais e Não-Fiscais

```
Venda → Motor Fiscal → Distribuição Automática (valor_fiscal, valor_nao_fiscal) → 
Motor Financeiro (OrquestradorPagamento) → 1º Recebimento Fiscal → 
Confirmação (TEF ou Manual) → status_pagamento = aguardando_nao_fiscal → 
2º Recebimento Não Fiscal → status_pagamento = quitada → NFC-e
```

### Responsabilidades

**Frontend (PDV):**
- Coleta dados básicos: cliente, itens, forma de pagamento escolhida
- Exibe modais para confirmação manual e pagamento não fiscal
- NÃO toma decisões de fluxo de pagamento
- NÃO decide tipos de pagamento, valores ou status
- NÃO usa flags como `pagamentos_processados_pdv` ou `ehPagamentoMisto`

**Backend (OrquestradorPagamento):**
- ÚNICO local onde todas as decisões de pagamento existem
- Distribui pagamentos entre fiscal e não fiscal por prioridade
- Decide quando usar TEF vs confirmação manual
- Gerencia status de pagamento
- Determina próxima ação do fluxo
- Fonte única de verdade para valores financeiros e status

## Componentes Principais

### 1. OrquestradorPagamento.js

**Localização:** `backend/services/OrquestradorPagamento.js`

**Função Principal:** Centraliza toda a lógica de pagamento em um único serviço.

**Funções Exportadas:**

- `processarFluxoPagamentoVenda()` - Processa o fluxo completo de pagamento de uma venda
- `processarPagamentoNaoFiscal()` - Processa o pagamento não fiscal (segunda etapa)
- `determinarStatusPagamento()` - Determina o status do pagamento
- `montarRecebimentosParaGravar()` - Monta os recebimentos para gravar no banco

**Fluxo Interno:**

1. Normaliza pagamentos de entrada
2. Distribui pagamentos entre fiscal e não fiscal (via DistribuidorPagamento)
3. Valida se pagamento fiscal é suficiente
4. Processa recebimento fiscal (TEF ou Confirmação Manual)
5. Determina status do pagamento
6. Monta recebimentos para gravar
7. Determina próxima ação

### 2. DistribuidorPagamento.js

**Localização:** `backend/services/DistribuidorPagamento.js`

**Função:** Distribui pagamentos entre fiscal e não fiscal por prioridade.

**Prioridade de Distribuição:**
1. pix
2. cartao_debito
3. cartao_credito
4. cartao
5. dinheiro

### 3. Backend vendas.js

**Alterações Realizadas:**

- Removida lógica de `pagamentos_processados_pdv`
- Removida lógica de `confirmacao_fiscal_manual`
- Substituído processamento de pagamento por chamadas ao OrquestradorPagamento
- Unificado fluxo para vendas à vista e a prazo

**Antes:**
```javascript
const pagamentosProcessadosPdv = pagamentos_processados_pdv === true || ...;
const confirmacaoFiscalManual = isConfirmacaoFiscalManual(confirmacao_fiscal_manual);
const distribuicaoPagamento = montarDistribuicaoPagamento(..., pagamentosProcessadosPdv);
const resultadoTefFiscal = await processarTefRecebimentosFiscais(..., pagamentosProcessadosPdv, confirmacaoFiscalManual);
```

**Depois:**
```javascript
const resultadoPagamento = await OrquestradorPagamento.processarFluxoPagamentoVenda({
  totalFiscal,
  totalNaoFiscal,
  formaPagamento: formaPagamentoFinal,
  pagamentos: req.body.pagamentos || [],
  tefHabilitado,
  modoConfirmacaoFiscal
});
```

### 4. Frontend pdv.js

**Alterações Realizadas:**

- Removida lógica complexa de TEF no frontend
- Removida função `processarPagamentosMistosTEF()`
- Removida função `processarVendaFiscalNaoFiscal()`
- Removidas funções auxiliares de TEF
- Removido uso de `pagamentos_processados_pdv`
- Removido uso de `ehPagamentoMisto`
- Simplificado para apenas enviar dados básicos de pagamento

**Antes:**
```javascript
const ehPagamentoMisto = Array.isArray(pagamentosMistos) && pagamentosMistos.length > 0;
const fluxoResolvido = TefFluxoPagamento.resolverFluxoPagamentoFiscal({...});
if (deveUsarTefAutomatico && ehPagamentoMisto) {
  const pagamentosComTEF = await processarPagamentosMistosTEF(pagamentosMistos);
  dados.pagamentos = pagamentosComTEF;
  dados.pagamentos_processados_pdv = true;
}
```

**Depois:**
```javascript
// Backend OrquestradorPagamento agora cuida de toda a lógica de pagamento
// PDV apenas envia dados básicos
if (Array.isArray(pagamentosMistos) && pagamentosMistos.length > 0) {
  dados.pagamentos = pagamentosMistos;
  dados.forma_pagamento = 'misto';
} else {
  dados.pagamentos = [{ forma_pagamento: formaPagamento, valor: total }];
}
```

## Status de Pagamento

### Estados Possíveis

1. **pendente** - Pagamento não processado
2. **aguardando_nao_fiscal** - Pagamento fiscal confirmado, aguardando pagamento não fiscal
3. **quitada** - Todos os pagamentos completados

### Regras de Determinação

- Se não tem fiscal e não tem não fiscal → `quitada`
- Se não tem fiscal e tem não fiscal → verifica se não fiscal está quitado
- Se tem fiscal e não fiscal:
  - Fiscal não processado → `pendente`
  - Fiscal processado, não fiscal quitado → `aguardando_nao_fiscal`
  - Ambos quitados → `quitada`
- Se tem apenas fiscal → fiscal processado → `quitada`

## Cenários de Aceitação

### Cenário 1: Venda Mista com TEF Ativo
- **Entrada:** Fiscal=100, Não-Fiscal=50, TEF habilitado
- **Fluxo:** TEF cobra apenas fiscal → status=aguardando_nao_fiscal → Pagamento não fiscal → status=quitada → NFC-e emitida
- **Resultado:** Dois recebimentos separados, NFC-e emitida após pagamento completo

### Cenário 2: Venda Mista com TEF Desativado
- **Entrada:** Fiscal=100, Não-Fiscal=50, TEF desabilitado
- **Fluxo:** Confirmação manual fiscal → status=aguardando_nao_fiscal → Pagamento não fiscal → status=quitada → NFC-e emitida
- **Resultado:** Dois recebimentos separados, NFC-e emitida após pagamento completo

### Cenário 3: Venda Totalmente Fiscal
- **Entrada:** Fiscal=100, Não-Fiscal=0
- **Fluxo:** Pagamento fiscal → status=quitada → NFC-e emitida
- **Resultado:** Um recebimento fiscal, NFC-e emitida

### Cenário 4: Venda Totalmente Não-Fiscal
- **Entrada:** Fiscal=0, Não-Fiscal=50
- **Fluxo:** Pagamento não fiscal → status=quitada
- **Resultado:** Um recebimento não fiscal, sem NFC-e

### Cenário 5: Venda Mista com Única Forma de Pagamento
- **Entrada:** Fiscal=100, Não-Fiscal=50, única forma de pagamento
- **Fluxo:** Pagamento único → Distribuição automática → Dois recebimentos criados
- **Resultado:** Dois recebimentos separados, nunca unifica fiscal e não fiscal

## Tabelas do Banco de Dados

### venda_recebimentos (Tabela Oficial)

**Uso:** Fonte oficial de dados de pagamentos.

**Colunas:**
- id
- venda_id
- tipo_recebimento ('fiscal' ou 'nao_fiscal')
- forma_pagamento
- valor
- tef_transacao_id
- nsu
- autorizacao
- status

### venda_pagamentos (Tabela Legada)

**Status:** Mantida para compatibilidade, mas venda_recebimentos é a fonte oficial.

**Uso:** Migração futura para venda_recebimentos.

## Endpoints API

### POST /vendas

**Descrição:** Cria uma nova venda e processa o fluxo de pagamento fiscal.

**Payload:**
```json
{
  "cliente_id": 1,
  "total": 150,
  "forma_pagamento": "dinheiro",
  "itens": [...],
  "pagamentos": [
    {
      "forma_pagamento": "dinheiro",
      "valor": 150
    }
  ],
  "emitir_fiscal": true,
  "cpf_cnpj_nota": "12345678901"
}
```

**Resposta:**
```json
{
  "venda_id": 123,
  "codigo": "VND-20240628123456",
  "status_pagamento": "aguardando_nao_fiscal",
  "valor_fiscal": 100,
  "valor_nao_fiscal": 50
}
```

### POST /vendas/:id/pagamento-nao-fiscal

**Descrição:** Registra o pagamento não fiscal (segunda etapa do fluxo).

**Payload:**
```json
{
  "pagamentos": [
    {
      "forma_pagamento": "dinheiro",
      "valor": 50
    }
  ],
  "emitir_fiscal": true
}
```

**Resposta:**
```json
{
  "id": 123,
  "codigo": "VND-20240628123456",
  "status_pagamento": "quitada",
  "fiscal": {
    "success": true,
    "numero": "123456"
  }
}
```

## Regras de Negócio

### Separação Fiscal e Não-Fiscal

- **Regra:** Sempre criar recebimentos separados para fiscal e não fiscal, independentemente da forma de pagamento.
- **Exceção:** Nenhuma. A arquitetura não permite unificação.

### TEF vs Confirmação Manual

- **TEF:** Usado quando configurado e a forma de pagamento exige TEF
- **Manual:** Usado quando TEF desabilitado ou configuração manual ativa
- **Decisão:** Tomada exclusivamente pelo OrquestradorPagamento no backend

### Prioridade de Distribuição

- Pix tem prioridade máxima para pagamentos fiscais
- Cartão de débito vem em seguida
- Cartão de crédito depois
- Cartão genérico depois
- Dinheiro tem prioridade mínima

## Migração de venda_pagamentos para venda_recebimentos

**Status:** Parcialmente implementada.

**Ações Futuras:**
1. Migrar todas as leituras de venda_pagamentos para venda_recebimentos
2. Atualizar relatórios para usar venda_recebimentos
3. Remover venda_pagamentos após período de transição

## Testes

### Testes Unitários (Pendentes)

- testDistribuicaoPagamentos()
- testDeterminarStatusPagamento()
- testProcessarRecebimentoFiscalTEF()
- testProcessarRecebimentoFiscalManual()

### Testes de Integração (Pendentes)

- testCenario1_VendaMistaTEFAtivo()
- testCenario2_VendaMistaTEFDesativado()
- testCenario3_VendaTotalmenteFiscal()
- testCenario4_VendaTotalmenteNaoFiscal()
- testCenario5_VendaMistaUnicaFormaPagamento()

## Regressões Potenciais

### Áreas a Verificar

1. **Motor Fiscal** - Emissão de NFC-e após pagamento completo
2. **Estoque** - Redução correta de estoque fiscal e não fiscal
3. **Dashboard** - Relatórios financeiros usando venda_recebimentos
4. **Relatórios** - Consistência de dados financeiros
5. **Cancelamentos** - Reversão correta de pagamentos
6. **Devoluções** - Restituição correta de estoque fiscal
7. **NFC-e** - Emissão correta após status=quitada

## Conclusão

A arquitetura restaurada elimina as desvios onde o frontend tomava decisões de negócio, centralizando toda a lógica de pagamento no OrquestradorPagamento. Isso garante:

- **Backend como fonte única de verdade** para valores e status
- **Frontend limitado a coleta de dados** sem lógica de negócio
- **Fluxo unificado** para todos os tipos de pagamento
- **Separação obrigatória** entre fiscal e não fiscal
- **Maior manutenibilidade** e facilidade de testes
