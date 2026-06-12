# Módulo de Promoções Inteligentes

## 📋 Visão Geral

O módulo de **Promoções Inteligentes** foi implementado no CDS Sistemas como uma funcionalidade integrada ao módulo de Produtos. Este módulo analisa os dados de produtos e gera sugestões automáticas de promoções baseado em critérios inteligentes, especialmente para produtos próximos do vencimento.

## 🎯 Funcionalidades

### 1. Card de Promoções Inteligentes
- **Localização**: Ao lado dos cards "Alertas de Estoque" e "Vencimentos" na página de Produtos
- **Informações exibidas**:
  - Quantidade de produtos sugeridos para promoção
  - Quantidade de promoções ativas
  - Quantidade de promoções encerradas
- **Botão**: "Ver Sugestões" - abre modal com detalhes

### 2. Modal de Promoções
O modal possui 3 abas:

#### Aba "Sugestões"
- Lista de sugestões automáticas geradas pelo sistema
- Informações: Produto, Motivo, Preço Atual, Preço Sugerido, Desconto
- Ações por sugestão:
  - **Aceitar**: Confirma a sugestão de promoção
  - **Rejeitar**: Descarta a sugestão

#### Aba "Ativas"
- Promoções atualmente em vigor
- Período de vigência
- Botão para encerrar promoção quando necessário

#### Aba "Encerradas"
- Histórico de promoções finalizadas ou canceladas
- Informações completas para rastreamento

### 3. Geração Automática de Sugestões
- **Botão "Gerar Sugestões"**: Analisa produtos e cria sugestões automáticas
- **Critério de Sugestão Atual**:
  - Produtos com validade cadastrada
  - Vencimento próximo (dentro do período configurado de alertas)
  - Estoque disponível > 0

## 🗄️ Banco de Dados

### Tabelas Criadas

#### `promocoes_sugestoes`
Armazena as sugestões geradas automaticamente.

```sql
CREATE TABLE promocoes_sugestoes (
    id INTEGER PRIMARY KEY,
    produto_id INTEGER NOT NULL,
    motivo TEXT NOT NULL,
    dias_para_vencer INTEGER,
    estoque_atual DECIMAL(10,2),
    preco_atual DECIMAL(10,2),
    preco_sugerido DECIMAL(10,2),
    desconto_percentual DECIMAL(5,2),
    ativo INTEGER DEFAULT 1,
    criado_em DATETIME,
    aceito_em DATETIME,
    rejeitado_em DATETIME,
    FOREIGN KEY (produto_id) REFERENCES produtos(id)
);
```

#### `promocoes`
Armazena as promoções criadas ou aceitas.

```sql
CREATE TABLE promocoes (
    id INTEGER PRIMARY KEY,
    produto_id INTEGER NOT NULL,
    preco_original DECIMAL(10,2),
    preco_promocional DECIMAL(10,2),
    desconto_percentual DECIMAL(5,2),
    data_inicio DATE NOT NULL,
    data_fim DATE NOT NULL,
    status TEXT DEFAULT 'ativa',
    criado_em DATETIME,
    encerrado_em DATETIME,
    motivo_encerramento TEXT,
    FOREIGN KEY (produto_id) REFERENCES produtos(id)
);
```

## 🔌 API Endpoints

### Endpoints Implementados

#### 1. GET `/api/produtos/promocoes/dashboard`
Retorna contadores para o card.

**Resposta:**
```json
{
    "sugestoes_pendentes": 5,
    "promocoes_ativas": 3,
    "promocoes_encerradas": 12
}
```

#### 2. GET `/api/produtos/promocoes/sugestoes`
Lista todas as sugestões pendentes.

**Resposta:**
```json
[
    {
        "id": 1,
        "produto_id": 123,
        "nome_produto": "Leite Integral",
        "motivo": "vencimento_proximo",
        "dias_para_vencer": 5,
        "preco_atual": 3.50,
        "preco_sugerido": 2.97,
        "desconto_percentual": 15.00,
        "estoque_atual": 45
    }
]
```

#### 3. GET `/api/produtos/promocoes?status=ativas|encerradas`
Lista promoções ativas ou encerradas.

#### 4. POST `/api/produtos/promocoes/sugestoes/:id/processar`
Processa sugestão (aceita ou rejeita).

**Payload:**
```json
{
    "acao": "aceitar" // ou "rejeitar"
}
```

#### 5. POST `/api/produtos/promocoes/gerar-sugestoes`
Gera sugestões automáticas para produtos elegíveis.

**Resposta:**
```json
{
    "message": "Sugestões geradas com sucesso. Total: 3",
    "total": 3
}
```

#### 6. PUT `/api/produtos/promocoes/:id/encerrar`
Encerra uma promoção ativa.

#### 7. POST `/api/produtos/promocoes`
Cria uma nova promoção.

#### 8. POST `/api/produtos/promocoes/verificar-expiradas-agora` ⭐ **NOVO**
Verifica e encerra manualmente promoções expiradas.

**Resposta:**
```json
{
    "success": true,
    "message": "2 promoção(ões) expirada(s) encerrada(s)",
    "quantidade_encerrada": 2
}
```

#### 9. GET `/api/produtos/listar-todas-promocoes` ⭐ **NOVO**
Lista todas as promoções com informação de status real (vigente, expirada, não iniciada).

**Resposta:**
```json
[
    {
        "id": 1,
        "produto_id": 123,
        "codigo": "P001",
        "nome": "Leite Integral",
        "preco_original": 3.50,
        "preco_promocional": 2.97,
        "desconto_percentual": 15.00,
        "data_inicio": "2026-06-01",
        "data_fim": "2026-06-30",
        "status": "ativa",
        "status_real": "vigente",
        "dias_restantes": 20
    }
]
```

## ⚙️ Encerramento Automático de Promoções ⭐ **NOVO**

### Como Funciona

O sistema **encerra automaticamente** promoções quando a data de fim é atingida, sem necessidade de ação manual do usuário.

### Mecanismo

1. **Verificação ao Iniciar**: Quando o servidor inicia, o sistema verifica e encerra todas as promoções expiradas
2. **Verificação Periódica**: A cada **1 hora**, o sistema verifica automaticamente se há promoções expiradas
3. **Verificação sob Demanda**: Você pode forçar a verificação a qualquer momento

### Endpoints para Verificação

#### Forçar Verificação Imediata
```bash
POST /api/promocoes/verificar-expiradas

# Resposta
{
    "success": true,
    "message": "Verificação de promoções expiradas realizada com sucesso"
}
```

#### Ou via rota de produtos
```bash
POST /api/produtos/verificar-expiradas-agora

# Resposta
{
    "success": true,
    "message": "2 promoção(ões) expirada(s) encerrada(s)",
    "quantidade_encerrada": 2
}
```

### Registro Automático

Quando uma promoção é encerrada automaticamente, o sistema registra:
- **status**: Alterado para `'encerrada'`
- **encerrado_em**: Timestamp do encerramento automático
- **motivo_encerramento**: `'Encerrada automaticamente - data de vigência expirada'`

### Logs do Sistema

Você verá mensagens no console do servidor como:
```
✅ 2 promoção(ões) expirada(s) encerrada(s) automaticamente em 10/06/2026 15:30:45
```

### Benefícios

- ✅ **Sem necessidade de ação manual**: Promoções expiram automaticamente
- ✅ **Dados consistentes**: Eliminadas promoções "fantasma" expiradas
- ✅ **Histórico mantido**: Promoções encerradas permanecem no banco de dados para auditoria
- ✅ **Flexibilidade**: Pode verificar manualmente a qualquer momento

## 💻 Frontend

### Arquivos Modificados

#### `frontend/js/produtos.js`
- **Funções adicionadas:**
  - `carregarDashboardPromocoes()` - Carrega dados do card
  - `abrirModalPromocoesProdutos()` - Abre modal de promoções
  - `carregarSugestoesPromocoes()` - Carrega sugestões
  - `carregarPromocoes(tipo)` - Carrega promoções ativas/encerradas
  - `aceitarSugestaoPromocao(id)` - Aceita sugestão
  - `rejeitarSugestaoPromocao(id)` - Rejeita sugestão
  - `encerrarPromocao(id)` - Encerra promoção
  - `gerarSugestoesPromocoes()` - Gera sugestões automaticamente

- **Modificações em `renderProdutos()`:**
  - Alteração de layout das colunas: `col-md-6` → `col-md-6 col-lg-4`
  - Adição do card de "Promoções Inteligentes"
  - Chamada a `carregarDashboardPromocoes()`

### Componentes UI

#### Card de Promoções Inteligentes
```html
<div class="card-dashboard card-promocoes h-100" id="cardPromocoesProdutos">
    <div class="card-icon">🎯</div>
    <div class="card-info">
        <h3>Promoções Inteligentes</h3>
        <p>
            <strong id="qtdSugestoesProdutos">0</strong> sugestões |
            <strong id="qtdPromocoesProdutos">0</strong> ativas
        </p>
        <button type="button" class="btn btn-info btn-sm" onclick="abrirModalPromocoesProdutos()">
            Ver Sugestões
        </button>
    </div>
</div>
```

## 🚀 Como Usar

### Acessar o Módulo
1. Abra a página de **Produtos**
2. Localize o card **"Promoções Inteligentes"** ao lado de "Alertas de Estoque" e "Vencimentos"
3. Clique no botão **"Ver Sugestões"**

### Gerar Sugestões Automáticas
1. Na modal de Promoções, clique em **"Gerar Sugestões"**
2. O sistema analisará todos os produtos com:
   - Controle de validade ativado
   - Data de validade próxima
   - Estoque disponível
3. Sugestões serão listadas na aba "Sugestões"

### Aceitar/Rejeitar Sugestões
1. Na aba "Sugestões", visualize os produtos sugeridos
2. Clique em **"Aceitar"** para confirmar a promoção
3. Clique em **"Rejeitar"** para descartar a sugestão

### Visualizar Promoções Ativas
1. Acesse a aba **"Ativas"** para ver promoções em andamento
2. Clique em **"Encerrar"** para finalizar uma promoção

### Consultar Histórico
1. Acesse a aba **"Encerradas"** para visualizar promoções finalizadas

## 📊 Critérios de Sugestão

### Próximo do Vencimento
- **Condição**: Produto com validade cadastrada e vencimento dentro dos próximos dias
- **Desconto Sugerido**: 15% (padrão)
- **Objetivo**: Aumentar rotatividade de estoque de itens próximos ao vencimento

### Futuras Extensões (Roadmap)
- [ ] Estoque baixo: Produtos com estoque próximo ao mínimo
- [ ] Rotatividade baixa: Produtos com pouca venda
- [ ] Sazonalidade: Promoções automáticas por período
- [ ] Machine Learning: Otimizar descontos baseado em histórico de vendas

## 🔧 Configurações

### Desconto Padrão
Atualmente, o desconto padrão para produtos próximos do vencimento é de **15%**. Para alterar:

**Arquivo**: `backend/rotas/produtos.js`
**Linha**: ~730 (na função que gera sugestões)

```javascript
const desconto_percentual = 15; // Altere este valor
```

### Período de Alerta de Validade
O período é definido por produto no campo **"Alertar com quantos dias?"** (padrão: 30 dias).

## 📝 Logs e Monitoramento

Todas as ações são registradas:
- Sugestões geradas: `criado_em`
- Sugestões processadas: `aceito_em` ou `rejeitado_em`
- Promoções criadas: `criado_em`
- Promoções encerradas: `encerrado_em`

## 🐛 Troubleshooting

### Card não aparece
- Verifique se a página foi recarregada
- Verifique se o banco de dados foi inicializado com as novas tabelas

### Sugestões não aparecem
- Execute "Gerar Sugestões" manualmente
- Verifique se há produtos com validade cadastrada

### Modal não abre
- Verifique o console do navegador para erros de JavaScript
- Certifique-se de que o servidor backend está rodando

## 🔐 Segurança

- Todos os endpoints requerem autenticação via token Bearer
- Validação de entrada em todos os endpoints
- Proteção contra SQL injection via prepared statements

## 📚 Referências

- [Módulo de Produtos](frontend/js/produtos.js)
- [API de Produtos](backend/rotas/produtos.js)
- [Banco de Dados](backend/database.js)

## 👤 Suporte

Para dúvidas ou problemas com o módulo, verifique:
1. O console do navegador (F12 → Console)
2. Os logs do servidor backend
3. O estado das tabelas do banco de dados

---

**Versão**: 1.0  
**Data de Implementação**: Junho de 2026  
**Status**: ✅ Implementado e Funcional
