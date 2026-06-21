# Relatório de Refatoração — Separação ERP / PDV

**Projeto:** CDS Sistemas — Múltiplos Caixas  
**Data:** 21/06/2026  
**Escopo:** Separação arquitetural do frontend em dois módulos independentes (ERP e PDV), mantendo backend Node.js e SQLite únicos.

---

## 1. Análise da arquitetura anterior

### Situação identificada
- **Monolito SPA:** `frontend/index.html` carregava **todos** os 20+ scripts JS (ERP + PDV) simultaneamente.
- **Roteamento único:** `frontend/js/app.js` com `loadPage()` e menu lateral misturando PDV e retaguarda.
- **Electron único:** `electron.js` abria `/login` → `/` (index monolítico).
- **Build único:** `electron-builder` gerava "CDS Sistemas - PDV" contendo o ERP completo.
- **Acoplamento:** PDV chamava `loadPage('caixa')`, configuracoes chamava `loadPage('pdv')`, TEF/fiscal compartilhados no mesmo bundle.

### Dependências críticas mapeadas
| Origem | Dependência | Impacto |
|--------|-------------|---------|
| `pdv.js` | `loadPage`, `loadCaixa`, `formatCurrency`, `API_URL` | Navegação e utilitários |
| `caixa.js` | `carregarPaginaHtml`, sangria/suprimento API | Compartilhado ERP/PDV |
| `configuracao_tef.js` | `carregarPaginaHtml('pages/ConfiguracaoTEF.html')` | Somente ERP |
| `configuracoes.js` | `loadPage('pdv')` | Link entre módulos |
| `app.js` | Permissões, implantação, modo fiscal F12 | Core compartilhado |
| Backend | Rotas únicas `/api/*`, SQLite único | Sem alteração de regras |

---

## 2. Nova arquitetura

```
frontend/
├── shared/           # Login, core, controle de acesso
│   ├── login.html
│   └── js/
│       ├── access-control.js
│       ├── core.js
│       └── login.js
├── erp/              # Retaguarda
│   ├── index.html
│   ├── js/           # Módulos administrativos
│   └── pages/        # Fragmentos HTML
└── pdv/              # Frente de caixa
    ├── index.html
    ├── js/
    └── pages/
```

### Pontos de entrada
| Rota | Módulo | Descrição |
|------|--------|-----------|
| `/login` | shared | Login unificado |
| `/erp` | ERP | Retaguarda (protegida) |
| `/pdv` | PDV | Frente de caixa (protegida) |
| `/` | redirect | Redireciona conforme perfil/permissões |

### Electron
| Arquivo | Produto | Comando |
|---------|---------|---------|
| `electron-erp.js` | CDS ERP | `npm run start:erp` |
| `electron-pdv.js` | CDS PDV | `npm run start:pdv` |
| `electron-common.js` | Base compartilhada | IPC, backend, impressão |
| `electron.js` | Compatibilidade (ERP) | `npm start` |

### Builds independentes
| Comando | Saída | Instalador |
|---------|-------|------------|
| `npm run build:erp` | `dist/erp/` | `CDS-ERP-Setup-{version}.exe` |
| `npm run build:pdv` | `dist/pdv/` | `CDS-PDV-Setup-{version}.exe` |

---

## 3. Controle de acesso implementado

| Perfil | Destino após login | Acesso |
|--------|-------------------|--------|
| **Administrador** (`admin`, `ADMIN`, `SUPER_ADMIN`) | `/erp` | ERP + link "Abrir PDV" |
| **Caixa** (`CAIXA` ou operador só com perm. PDV) | `/pdv` | Somente PDV |
| **Operador misto** | `/erp` ou `/pdv` conforme permissões | Filtrado por menu |

- Perfil **`CAIXA`** adicionado em `backend/rotas/auth.js`.
- Instalação PDV envia `?modulo=pdv` no login para priorizar frente de caixa em terminais dedicados.

---

## 4. Arquivos criados

### Frontend
- `frontend/shared/login.html`
- `frontend/shared/js/access-control.js`
- `frontend/shared/js/core.js`
- `frontend/shared/js/login.js`
- `frontend/erp/index.html`
- `frontend/erp/js/app.js`
- `frontend/pdv/index.html`
- `frontend/pdv/js/app.js`
- `frontend/erp/js/*` (20 módulos copiados/organizados)
- `frontend/erp/pages/*` (8 fragmentos HTML)
- `frontend/pdv/js/*` (pdv, caixa, vendas, clientes)
- `frontend/pdv/pages/pdv.html`

### Electron / Build
- `electron-common.js`
- `electron-erp.js`
- `electron-pdv.js`
- `electron-builder-erp.json`
- `electron-builder-pdv.json`

### Documentação
- `RELATORIO_REFATORACAO_ERP_PDV.md` (este arquivo)

---

## 5. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `backend/server.js` | Rotas `/erp`, `/pdv`, login em `shared/`, redirect inteligente em `/` |
| `backend/rotas/auth.js` | Perfil `CAIXA`, permissões padrão para caixa |
| `frontend/index.html` | Redirect para `/` (roteamento por perfil) |
| `frontend/login.html` | Redirect para `/login` unificado |
| `frontend/js/login.js` | Redirect via `/` |
| `frontend/erp/js/configuracoes.js` | Link PDV → `/pdv`, opção perfil Caixa |
| `electron.js` | Delega para `electron-common` (ERP) |
| `package.json` | Scripts `start:erp`, `start:pdv`, `build:erp`, `build:pdv` |

---

## 6. Arquivos mantidos (legado / compatibilidade)

Os arquivos originais em `frontend/js/`, `frontend/*.html` (raiz) **permanecem** para referência e compatibilidade com links antigos servidos estaticamente. O fluxo oficial passa por `/erp` e `/pdv`.

**Não removidos** (podem ser limpos em fase posterior):
- `frontend/js/app.js` (monolito antigo)
- `frontend/pdv.html`, `frontend/dashboard.html`, etc. (raiz)
- Arquivos órfãos: `fechamento-caixa.html`, `duplicata.html`, `pdv-clientes.js`

---

## 7. Módulos por aplicação

### CDS ERP
Dashboard, Produtos, Categorias, Estoque (via Produtos), Compras, Clientes, Fornecedores, Financeiro, Relatórios/Vendas, Fiscal, Configurações, Licença, Auditoria, Fechamento de Caixa, Gerenciar Caixas, Config. Avançadas, TEF (admin).

### CDS PDV
Venda, Consulta de Preço (F1), Clientes, Sangria/Suprimento, Fechamento de Caixa, NFC-e (fluxo de venda), TEF (integrado à venda), Reimpressão de Cupom (histórico vendas).

---

## 8. Possíveis impactos

| Área | Impacto | Mitigação |
|------|---------|-----------|
| Bookmarks `/` antigos | Redirect automático por perfil | Testar login admin e caixa |
| Modo cliente multicaixa | PDV remoto continua via `configuracoes.json` | Usar build PDV + IP servidor |
| Impressão Electron | IPC mantido em `electron-common.js` | Testar cupom NFC-e no PDV |
| TEF reimpressão admin | Permanece em ERP (`configuracao_tef.js`) | PDV usa histórico vendas |
| CSS/ vendor | Paths absolutos `/css`, `/vendor` | Funcionam via static Express |
| Desenvolvimento | Usar `npm run start:erp` ou `start:pdv` | Backend único |

---

## 9. Melhorias recomendadas (próximas fases)

1. **Remover duplicatas legado** — Excluir `frontend/js/app.js` e HTMLs da raiz após período de transição.
2. **Bundle por módulo** — Introduzir Vite/esbuild para tree-shaking e reduzir tamanho do PDV.
3. **API gateway lógico** — Agrupar rotas Express em `/api/erp/*` e `/api/pdv/*` (middleware de escopo).
4. **PDV offline cache** — Catálogo de produtos em IndexedDB para terminais cliente.
5. **Testes E2E separados** — Suites `tests/erp/` e `tests/pdv/`.
6. **Reimpressão dedicada no PDV** — Extrair view simplificada de `vendas.js` sem cancelamento.
7. **Perfil Caixa na UI** — Atalho em Configurações para criar usuário caixa com um clique.
8. **Validação backend de módulo** — Middleware que bloqueie APIs administrativas para token de usuário caixa.

---

## 10. Como testar

```bash
# ERP (servidor + retaguarda)
npm run start:erp

# PDV (servidor + frente de caixa)
npm run start:pdv

# Builds
npm run build:erp   # → dist/erp/CDS-ERP-Setup-*.exe
npm run build:pdv   # → dist/pdv/CDS-PDV-Setup-*.exe
```

### Checklist funcional
- [ ] Login admin → abre `/erp`
- [ ] Login caixa (perfil CAIXA) → abre `/pdv`
- [ ] Caixa não acessa `/erp` (redirect)
- [ ] Admin acessa ERP e link "Abrir PDV"
- [ ] PDV: venda, TEF, NFC-e, sangria, fechamento
- [ ] ERP: produtos, compras, financeiro, fiscal
- [ ] Modo cliente PDV conecta ao servidor remoto

---

## 11. Resumo

A refatoração **separa completamente as interfaces** ERP e PDV sem alterar regras de negócio, API REST ou banco SQLite. O backend permanece único; cada módulo carrega apenas seus scripts, reduzindo acoplamento e permitindo builds Electron independentes (**CDS ERP.exe** e **CDS PDV.exe**).
