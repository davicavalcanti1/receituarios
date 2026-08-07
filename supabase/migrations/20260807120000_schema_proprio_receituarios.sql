-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 1 — Schema próprio `receituarios` (single-tenant)
--
-- O módulo deixa de depender do core da Imago (tenants / profiles / user_roles /
-- role_permissions / get_user_tenant_id) e passa a ter tabelas próprias dentro
-- do MESMO projeto Supabase. O que continua compartilhado é o `auth.users` —
-- login e criação de conta seguem no Auth da Imago.
--
-- Consequências dessa escolha, de propósito:
--   • NÃO existe trigger em auth.users aqui. O core da Imago já tem o dele
--     (handle_new_user); um segundo trigger criaria linha em receituarios.*
--     para TODO usuário novo da Imago. O vínculo é explícito (convite/bootstrap).
--   • Sem tenant_id em lugar nenhum. Se um dia houver 2º cliente, volta como
--     migration com backfill.
--
-- Convenções:
--   • Colunas em português (produto próprio). Os VALORES de status ficam em
--     inglês, idênticos aos de hoje (draft/imported/…), para que as telas e os
--     mapas de label da UI não precisem mudar na Fase 3.
--   • Papel do usuário é COLUNA, não tabela separada — mata o bug do
--     .maybeSingle() em user_roles quando o usuário tem mais de uma role.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS receituarios;

-- PostgREST/Supabase precisa enxergar o schema. Além disto, é obrigatório
-- adicionar "receituarios" em Settings → API → Exposed schemas no painel.
GRANT USAGE ON SCHEMA receituarios TO anon, authenticated, service_role;

-- ── Tabelas ──────────────────────────────────────────────────────────────────

-- Staff do módulo (quem monta e administra os lotes).
CREATE TABLE IF NOT EXISTS receituarios.usuarios (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome       text NOT NULL DEFAULT '',
  email      text,
  papel      text NOT NULL DEFAULT 'operador' CHECK (papel IN ('admin', 'operador')),
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Médicos prescritores. Substitui as colunas que hoje moram em public.profiles
-- (crm, especialidade, signature_data, signature_configured_at).
CREATE TABLE IF NOT EXISTS receituarios.medicos (
  id                       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome                     text NOT NULL,
  email                    text,
  crm                      text NOT NULL,
  especialidade            text,
  assinatura_png           text,
  assinatura_atualizada_em timestamptz,
  ativo                    boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_medicos_ativo ON receituarios.medicos (ativo);

-- Lote de receitas (era public.prescription_jobs).
-- Colunas mortas do original que NÃO vieram: template_id, source_reference,
-- notes, reviewer_id, doctor_profile_id (substituída por medico_id).
CREATE TABLE IF NOT EXISTS receituarios.lotes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo                text NOT NULL,
  tipo                  text NOT NULL
                          CHECK (tipo IN ('anestesia_dr_felix', 'longactil', 'procedimentos_dia', 'custom')),
  status                text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'imported', 'review_pending', 'signature_pending',
                                            'partially_signed', 'completed', 'cancelled')),
  origem                text NOT NULL DEFAULT 'manual_import'
                          CHECK (origem IN ('manual_import', 'netris')),
  total_itens           integer NOT NULL DEFAULT 0,
  itens_assinados       integer NOT NULL DEFAULT 0,
  -- Sem FK para medicos: o lote pode ser atribuído antes de o médico aceitar o
  -- convite. A tela já busca o médico em query separada.
  medico_id             uuid,
  criado_por            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enviado_para_assinatura_em timestamptz,
  concluido_em          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lotes_status  ON receituarios.lotes (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lotes_medico  ON receituarios.lotes (medico_id);

-- Item = uma receita (era public.prescription_job_items).
-- Colunas mortas que NÃO vieram: patient_cpf, procedure_code, doctor_document,
-- validation_errors, current_pdf_path, submitted_at, rejected_at.
CREATE TABLE IF NOT EXISTS receituarios.lote_itens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id           uuid NOT NULL REFERENCES receituarios.lotes(id) ON DELETE CASCADE,
  sequencia         integer NOT NULL,
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'validated', 'review_pending', 'signature_pending',
                                        'signed', 'rejected', 'cancelled')),
  paciente_nome     text NOT NULL,
  data_exame        date,
  procedimento      text,
  setor             text,
  medico_nome       text,
  -- LinhaLote completa: é a partir daqui que o PDF é regerado.
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_assinado_path text,
  assinado_em       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lote_id, sequencia)
);
CREATE INDEX IF NOT EXISTS idx_lote_itens_lote ON receituarios.lote_itens (lote_id, sequencia);

-- Convites. Substitui public.medico_invite_tokens e passa a servir também para
-- staff — hoje não existe caminho para convidar quem administra os lotes.
CREATE TABLE IF NOT EXISTS receituarios.convites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token      text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  tipo       text NOT NULL DEFAULT 'medico' CHECK (tipo IN ('medico', 'operador', 'admin')),
  email      text,
  expira_em  timestamptz NOT NULL DEFAULT now() + interval '7 days',
  usado_em   timestamptz,
  usado_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_convites_token ON receituarios.convites (token);

-- ── updated_at ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION receituarios.tocar_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_usuarios_updated_at ON receituarios.usuarios;
CREATE TRIGGER trg_usuarios_updated_at BEFORE UPDATE ON receituarios.usuarios
  FOR EACH ROW EXECUTE FUNCTION receituarios.tocar_updated_at();

DROP TRIGGER IF EXISTS trg_medicos_updated_at ON receituarios.medicos;
CREATE TRIGGER trg_medicos_updated_at BEFORE UPDATE ON receituarios.medicos
  FOR EACH ROW EXECUTE FUNCTION receituarios.tocar_updated_at();

DROP TRIGGER IF EXISTS trg_lotes_updated_at ON receituarios.lotes;
CREATE TRIGGER trg_lotes_updated_at BEFORE UPDATE ON receituarios.lotes
  FOR EACH ROW EXECUTE FUNCTION receituarios.tocar_updated_at();

DROP TRIGGER IF EXISTS trg_lote_itens_updated_at ON receituarios.lote_itens;
CREATE TRIGGER trg_lote_itens_updated_at BEFORE UPDATE ON receituarios.lote_itens
  FOR EACH ROW EXECUTE FUNCTION receituarios.tocar_updated_at();

-- ── Helpers de papel ─────────────────────────────────────────────────────────
-- SECURITY DEFINER de propósito: uma policy em receituarios.usuarios NÃO pode
-- consultar receituarios.usuarios diretamente (recursão infinita de RLS).

CREATE OR REPLACE FUNCTION receituarios.papel_atual()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = receituarios, public
AS $$
  SELECT papel FROM receituarios.usuarios WHERE id = auth.uid() AND ativo;
$$;

CREATE OR REPLACE FUNCTION receituarios.eh_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = receituarios, public
AS $$
  SELECT EXISTS (SELECT 1 FROM receituarios.usuarios WHERE id = auth.uid() AND ativo);
$$;

CREATE OR REPLACE FUNCTION receituarios.eh_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = receituarios, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM receituarios.usuarios
    WHERE id = auth.uid() AND ativo AND papel = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION receituarios.eh_medico()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = receituarios, public
AS $$
  SELECT EXISTS (SELECT 1 FROM receituarios.medicos WHERE id = auth.uid() AND ativo);
$$;

-- ── Bootstrap do primeiro admin ──────────────────────────────────────────────
-- Não dá para usar o padrão "1º usuário do auth vira admin": o auth.users é
-- compartilhado com a Imago e já tem dezenas de contas. Em vez disso, o
-- primeiro usuário LOGADO que chamar esta RPC vira admin — e só enquanto a
-- tabela estiver vazia. Depois disso ela sempre falha.

CREATE OR REPLACE FUNCTION receituarios.bootstrap_admin(p_nome text DEFAULT NULL)
RETURNS receituarios.usuarios
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = receituarios, public
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_email text;
  v_row   receituarios.usuarios;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'É preciso estar autenticado';
  END IF;
  IF EXISTS (SELECT 1 FROM receituarios.usuarios) THEN
    RAISE EXCEPTION 'Bootstrap já foi feito — peça um convite a um admin';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user;

  INSERT INTO receituarios.usuarios (id, nome, email, papel)
  VALUES (v_user, coalesce(nullif(p_nome, ''), split_part(v_email, '@', 1)), v_email, 'admin')
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- REVOKE de PUBLIC tira o EXECUTE default de TODO mundo (service_role incluído),
-- por isso os dois GRANT logo abaixo.
REVOKE ALL ON FUNCTION receituarios.bootstrap_admin(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION receituarios.bootstrap_admin(text) TO authenticated, service_role;

-- ── Validação pública de convite ─────────────────────────────────────────────
-- Substitui a policy `anon` enumerável de medico_invite_tokens: em vez de
-- deixar o anon fazer SELECT na tabela, ele chama esta RPC com o token e
-- recebe só a validade e o tipo. Sem token válido, não vaza nada.

CREATE OR REPLACE FUNCTION receituarios.validar_convite(p_token text)
RETURNS TABLE (valido boolean, tipo text, motivo text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = receituarios, public
AS $$
DECLARE
  v receituarios.convites;
BEGIN
  SELECT * INTO v FROM receituarios.convites WHERE token = p_token;

  -- Casts explícitos: literal sem cast chega como `unknown` e o Postgres
  -- reclama que a estrutura não bate com o RETURNS TABLE.
  IF NOT FOUND               THEN RETURN QUERY SELECT false, NULL::text, 'invalido'::text; RETURN; END IF;
  IF v.usado_em IS NOT NULL  THEN RETURN QUERY SELECT false, v.tipo,     'usado'::text;    RETURN; END IF;
  IF v.expira_em < now()     THEN RETURN QUERY SELECT false, v.tipo,     'expirado'::text; RETURN; END IF;

  RETURN QUERY SELECT true, v.tipo, NULL::text;
END;
$$;

GRANT EXECUTE ON FUNCTION receituarios.validar_convite(text) TO anon, authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- O buraco de hoje: `FOR ALL TO authenticated USING (tenant_id = …)` deixa
-- qualquer autenticado editar e DELETAR qualquer lote, médico incluído.
-- Aqui a permissão é por papel, e o médico só enxerga o que é dele.

ALTER TABLE receituarios.usuarios   ENABLE ROW LEVEL SECURITY;
ALTER TABLE receituarios.medicos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE receituarios.lotes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE receituarios.lote_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE receituarios.convites   ENABLE ROW LEVEL SECURITY;

-- usuarios: cada um lê a si mesmo; admin lê e administra todos.
DROP POLICY IF EXISTS usuarios_select ON receituarios.usuarios;
CREATE POLICY usuarios_select ON receituarios.usuarios
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR receituarios.eh_admin());

DROP POLICY IF EXISTS usuarios_admin_write ON receituarios.usuarios;
CREATE POLICY usuarios_admin_write ON receituarios.usuarios
  FOR ALL TO authenticated
  USING (receituarios.eh_admin())
  WITH CHECK (receituarios.eh_admin());

-- medicos: staff enxerga a lista (para atribuir lote); o médico enxerga a si
-- mesmo e atualiza só a própria assinatura. Cadastro novo entra pelo servidor
-- com service_role (bypassa RLS).
DROP POLICY IF EXISTS medicos_select ON receituarios.medicos;
CREATE POLICY medicos_select ON receituarios.medicos
  FOR SELECT TO authenticated
  USING (receituarios.eh_staff() OR id = auth.uid());

DROP POLICY IF EXISTS medicos_update_proprio ON receituarios.medicos;
CREATE POLICY medicos_update_proprio ON receituarios.medicos
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR receituarios.eh_admin())
  WITH CHECK (id = auth.uid() OR receituarios.eh_admin());

DROP POLICY IF EXISTS medicos_admin_insert ON receituarios.medicos;
CREATE POLICY medicos_admin_insert ON receituarios.medicos
  FOR INSERT TO authenticated
  WITH CHECK (receituarios.eh_admin());

DROP POLICY IF EXISTS medicos_admin_delete ON receituarios.medicos;
CREATE POLICY medicos_admin_delete ON receituarios.medicos
  FOR DELETE TO authenticated
  USING (receituarios.eh_admin());

-- lotes: staff vê tudo; médico só os atribuídos a ele.
DROP POLICY IF EXISTS lotes_select ON receituarios.lotes;
CREATE POLICY lotes_select ON receituarios.lotes
  FOR SELECT TO authenticated
  USING (receituarios.eh_staff() OR medico_id = auth.uid());

DROP POLICY IF EXISTS lotes_staff_insert ON receituarios.lotes;
CREATE POLICY lotes_staff_insert ON receituarios.lotes
  FOR INSERT TO authenticated
  WITH CHECK (receituarios.eh_staff());

-- Médico atualiza o próprio lote (assinar); staff atualiza qualquer um.
DROP POLICY IF EXISTS lotes_update ON receituarios.lotes;
CREATE POLICY lotes_update ON receituarios.lotes
  FOR UPDATE TO authenticated
  USING (receituarios.eh_staff() OR medico_id = auth.uid())
  WITH CHECK (receituarios.eh_staff() OR medico_id = auth.uid());

-- Apagar receituário é ato de auditoria: só admin.
DROP POLICY IF EXISTS lotes_admin_delete ON receituarios.lotes;
CREATE POLICY lotes_admin_delete ON receituarios.lotes
  FOR DELETE TO authenticated
  USING (receituarios.eh_admin());

-- lote_itens: segue a visibilidade do lote pai.
DROP POLICY IF EXISTS lote_itens_select ON receituarios.lote_itens;
CREATE POLICY lote_itens_select ON receituarios.lote_itens
  FOR SELECT TO authenticated
  USING (
    receituarios.eh_staff()
    OR EXISTS (SELECT 1 FROM receituarios.lotes l WHERE l.id = lote_id AND l.medico_id = auth.uid())
  );

DROP POLICY IF EXISTS lote_itens_staff_insert ON receituarios.lote_itens;
CREATE POLICY lote_itens_staff_insert ON receituarios.lote_itens
  FOR INSERT TO authenticated
  WITH CHECK (receituarios.eh_staff());

DROP POLICY IF EXISTS lote_itens_update ON receituarios.lote_itens;
CREATE POLICY lote_itens_update ON receituarios.lote_itens
  FOR UPDATE TO authenticated
  USING (
    receituarios.eh_staff()
    OR EXISTS (SELECT 1 FROM receituarios.lotes l WHERE l.id = lote_id AND l.medico_id = auth.uid())
  )
  WITH CHECK (
    receituarios.eh_staff()
    OR EXISTS (SELECT 1 FROM receituarios.lotes l WHERE l.id = lote_id AND l.medico_id = auth.uid())
  );

DROP POLICY IF EXISTS lote_itens_admin_delete ON receituarios.lote_itens;
CREATE POLICY lote_itens_admin_delete ON receituarios.lote_itens
  FOR DELETE TO authenticated
  USING (receituarios.eh_admin());

-- convites: só admin cria e enxerga. O anon valida pela RPC, nunca pela tabela.
DROP POLICY IF EXISTS convites_admin_all ON receituarios.convites;
CREATE POLICY convites_admin_all ON receituarios.convites
  FOR ALL TO authenticated
  USING (receituarios.eh_admin())
  WITH CHECK (receituarios.eh_admin());

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Sem GRANT o PostgREST devolve 401/permission denied antes mesmo da RLS.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA receituarios TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA receituarios TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA receituarios
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA receituarios
  GRANT ALL ON TABLES TO service_role;

-- ── Storage ──────────────────────────────────────────────────────────────────
-- Bucket próprio. Caminho passa a ser <lote_id>/<arquivo>.pdf (antes era
-- <tenant_id>/<lote_id>/…, e o tenant deixou de existir).

INSERT INTO storage.buckets (id, name, public)
VALUES ('receituarios', 'receituarios', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS receituarios_bucket_select ON storage.objects;
CREATE POLICY receituarios_bucket_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'receituarios'
    AND (
      receituarios.eh_staff()
      OR EXISTS (
        SELECT 1 FROM receituarios.lotes l
        WHERE l.id::text = split_part(name, '/', 1) AND l.medico_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS receituarios_bucket_insert ON storage.objects;
CREATE POLICY receituarios_bucket_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'receituarios'
    AND (
      receituarios.eh_staff()
      OR EXISTS (
        SELECT 1 FROM receituarios.lotes l
        WHERE l.id::text = split_part(name, '/', 1) AND l.medico_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS receituarios_bucket_update ON storage.objects;
CREATE POLICY receituarios_bucket_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'receituarios'
    AND (
      receituarios.eh_staff()
      OR EXISTS (
        SELECT 1 FROM receituarios.lotes l
        WHERE l.id::text = split_part(name, '/', 1) AND l.medico_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    bucket_id = 'receituarios'
    AND (
      receituarios.eh_staff()
      OR EXISTS (
        SELECT 1 FROM receituarios.lotes l
        WHERE l.id::text = split_part(name, '/', 1) AND l.medico_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS receituarios_bucket_delete ON storage.objects;
CREATE POLICY receituarios_bucket_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'receituarios' AND receituarios.eh_admin());
