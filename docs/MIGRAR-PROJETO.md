# Migrar o Receituários para um projeto Supabase próprio

Hoje o módulo roda num schema (`receituarios`) dentro do projeto Supabase da
Imago — `zeaebtdbyscuenkybdiu`, o mesmo usado por `controleoperacional`,
`ocorrencias` e `controle-midia`. Este documento é o caminho para ele virar um
serviço com projeto próprio, como o ExameQR.

> **Estado:** roteiro escrito, **não executado**. Os comandos abaixo não foram
> rodados — não há `supabase` CLI, `psql` nem Docker na máquina onde foi
> escrito. Trate como checklist a conferir, não como script validado.

## Por que fazer

O que ainda depende do projeto compartilhado é o **`auth.users`**. Isso explica
três esquisitices do produto hoje:

- a tela `SemAcesso` existe porque qualquer funcionário da Imago consegue logar;
- o `bootstrap_admin` é travado na primeira instalação por isso — senão qualquer
  um de lá abriria uma clínica no produto;
- vendendo para outra clínica, **os médicos dela teriam conta no Auth da Imago**.

Além disso: incidente no projeto da Imago (quota, rate limit, restore) atinge o
Receituários junto, e backup/restore não é por produto.

## Quando fazer

**Quanto antes, melhor** — o custo está nas contas de usuário, e elas não vão
num dump de schema. Hoje são 2 médicos de teste e o admin. Depois de a clínica
cadastrar médicos de verdade, cada conta vira migração de senha ou convite novo.

**Mas só depois** de aplicar as migrations no projeto atual e rodar um lote de
ponta a ponta. Validar as 4 migrations e mudar de projeto ao mesmo tempo é
depurar duas coisas de uma vez.

## O que torna isso barato

As migrations já rodam sozinhas num banco vazio:

- a da **Fase 2** (cópia dos dados da Imago) tem guard `to_regclass` e passa em
  branco onde não existe `public.prescription_*`;
- o seed dos templates do Dr. Félix/Dr. Igor e o tenant "Clínica Imago" também
  são condicionais — numa instalação limpa não nascem (seria dado de terceiro
  no banco de outro cliente);
- nada mais referencia o core da Imago.

Ou seja: `supabase db push` num projeto novo produz uma instalação **limpa e
vazia**, pronta para `bootstrap_admin()`.

---

## Roteiro

### 1. Criar o projeto e apontar o repo

1. Criar o projeto no painel do Supabase (região `sa-east-1`, mesma da Imago).
2. Em **Settings → API → Exposed schemas**, adicionar `receituarios`.
   Sem isso o PostgREST devolve 404 em tudo.
3. Guardar `Project URL`, `anon key` e `service_role key`.

### 2. Rodar as migrations no projeto novo

```bash
supabase link --project-ref <ref-do-projeto-novo>
supabase db push
```

Resultado esperado: schema `receituarios` completo, **sem** tenant, **sem**
templates, **sem** lotes. A migration da Fase 2 imprime
`public.prescription_jobs não existe — nada a copiar.`

### 3. Copiar os dados (só se quiser levar o histórico)

Não é `INSERT … SELECT` como na Fase 2 — agora são dois bancos diferentes.

```bash
# 1. Dump só do schema do módulo, no projeto ANTIGO, só dados
pg_dump "$URL_ANTIGO" \
  --schema=receituarios --data-only --no-owner --no-privileges \
  --exclude-table-data='receituarios.templates' \
  -f receituarios-dados.sql

# 2. Restaurar no projeto NOVO
psql "$URL_NOVO" -f receituarios-dados.sql
```

Pontos de atenção:

- **Ordem das FKs.** `--data-only` não garante ordem. Se reclamar de FK,
  restaure envolvendo em `SET session_replication_role = replica;` … `= origin;`
  para suspender os triggers de FK durante a carga.
- **`templates` fica de fora** do dump acima de propósito: eles são recriados
  pela migration da Fase 6 quando o banco é o da Imago; num projeto novo você
  provavelmente quer cadastrar do zero. Se quiser levá-los, tire o
  `--exclude-table-data`.
- **`usuarios` e `medicos` referenciam `auth.users`** por FK. O restore falha se
  as contas não existirem antes — ver passo 4.
- **`documentos.gerado_por`, `lotes.criado_por`, `convites.usado_por`** também
  apontam para `auth.users`, mas com `ON DELETE SET NULL`: se a conta não vier,
  o campo fica nulo em vez de quebrar (o dump ainda assim exige a linha, então
  faça o passo 4 primeiro).

### 4. As contas de usuário — a parte que custa

`auth.users` **não** vem no dump do schema `receituarios`. Três caminhos:

| Caminho | Quando usa | Custo |
|---|---|---|
| **Recadastrar por convite** | poucos usuários (é o caso hoje) | cada médico refaz cadastro e redesenha a assinatura |
| **Recriar via Admin API mantendo o UUID** | quer preservar os vínculos sem reconvidar | `auth.admin.createUser` aceita `id`; a senha **não** vai junto — cada um redefine |
| **Migrar o `auth` inteiro** | muitos usuários | copiar `auth.users` entre projetos preserva o hash da senha, mas mexe em schema interno do Supabase e pode quebrar em upgrade. Só com suporte deles |

**Recomendação para agora:** recadastrar. São 2 médicos de teste (que a Fase 2
já marcou como `ativo = false`) e o seu admin.

Se optar por preservar UUIDs, o essencial é que `usuarios.id` / `medicos.id` /
`lotes.medico_id` continuem batendo — são o mesmo uuid do `auth.users`.

### 5. Trocar as variáveis e subir

No EasyPanel:

- **Build Args:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- **Environment:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (+ `NETRIS_*` se
  a integração for continuar ligada)

Rebuild é obrigatório: as `VITE_*` entram no bundle em build time.

### 6. Conferir

- [ ] `/api/health` responde `{"ok":true}`
- [ ] `/api/config` mostra o estado esperado do NetRis
- [ ] login → `SemAcesso` → "Sou o primeiro administrador" cria clínica e admin
- [ ] criar lote por importação manual, atribuir médico, assinar
- [ ] o PDF assinado aparece em `documentos` com hash
- [ ] **teste de isolamento:** `provisionar_tenant('Clínica Teste','teste')`,
      entrar com o convite e confirmar que **não** enxerga os lotes da primeira

### 7. Depois que estiver de pé

No projeto da Imago, o schema `receituarios` vira órfão. Não apague de imediato
— deixe alguns dias como rede de segurança. Quando tiver certeza:

```sql
DROP SCHEMA receituarios CASCADE;
```

As tabelas `public.prescription_*` são outra história: seguem lá como origem
histórica, e só devem sair quando você tiver certeza de que ninguém consulta
mais. Ver `supabase/legado/README.md`.

---

## O que muda no código

Quase nada — foi o objetivo das fases 1 a 7. Só duas coisas ficam **melhores**
depois da mudança, e ambas são simplificações opcionais:

- **`SemAcesso`** deixa de ser o caso comum. Com Auth próprio, quem se cadastra
  só chega via convite, então a tela vira exceção de verdade (convite expirado,
  usuário desativado).
- **`bootstrap_admin`** pode relaxar a trava da "primeira instalação", já que o
  Auth não é mais compartilhado com a Imago. Continua valendo exigir
  `provisionar_tenant` por service_role se você quiser controlar quem abre
  clínica — o que é o normal num SaaS pago.

Nenhuma das duas é obrigatória para a mudança funcionar.
