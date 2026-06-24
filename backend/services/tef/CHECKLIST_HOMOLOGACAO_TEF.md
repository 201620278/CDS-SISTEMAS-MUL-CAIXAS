# Checklist de Homologação TEF — CDS Sistemas

**Objetivo:** Integração real CliSiTef ou PayGo com mínimo de alteração de código.

---

## Percentual de prontidão estimado: **~90%**

| Camada | Prontidão |
|--------|-----------|
| Contratos unificados (`tefContrato.js`) | 100% |
| Interface adapters (`BaseAdapter`) | 100% |
| Fluxo único (`TefManager` ← `index.js` ← `/tef/pagar`) | 100% |
| Estrutura CliSiTef real (`sitefRealAdapter.js`) | 85% (falta FFI) |
| Estrutura PayGo real (`paygoRealAdapter.js`) | 85% (falta middleware) |
| Diagnóstico (`GET /api/tef/diagnostico-completo`) | 100% |
| Eventos PinPad (SSE `/api/tef/eventos`) | 90% |
| Conciliação / consulta por adapter | 95% |
| **Ligação SDK real** | **0%** (depende do cliente) |

---

## O QUE ESTÁ PRONTO

- Contrato padronizado em todos os adapters
- `sitefRealAdapter` e `paygoRealAdapter` com pontos de integração documentados
- `sdkDetector` com DLL, INI e serviços Windows
- Idempotência e proteção anti-duplicidade no PDV
- Fluxo fiscal/NF e vendas preservados

---

## O QUE DEPENDE DO CLIENTE

1. Instalar CliSiTef ou PayGo no Windows do caixa
2. PinPad configurado
3. INI com IP do servidor TEF
4. Códigos empresa / loja / terminal

---

## O QUE DEPENDE DO SDK

1. `ffi-napi` + implementação dos blocos `TODO SDK`
2. Loop interativo CliSiTef (`continuarTransacao`)
3. Homologação oficial com adquirente

---

## Endpoints

- `POST /api/tef/pagar` — autorização (TefManager)
- `GET /api/tef/diagnostico-completo` — relatório
- `GET /api/tef/eventos` — SSE PinPad
