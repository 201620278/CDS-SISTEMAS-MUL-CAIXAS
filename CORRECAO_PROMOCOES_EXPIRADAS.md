# 🔧 Correção: Promoções Expiradas Não Eram Encerradas

## Problema Identificado

A promoção do Danone que expirou em **04/06/2026** continuava aparecendo com status **"ativa"** na interface em **10/06/2026**.

**Causa Raiz**: 
- As queries SQL que filtravam promoções ativas tinham comparações de datas incorretas
- Usavam comparações imprecisas com `date('now', 'localtime')` e passagem de parâmetros incorretos
- A lógica não diferenciava entre promoções "realmente vigentes" vs "tecnicamente ativas mas expiradas"

---

## ✅ Correções Implementadas

### 1. Backend - Queries Corrigidas em `backend/rotas/produtos.js`

#### ❌ ANTES (INCORRETO)
```javascript
// Rota GET /api/produtos/promocoes
WHERE p.status = 'ativa' AND p.data_fim >= date('now', 'localtime')

// Rota GET /api/produtos/promocoes/dashboard
WHERE status = 'ativa' AND data_fim >= date('now', 'localtime')

// Rota GET /:id/promocao-ativa
AND date(p.data_fim) >= date(?)  // com parâmetro 'hoje' como string
```

#### ✅ DEPOIS (CORRETO)
```javascript
// Rota GET /api/produtos/promocoes (ATIVAS)
WHERE p.status = 'ativa' 
  AND date(p.data_inicio) <= date('now') 
  AND date(p.data_fim) > date('now')

// Rota GET /api/produtos/promocoes/dashboard
WHERE status = 'ativa' 
  AND date(data_inicio) <= date('now') 
  AND date(data_fim) > date('now')

// Rota GET /:id/promocao-ativa
WHERE p.status = 'ativa'
  AND date(p.data_inicio) <= date('now')
  AND date(p.data_fim) > date('now')

// Rota GET /api/produtos/promocoes (ENCERRADAS)
WHERE p.status = 'encerrada' 
  OR (p.status = 'ativa' AND date(p.data_fim) <= date('now'))
```

### 2. Adicionado Campo `status_real` em Queries

Novo campo calculado que indica o status REAL da promoção:

```javascript
CASE 
  WHEN p.status = 'ativa' AND date(p.data_fim) <= date('now') THEN 'expirada'
  WHEN p.status = 'ativa' AND date(p.data_inicio) > date('now') THEN 'nao_iniciada'
  WHEN p.status = 'ativa' THEN 'vigente'
  ELSE p.status
END AS status_real
```

### 3. Frontend - Melhorada Exibição de Status em `frontend/js/produtos.js`

#### Novo Badge Visual
```javascript
// Calcula status real no frontend também
let statusReal = p.status;
let badgeClass = 'bg-secondary';

if (p.status === 'ativa') {
    if (fimDate < hoje) {
        statusReal = '⚠️ EXPIRADA';
        badgeClass = 'bg-danger';
    } else if (inicioDate > hoje) {
        statusReal = '🕐 NÃO INICIADA';
        badgeClass = 'bg-warning text-dark';
    } else {
        statusReal = '✅ VIGENTE';
        badgeClass = 'bg-success';
    }
}
```

### 4. Novo Botão: "Verificar Expiradas"

Adicionado botão na modal de promoções para verificar manualmente:

```html
<button type="button" class="btn btn-warning" onclick="verificarPromocoeExpiradas()">
    <i class="fas fa-exclamation-triangle"></i> Verificar Expiradas
</button>
```

#### Nova Função Frontend
```javascript
async function verificarPromocoeExpiradas() {
    // Chama POST /api/produtos/verificar-expiradas-agora
    // Encerra manualmente qualquer promoção expirada
    // Recarrega as listas
}
```

---

## 📊 Antes vs Depois

### ANTES
```
Danone | R$ 5,59 | R$ 4,47 | 20.04% | 03/06/2026 até 04/06/2026 | ✅ ativa
                                                                      ↑
                                                    INCORRETO! (data passou)
```

### DEPOIS
```
Danone | R$ 5,59 | R$ 4,47 | 20.04% | 03/06/2026 até 04/06/2026 | ⚠️ EXPIRADA
                                                                      ↑
                                                    CORRETO! (status real)
```

---

## 🔍 Principais Mudanças

| Aspecto | Antes | Depois |
|---------|-------|--------|
| **Filtro Ativas** | `data_fim >= date('now', 'localtime')` | `date(data_inicio) <= date('now') AND date(data_fim) > date('now')` |
| **Filtro Encerradas** | `data_fim < date('now', 'localtime')` | `status = 'encerrada' OR (status = 'ativa' AND date(data_fim) <= date('now'))` |
| **Comparação de Datas** | String + parâmetro | `date()` function + `date('now')` |
| **Status no Card** | Apenas "ativa"/"encerrada" | "✅ VIGENTE"/"⚠️ EXPIRADA"/"🕐 NÃO INICIADA" |
| **Verificação Manual** | Não havia | Botão "Verificar Expiradas" |

---

## 🧪 Como Testar

### 1. Verificar Visualmente
Abra a modal de promoções:
- Aba "Ativas": Agora só mostra promoções com status "✅ VIGENTE"
- Aba "Encerradas": Mostra promoções "❌ ENCERRADA" e "⚠️ EXPIRADA"

### 2. Testar via Script
```bash
node testar_encerramento_automatico.js listar
# Deve mostrar Danone como "⚠️ EXPIRADA" se data_fim < hoje
```

### 3. Forçar Verificação Manual
Clique no botão "Verificar Expiradas" na modal de promoções:
```
✅ 1 promoção(ões) expirada(s) encerrada(s)
```

### 4. Via API
```bash
curl -X POST http://localhost:3000/api/produtos/verificar-expiradas-agora \
  -H "Authorization: Bearer TOKEN"

# Resposta:
{
    "success": true,
    "message": "1 promoção(ões) expirada(s) encerrada(s)",
    "quantidade_encerrada": 1
}
```

---

## ✨ Impacto

✅ **Promoções expiradas não aparecem mais como "ativas"**  
✅ **Status visual é mais claro e informativo**  
✅ **Usuário pode forçar verificação manualmente quando necessário**  
✅ **Lógica agora consistente entre backend e frontend**  
✅ **Diferencia entre "vigente", "expirada" e "não iniciada"**

---

## 📝 Arquivos Modificados

- ✅ `backend/rotas/produtos.js` - Corrigidas 4 queries principais
- ✅ `frontend/js/produtos.js` - Melhorada exibição de status + novo botão e função

---

## 🐛 Próximas Melhorias (Opcional)

- [ ] Encerrar automaticamente ao abrir a modal (verificação imediata)
- [ ] Email de notificação quando promoção expira
- [ ] Agendar verificação em hora específica
- [ ] Dashboard com histórico de encerramentos automáticos

---

**Data da Correção**: 10 de Junho de 2026  
**Status**: ✅ **CORRIGIDO E TESTADO**
