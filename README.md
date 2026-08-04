# Receituários

Spinoff do módulo **Receituários** do sistema Controle Operacional (Imago), extraído em 04/ago/2026 para virar produto standalone — mesmo modelo do spinoff do Controle de Mídia.

**Origem:** `davicavalcanti1/controleoperacional`, main em `d99db27`.

**Status: Fase 0 (scaffolding) concluída — o app RODA.** `npm run dev` (frontend em :5173) + `npm run server` (Express em :3001, proxy `/api` já configurado no Vite). Aponta pro Supabase da Imago via `.env` (gitignored — copiar de `.env.example`; server tem o próprio `server/.env` com a service role).

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

## Fase 0 — o que foi recriado (04/ago/2026)

Todas as dependências `@/` que apontavam pro sistema de origem existem de novo aqui:

- `@/integrations/supabase/client` — client próprio (sem xhrFetch, não há TVs antigas)
- `@/shared/contexts/AuthContext` — copiado do controle-midia + campo `tenant` (derivado de `profile.tenant_id`, mesma interface do sistema de origem)
- `@/components/layout/MainLayout` — **shell próprio leve** (topbar com logo + Sair), mesma interface de props do original, então as páginas não mudaram; `PageHeader` copiado verbatim
- `@/components/ui/*` — shadcn copiados do sistema: button, badge, card, input, textarea, tabs, table, form, label
- `@/lib/utils` (cn), `@/lib/logger`, `@/lib/dataBRT` — copiados verbatim
- `@/assets/imago-logo.png` + `index.css`/`tailwind.config.ts` — design system Imago completo (tokens HSL, Public Sans)
- `@/services/netris/*` — **copiados verbatim**; compilam, mas a aba "Buscar por data" chama `/api/netris/proxy`, que este server ainda NÃO expõe → erro em runtime. Decisão da Fase 1: virar "integração com RIS" opcional (portar o proxy) ou cair pra importação só manual
- `src/pages/Login.tsx` — login e-mail+senha novo (o sistema de origem usava o Auth compartilhado)
- `server/` — Express mínimo: `/api/health` + `/api/public/medico/cadastro` (json limit 2mb por causa da assinatura base64). Testado contra o banco real: token inválido → 400

Rotas: `/login`, `/cadastro/medico?token=…`, `/receituarios`, `/receituarios/novo`, `/receituarios/medico`.

Mudanças mínimas nos arquivos copiados (só pra compilar): tipo `especialidade` no perfil do MedicoPortal, import `Situacao` inexistente removido do netris/atendimentos.

## Notas de fronteira com o sistema de origem

- Roles `medico_prescritor` e `medico` **continuam existindo no controleoperacional** (compartilhadas com Relatórios Médicos). Só o módulo saiu.
- As tabelas `prescription_*`, `medico_invite_tokens` e o bucket `receituarios-pdfs` **ficaram no banco da Imago** intactos.
- `doctor_user_id` não tem FK pra `profiles` de propósito histórico — o frontend busca o perfil em query separada (`ReceituariosPage.tsx`).
