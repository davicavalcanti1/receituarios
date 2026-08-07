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

| Arquivo | Fase |
|---|---|
| `20260807120000_schema_proprio_receituarios.sql` | **1** — cria o schema `receituarios`, corta a dependência do core da Imago |
| `20260807130000_copia_dados_da_imago.sql` | **2** — copia `public.prescription_*` → `receituarios.*` |

As 4 migrations antigas (schema `public`, era controleoperacional) foram movidas para `supabase/legado/` — já estão aplicadas no banco da Imago por outro repositório e não devem ser reaplicadas daqui. Ver `supabase/legado/README.md`.

## Independência (Fase 1 — 07/ago/2026)

O módulo passa a viver no schema Postgres **`receituarios`**, dentro do mesmo projeto Supabase da Imago. Some a dependência de `tenants`, `profiles`, `user_roles`, `role_permissions` e `get_user_tenant_id()`.

**Continua compartilhado:** o `auth.users`. Login e criação de conta seguem no Auth da Imago, e o trigger `handle_new_user` do core continua criando uma linha em `public.profiles` para todo usuário novo — inclusive médicos que se cadastrarem aqui. A independência é de schema e dados, não de auth.

| Antes (`public`) | Agora (`receituarios`) |
|---|---|
| `profiles` (crm, especialidade, signature_data…) | `medicos` |
| `user_roles` + enum `app_role` | coluna `papel` em `usuarios` (`admin`/`operador`) |
| `prescription_jobs` | `lotes` |
| `prescription_job_items` | `lote_itens` |
| `medico_invite_tokens` | `convites` (agora serve médico **e** staff) |
| `prescription_templates` / `_procedure_mappings` / `_outputs` | não vieram — estavam com 0 linhas |
| bucket `receituarios-pdfs`, path `<tenant>/<lote>/…` | bucket `receituarios`, path `<lote>/…` |

Colunas em português; os **valores** de status seguem em inglês (`draft`, `imported`, `signature_pending`, `completed`…), idênticos aos de hoje, para não mexer nos mapas de label da UI.

**RLS de verdade, por papel** (antes qualquer autenticado editava e deletava qualquer lote): staff vê todos os lotes, médico só os atribuídos a ele, delete só admin. Os helpers `eh_staff()`/`eh_admin()`/`eh_medico()` são `SECURITY DEFINER` de propósito — uma policy em `usuarios` não pode consultar `usuarios` sem recursão infinita.

**Primeiro admin:** não dá para usar o padrão "1º usuário do auth vira admin" — o `auth.users` é compartilhado e já tem dezenas de contas da Imago. Em vez disso, o primeiro usuário **logado** que chamar a RPC `receituarios.bootstrap_admin()` vira admin, e só enquanto a tabela `usuarios` estiver vazia.

**Convite:** a policy `anon` enumerável saiu. O cadastro público valida pela RPC `receituarios.validar_convite(token)`, que devolve só validade e tipo.

## Cópia dos dados (Fase 2 — 07/ago/2026)

`INSERT … SELECT` dentro do mesmo banco: nada de export, nada de recriar usuário. **Os UUIDs são preservados**, inclusive os de `auth.users`, então autoria e atribuição de médico ficam intactas. Idempotente (`ON CONFLICT (id) DO NOTHING`) e **não apaga nada** em `public.*` — a Imago continua rodando até a Fase 4.

Estado da origem conferido antes de escrever: 46 lotes / 603 itens, **tenant único**, todo `source_type` = `manual_import`, status de item só `draft`/`signed`.

- **Médicos** entram com **`ativo = false`**. Os 2 cadastros são de teste, mas 14 lotes (10 assinados) apontam para eles — sem a linha, o histórico perde nome, CRM e assinatura. Inativos, aparecem no histórico e ficam fora do seletor de atribuição.
- **Staff (`usuarios`) não é copiado** — não há mapeamento confiável das roles da Imago para `admin`/`operador`. Entra pelo `bootstrap_admin()` e por convite.
- `templates` / `procedure_mappings` / `outputs` não são copiados: **0 linhas** na origem.
- O tenant é **derivado dos lotes**, não hardcoded. Se aparecer mais de um, a migration aborta em vez de misturar dados.
- **`pdf_assinado_path` aponta para o bucket antigo.** SQL não copia blob de storage, então os arquivos não são movidos. Hoje nenhuma tela lê essa coluna (o PDF é sempre regerado do `payload`), então não quebra nada — persistência real fica para a Fase 6.
- No fim, confere as contagens e **falha** se faltou linha.

### Para aplicar

1. `supabase db push` (ou aplicar as migrations pelo painel), **na ordem** — a Fase 2 depende do schema da Fase 1.
2. **Obrigatório:** adicionar `receituarios` em Settings → API → **Exposed schemas** (hoje estão expostos `public`, `graphql_public`, `controlemidia`). Sem isso o PostgREST não enxerga nada e toda query volta 404.
3. Logar com o usuário que será admin e chamar `bootstrap_admin()`.

## O app apontado pro schema novo (Fase 3 — 07/ago/2026)

O client Supabase passou a usar `db: { schema: "receituarios" }` — isso vale só para PostgREST; auth e storage não são afetados.

**O papel do usuário mudou de fonte.** Não vem mais de `public.user_roles` (que aceitava N linhas por usuário e quebrava com `.maybeSingle()`), e sim de **qual tabela contém o usuário**: `usuarios` → staff (`admin`/`operador`), `medicos` → médico. Isso também elimina os dois conceitos de médico que conviviam (`medico` e `medico_prescritor`, com telas diferentes) — agora é um só.

**Nova tela `SemAcesso`.** Estar autenticado não basta: o `auth.users` é compartilhado com a Imago, então qualquer usuário de lá consegue logar aqui. Quem não tem vínculo com o módulo cai nessa tela — que é também o único caminho de entrada do primeiro admin (botão que chama `bootstrap_admin()`).

**Duas dependências do core que só apareceram ao mexer no código:**
- `sys_notifications` (avisava o médico ao atribuir lote) — **removida**. É tabela do core da Imago e o standalone não tem central de notificações; o lote aparece na caixa de entrada do médico assim que é atribuído.
- `prescription_templates`, usada só pelo `getOverview()` do service — **removido junto**, era código morto (nenhuma tela chamava, e a tabela tem 0 linhas).

**Dois bugs corrigidos de passagem**, porque estavam nas linhas alteradas:
- abrir um lote disparava o `UPDATE` de status **duas vezes** (StrictMode + re-render) — agora tem guard por `ref`;
- `AuthContext` usava `.maybeSingle()` em `user_roles`, que estourava se o usuário tivesse mais de uma role.

Typecheck limpo no front e no server; `npm run build` passa.

## NetRis opcional (Fase 5 — 07/ago/2026)

A integração deixou de ser obrigatória: **o núcleo do produto funciona só com importação manual** (colar planilha / `.csv`), que é o caminho principal. O NetRis fica atrás de configuração.

- **Ligado/desligado é decisão de runtime, não de build.** `GET /api/config` devolve `{ integracoes: { netris: bool } }` a partir de `NETRIS_BASE_URL` + `NETRIS_TOKEN`. Antes isso dependia de `VITE_*` embutida no bundle, então ligar ou desligar exigia **rebuildar a imagem**; agora é env var + restart.
- Sem a integração, a aba "Buscar por data" **não é renderizada** e `/api/netris/*` responde **503** com explicação, em vez de um 500 genérico.
- O frontend não precisa mais de **nenhuma** variável do NetRis: `VITE_NETRIS_FILIAL_ID` saiu do `.env.example` e dos Build Args do Dockerfile. Quem resolve a filial é o servidor, pela `NETRIS_FILIAL_ID`.
- Se `/api/config` falhar, o padrão é integração **desligada** — o núcleo continua funcionando.

Testado nos dois modos: desligado → `{"netris":false}` e 503 na rota; ligado → `{"netris":true}` e 401 (auth ainda guardando), não 503.

---

## Fase 4 (concluída 07/ago/2026)

`chore-spinoff-receituarios` mergeada na main do controleoperacional (`8231143`): o módulo saiu do sistema da Imago (−2.591 linhas, zero import órfão). A CI de lá **não faz deploy** — só lint/build/typecheck —, então o merge não tirou nada do ar; o que tira é o redeploy manual no EasyPanel.

> ⚠️ **Não redeployar a Imago** antes de validar este standalone contra o banco: hoje o sistema no ar ainda emite receituários gravando em `public.prescription_*`.

## Fase 0 — o que foi recriado (04/ago/2026)

Todas as dependências `@/` que apontavam pro sistema de origem existem de novo aqui:

- `@/integrations/supabase/client` — client próprio (sem xhrFetch, não há TVs antigas)
- `@/shared/contexts/AuthContext` — copiado do controle-midia + campo `tenant` (derivado de `profile.tenant_id`, mesma interface do sistema de origem)
- `@/components/layout/MainLayout` — **shell próprio leve** (topbar com logo + Sair), mesma interface de props do original, então as páginas não mudaram; `PageHeader` copiado verbatim
- `@/components/ui/*` — shadcn copiados do sistema: button, badge, card, input, textarea, tabs, table, form, label
- `@/lib/utils` (cn), `@/lib/logger`, `@/lib/dataBRT` — copiados verbatim
- `@/assets/imago-logo.png` + `index.css`/`tailwind.config.ts` — design system Imago completo (tokens HSL, Public Sans)
- `@/services/netris/*` — copiados verbatim. A aba "Buscar por data" funciona: o server expõe `GET /api/netris/atendimentos` (porte mínimo do backend de origem — paginação, chunks semanais paralelos, dedup, cache em memória 3min, auth por Bearer Supabase). O token NetRis fica só no server (`NETRIS_BASE_URL`/`NETRIS_TOKEN`). As demais funções do netris (`alterarSituacao` etc.) chamam `/api/netris/proxy/*`, que NÃO foi portado — nenhuma tela deste produto usa
- `src/pages/Login.tsx` — login e-mail+senha novo (o sistema de origem usava o Auth compartilhado)
- `server/` — Express mínimo: `/api/health` + `/api/public/medico/cadastro` (json limit 2mb por causa da assinatura base64). Testado contra o banco real: token inválido → 400

Rotas: `/login`, `/cadastro/medico?token=…`, `/receituarios`, `/receituarios/novo`, `/receituarios/medico`.

Mudanças mínimas nos arquivos copiados (só pra compilar): tipo `especialidade` no perfil do MedicoPortal, import `Situacao` inexistente removido do netris/atendimentos.

## Deploy (EasyPanel)

Container único: o Express serve a API **e** o build do Vite (porta **3001**).

- **Build Args** (Vite precisa em build time): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_NETRIS_FILIAL_ID` (opcional, default 1)
- **Environment** (runtime): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NETRIS_BASE_URL`, `NETRIS_TOKEN`, `NETRIS_FILIAL_ID`
- O `.env` local fica fora do contexto de propósito (`.dockerignore`) — senão o Vite ignora os Build Args.

## Notas de fronteira com o sistema de origem

- Roles `medico_prescritor` e `medico` **continuam existindo no controleoperacional** (compartilhadas com Relatórios Médicos). Só o módulo saiu.
- As tabelas `prescription_*`, `medico_invite_tokens` e o bucket `receituarios-pdfs` **ficaram no banco da Imago** intactos.
- `doctor_user_id` não tem FK pra `profiles` de propósito histórico — o frontend busca o perfil em query separada (`ReceituariosPage.tsx`).
