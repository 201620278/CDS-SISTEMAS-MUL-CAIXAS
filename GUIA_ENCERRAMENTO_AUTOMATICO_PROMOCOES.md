# 🎯 Encerramento Automático de Promoções - Guia de Implementação

## O que foi implementado

O sistema agora encerra automaticamente as promoções quando suas datas de término são atingidas, **sem necessidade de ação manual do usuário**.

## Como funciona

### 1️⃣ Verificação Automática na Inicialização
- Quando o servidor inicia, verifica se há promoções expiradas e as encerra
- Registra todas as ações no console

### 2️⃣ Verificação Periódica
- A cada **1 hora**, o sistema verifica automaticamente se há promoções expiradas
- Encerra automaticamente qualquer promoção cuja data de fim foi atingida

### 3️⃣ Verificação Manual (Sob Demanda)
- Você pode forçar a verificação a qualquer momento via API

## Arquivos Modificados

### Backend

#### 📄 `backend/rotas/server.js`
**Adições:**
- Importação do módulo `database`
- Função `encerrarPromocoesExpiradas()` - Encerra promoções expiradas
- Função `inicializarGerenciamentoPromocoes()` - Inicializa o sistema
- Endpoint `POST /api/promocoes/verificar-expiradas` - Força verificação manual
- Execução da inicialização no `app.listen()`

#### 📄 `backend/rotas/produtos.js`
**Adições:**
- Endpoint `POST /api/produtos/verificar-expiradas-agora` - Verificação manual
- Endpoint `GET /api/produtos/listar-todas-promocoes` - Lista todas as promoções com status
- Informações de status real (vigente, expirada, não iniciada, encerrada)

### Documentação

#### 📄 `MODULO_PROMOCOES_INTELIGENTES.md`
- Seção completa sobre "Encerramento Automático de Promoções"
- Documentação dos novos endpoints
- Benefícios e funcionalidade

### Testes

#### 📄 `testar_encerramento_automatico.js`
Script para testar o funcionamento do sistema:

```bash
# Listar todas as promoções
node testar_encerramento_automatico.js listar

# Encerrar promoções expiradas
node testar_encerramento_automatico.js encerrar

# Criar promoção de teste expirada há 5 dias
node testar_encerramento_automatico.js criar 5

# Criar promoção de teste expirada há 10 dias
node testar_encerramento_automatico.js criar 10

# Mostrar ajuda
node testar_encerramento_automatico.js --help
```

## Como Usar

### Via API

#### Forçar Verificação Imediata (Endpoint 1)
```bash
curl -X POST http://localhost:3000/api/promocoes/verificar-expiradas \
  -H "Authorization: Bearer seu_token" \
  -H "Content-Type: application/json"
```

#### Forçar Verificação Imediata (Endpoint 2)
```bash
curl -X POST http://localhost:3000/api/produtos/verificar-expiradas-agora \
  -H "Authorization: Bearer seu_token" \
  -H "Content-Type: application/json"
```

#### Listar Todas as Promoções com Status
```bash
curl http://localhost:3000/api/produtos/listar-todas-promocoes \
  -H "Authorization: Bearer seu_token"
```

### Via Interface (Frontend)

Você pode adicionar um botão na modal de promoções para forçar a verificação:

```javascript
// Função para forçar verificação manual
async function verificarPromocoeExpiradas() {
  try {
    const response = await fetch('/api/produtos/verificar-expiradas-agora', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    
    if (data.success) {
      alert(`✅ ${data.message}`);
      // Recarregar lista de promoções
      carregarPromocoes('ativas');
    } else {
      alert('❌ Erro ao verificar promoções');
    }
  } catch (error) {
    console.error('Erro:', error);
    alert('❌ Erro ao conectar ao servidor');
  }
}
```

## Registros de Promoções Encerradas

Quando uma promoção é encerrada automaticamente, são registrados:

- ✅ **status**: `'encerrada'`
- ✅ **encerrado_em**: Timestamp do encerramento
- ✅ **motivo_encerramento**: `'Encerrada automaticamente - data de vigência expirada'`

## Exemplos de Uso

### Scenario 1: Sistema Inicializa
```
Servidor iniciando...
✅ Servidor rodando na porta 3000
🔄 Verificando promoções expiradas...
✅ 2 promoção(ões) expirada(s) encerrada(s) automaticamente em 10/06/2026 09:15:30
✅ Sistema de encerramento automático de promoções ativado (verifica a cada hora)
```

### Scenario 2: Promoção Expira Durante Operação
```
[Passou 1 hora...]
✅ 1 promoção(ões) expirada(s) encerrada(s) automaticamente em 10/06/2026 10:15:30
```

### Scenario 3: Testar Sistema
```
$ node testar_encerramento_automatico.js listar

============================================================
📋 PROMOÇÕES NO SISTEMA
============================================================
ID   Produto                   Data Início    Data Fim      Dias Restantes Status    Situação
-----  ...
1    Leite Integral            2026-06-01     2026-06-10    0               ativa     ⚠️  EXPIRADA
2    Iogurte Natural           2026-06-05     2026-06-15    5               ativa     ✅ VIGENTE
...

📊 RESUMO:
  ✅ Promoções Vigentes: 1
  ⚠️  Promoções Expiradas (não encerradas): 1
  ❌ Promoções Encerradas: 3
  📌 Total: 5

$ node testar_encerramento_automatico.js encerrar

🔄 Encerrando promoções expiradas...
✅ 1 promoção(ões) expirada(s) encerrada(s) com sucesso!

[Nova listagem mostra promoção como encerrada]
```

## Benefícios

✅ **Automação Completa**: Sem necessidade de ação manual  
✅ **Dados Consistentes**: Elimina promoções "fantasma"  
✅ **Histórico Auditável**: Promoções encerradas mantêm registro  
✅ **Flexibilidade**: Possibilidade de forçar verificação  
✅ **Transparência**: Logs detalhados de ações  

## Troubleshooting

### O sistema não está encerrando automaticamente as promoções

1. Verifique se o servidor foi iniciado (deve exibir a mensagem de inicialização)
2. Verifique os logs do console do servidor
3. Teste manualmente: `node testar_encerramento_automatico.js encerrar`
4. Force a verificação via API: `POST /api/produtos/verificar-expiradas-agora`

### Promoções expiradas ainda aparecem como ativas

1. Execute: `node testar_encerramento_automatico.js listar`
2. Se aparecerem como "⚠️  EXPIRADA", execute: `node testar_encerramento_automatico.js encerrar`
3. Atualize a interface para ver as mudanças

### A verificação periódica não está funcionando

1. Certifique-se que o servidor está rodando (pode verificar pelo `console.log`)
2. Verifique se há erros no console do backend
3. Restart o servidor para reativar a verificação periódica

## Próximos Passos (Opcional)

### 1. Notificações
- Enviar notificação para o usuário quando uma promoção expira
- Email ou notificação na tela

### 2. Histórico Detalhado
- Manter log detalhado de todas as ações automáticas
- Dashboard de auditoria

### 3. Alertas Antecipados
- Notificar usuário 1 dia antes da promoção expirar
- Sugestão de renovação automática

### 4. Encerramento Agendado
- Permitir agendamento de encerramento em hora específica
- Transações em lote (múltiplas promoções)

---

**Data de Implementação**: 10 de Junho de 2026  
**Status**: ✅ Pronto para Produção  
**Versão**: 1.0
