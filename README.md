# Receituários

Spinoff do módulo **Receituários** do sistema Controle Operacional (Imago), extraído em 04/ago/2026 para virar produto standalone — mesmo modelo do spinoff do Controle de Mídia.

**Origem:** `davicavalcanti1/controleoperacional`, main em `d99db27`. Cópia fiel, sem adaptações — **ainda não é rodável** (ver "Dependências a recriar").

## O que o módulo faz

Emissão de receituários médicos em lote (Anestesia / Longactil EEG / procedimentos do dia):

- **ReceituariosPage** (`/receituarios`) — lista de lotes, download de PDF regenerado do banco, atribuição de médico pra assinatura, botão "Convidar médico" (gera link com token de 7 dias).
- **NovoLoteReceituario** (`/receituarios/novo`) — importação manual (colar planilha, `parseLote`) ou busca de atendimentos no NetRis; gera PDF 2-por-folha (`gerarPdf`, jsPDF) e persiste o lote (`prescription_jobs` + `prescription_job_items` com `row_payload` completo).
- **MedicoPortalPage** (`/receituarios/medico`) — fila de assinatura do médico; aplica a assinatura desenhada (`profiles.signature_data`) nos PDFs.
- **CadastroMedico** (`/cadastro/medico?token=…`) — cadastro público do médico via convite: dados + CRM + assinatura em canvas.
- **server/medico-cadastro.ts** — rota Express pública (`POST /api/public/medico/cadastro`) que valida/consome o token e cria conta+perfil+role com service_role (rate limit 10/h por IP).

## Estrutura

```
src/features/receituarios/   # páginas, service, gerarPdf, parseLote, types
src/pages/CadastroMedico.tsx # cadastro público do médico (era em features/auth do sistema)
server/src/routes/medico-cadastro.ts
supabase/migrations/         # 4 arquivos, ver nota abaixo
```

### Migrations

| Arquivo | Conteúdo |
|---|---|
| `20260526170000_receituarios_initial_structure.sql` | role `medico_prescritor`, bucket `receituarios-pdfs`, tabelas `prescription_*`, RLS por tenant |
| `20260614000000_schema_manual_reconstruido.sql` | **RECONSTRUÇÃO INFERIDA** — no banco da Imago isso foi aplicado à mão, sem migration: `doctor_user_id`, colunas de assinatura em `profiles`, tabela `medico_invite_tokens`. Conferir contra o banco real antes de confiar |
| `20260615000000_medico_rls_fix.sql` | policies pro médico assinar (jobs/items/storage/profile) |
| `20260617000000_add_medico_role.sql` | role `medico` no enum |

As migrations referenciam objetos do core do sistema que **não** vêm neste repo: `tenants`, `profiles`, `user_roles`, `role_permissions`, `get_user_tenant_id()`, trigger de criação de perfil. O scaffolding vai precisar recriá-los (ou re-baselinar tudo, como no controle-midia).

## Dependências a recriar (por que não roda ainda)

Imports `@/` que apontavam pro sistema:

- `@/integrations/supabase/client` — client Supabase
- `@/shared/contexts/AuthContext` — auth + profile + roles
- `@/components/layout/MainLayout`, `PageHeader` — shell
- `@/components/ui/*` — shadcn: badge, button, card, input, textarea, tabs, form
- `@/lib/utils` (cn), `@/lib/logger` (logError), `@/lib/dataBRT` (hojeBRT)
- `@/assets/imago-logo.png` — logo no PDF e nas telas
- `@/services/netris/atendimentos` (buscarAtendimentos) e `@/services/netris/client` (hojeISO, SITUACAO) — **integração NetRis via proxy do backend**; decidir se o produto standalone mantém (vira "integração com RIS" opcional?) ou se a importação fica só manual
- Server: `../lib/supabase.js` (supabaseAdmin), express, zod, express-rate-limit
- NPM: jspdf, @tanstack/react-query, react-hook-form + zod, sonner, date-fns, lucide-react

## Notas de fronteira com o sistema de origem

- Roles `medico_prescritor` e `medico` **continuam existindo no controleoperacional** (compartilhadas com Relatórios Médicos). Só o módulo saiu.
- As tabelas `prescription_*`, `medico_invite_tokens` e o bucket `receituarios-pdfs` **ficaram no banco da Imago** intactos.
- `doctor_user_id` não tem FK pra `profiles` de propósito histórico — o frontend busca o perfil em query separada (`ReceituariosPage.tsx`).
