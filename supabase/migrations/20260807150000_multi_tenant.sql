-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 7 — Multi-tenant PRÓPRIO dentro do schema receituarios
--
-- Objetivo: vender o módulo para outras clínicas. Cada cliente enxerga só os
-- próprios dados, SEM depender do core da Imago (public.tenants /
-- get_user_tenant_id) — a independência conquistada nas fases 1-3 fica de pé.
--
-- Isto reverte, de propósito, a decisão de "single-tenant por ora" das fases
-- anteriores. O custo previsto lá se paga aqui: uma migration com backfill.
--
-- Modelo: um usuário pertence a UM tenant (a chave de usuarios/medicos é o id
-- do auth.users). Atender a mesma pessoa em duas clínicas exigiria uma tabela
-- de vínculo N:N — não é o caso hoje e não vale a complexidade agora.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Tabela de tenants ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS receituarios.tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_tenants_updated_at ON receituarios.tenants;
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON receituarios.tenants
  FOR EACH ROW EXECUTE FUNCTION receituarios.tocar_updated_at();

-- O tenant da Imago reusa o MESMO uuid de public.tenants. Não há FK entre os
-- dois (são mundos separados de propósito), mas o id igual facilita conferir
-- dado dos dois lados enquanto a Imago e o standalone coexistirem.
--
-- Condicional (Fase 8): só semeia no banco DA IMAGO. Num projeto Supabase novo
-- — uma instalação de outra clínica — não faz sentido nascer um tenant "Clínica
-- Imago"; lá o tenant é criado pelo bootstrap_admin ou por provisionar_tenant.
-- O sinal é o mesmo usado na Fase 2: a existência de public.prescription_jobs.
DO $$
BEGIN
  IF to_regclass('public.prescription_jobs') IS NOT NULL THEN
    INSERT INTO receituarios.tenants (id, nome, slug)
    VALUES ('864440c5-a22c-4bad-9c54-58865f445df4', 'Clínica Imago', 'imago')
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- ── Coluna tenant_id + backfill ──────────────────────────────────────────────
-- Em três passos por tabela: adiciona nullable, preenche, e só então trava com
-- NOT NULL. Assim a migration funciona com dados já dentro.

DO $$
DECLARE
  v_imago uuid := '864440c5-a22c-4bad-9c54-58865f445df4';
  t       text;
BEGIN
  FOREACH t IN ARRAY ARRAY['usuarios','medicos','lotes','lote_itens','convites','templates','documentos']
  LOOP
    EXECUTE format(
      'ALTER TABLE receituarios.%I ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES receituarios.tenants(id) ON DELETE CASCADE',
      t);
    EXECUTE format('UPDATE receituarios.%I SET tenant_id = $1 WHERE tenant_id IS NULL', t) USING v_imago;
    EXECUTE format('ALTER TABLE receituarios.%I ALTER COLUMN tenant_id SET NOT NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_tenant ON receituarios.%I (tenant_id)', t, t);
  END LOOP;
END $$;

-- O código do template passa a ser único POR TENANT: cada clínica tem o seu
-- "anestesia", com as próprias medicações e o próprio bloco de assinatura.
ALTER TABLE receituarios.templates DROP CONSTRAINT IF EXISTS templates_codigo_key;
DROP INDEX IF EXISTS receituarios.templates_codigo_key;
CREATE UNIQUE INDEX IF NOT EXISTS templates_tenant_codigo_key
  ON receituarios.templates (tenant_id, codigo);

-- convites.token continua único GLOBALMENTE: é um segredo sorteado e o link é
-- validado antes de haver sessão, portanto antes de existir tenant conhecido.

-- ── Helper de tenant ─────────────────────────────────────────────────────────
-- SECURITY DEFINER pelo mesmo motivo dos outros: policy em usuarios não pode
-- consultar usuarios sem recursão de RLS.

CREATE OR REPLACE FUNCTION receituarios.tenant_atual()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = receituarios, public
AS $$
  SELECT tenant_id FROM receituarios.usuarios WHERE id = auth.uid() AND ativo
  UNION ALL
  SELECT tenant_id FROM receituarios.medicos  WHERE id = auth.uid() AND ativo
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION receituarios.tenant_atual() TO authenticated, service_role;

-- ── RLS: toda policy ganha o recorte por tenant ──────────────────────────────
-- Recriadas por inteiro (DROP + CREATE) em vez de emendadas, pra não ficar
-- policy antiga sem o filtro convivendo com a nova — o OR entre policies é
-- permissivo e uma sobra deixaria o isolamento furado.

-- usuarios
DROP POLICY IF EXISTS usuarios_select ON receituarios.usuarios;
CREATE POLICY usuarios_select ON receituarios.usuarios
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR (receituarios.eh_admin() AND tenant_id = receituarios.tenant_atual()));

DROP POLICY IF EXISTS usuarios_admin_write ON receituarios.usuarios;
CREATE POLICY usuarios_admin_write ON receituarios.usuarios
  FOR ALL TO authenticated
  USING (receituarios.eh_admin() AND tenant_id = receituarios.tenant_atual())
  WITH CHECK (receituarios.eh_admin() AND tenant_id = receituarios.tenant_atual());

-- medicos
DROP POLICY IF EXISTS medicos_select ON receituarios.medicos;
CREATE POLICY medicos_select ON receituarios.medicos
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR (receituarios.eh_staff() AND tenant_id = receituarios.tenant_atual()));

DROP POLICY IF EXISTS medicos_update_proprio ON receituarios.medicos;
CREATE POLICY medicos_update_proprio ON receituarios.medicos
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR (receituarios.eh_admin() AND tenant_id = receituarios.tenant_atual()))
  WITH CHECK (id = auth.uid() OR (receituarios.eh_admin() AND tenant_id = receituarios.tenant_atual()));

DROP POLICY IF EXISTS medicos_admin_insert ON receituarios.medicos;
CREATE POLICY medicos_admin_insert ON receituarios.medicos
  FOR INSERT TO authenticated
  WITH CHECK (receituarios.eh_admin() AND tenant_id = receituarios.tenant_atual());

DROP POLICY IF EXISTS medicos_admin_delete ON receituarios.medicos;
CREATE POLICY medicos_admin_delete ON receituarios.medicos
  FOR DELETE TO authenticated
  USING (receituarios.eh_admin() AND tenant_id = receituarios.tenant_atual());

-- lotes
DROP POLICY IF EXISTS lotes_select ON receituarios.lotes;
CREATE POLICY lotes_select ON receituarios.lotes
  FOR SELECT TO authenticated
  USING (tenant_id = receituarios.tenant_atual() AND (receituarios.eh_staff() OR medico_id = auth.uid()));

DROP POLICY IF EXISTS lotes_staff_insert ON receituarios.lotes;
CREATE POLICY lotes_staff_insert ON receituarios.lotes
  FOR INSERT TO authenticated
  WITH CHECK (receituarios.eh_staff() AND tenant_id = receituarios.tenant_atual());

DROP POLICY IF EXISTS lotes_update ON receituarios.lotes;
CREATE POLICY lotes_update ON receituarios.lotes
  FOR UPDATE TO authenticated
  USING (tenant_id = receituarios.tenant_atual() AND (receituarios.eh_staff() OR medico_id = auth.uid()))
  WITH CHECK (tenant_id = receituarios.tenant_atual() AND (receituarios.eh_staff() OR medico_id = auth.uid()));

DROP POLICY IF EXISTS lotes_admin_delete ON receituarios.lotes;
CREATE POLICY lotes_admin_delete ON receituarios.lotes
  FOR DELETE TO authenticated
  USING (receituarios.eh_admin() AND tenant_id = receituarios.tenant_atual());

-- lote_itens
DROP POLICY IF EXISTS lote_itens_select ON receituarios.lote_itens;
CREATE POLICY lote_itens_select ON receituarios.lote_itens
  FOR SELECT TO authenticated
  USING (
    tenant_id = receituarios.tenant_atual()
    AND (
      receituarios.eh_staff()
      OR EXISTS (SELECT 1 FROM receituarios.lotes l WHERE l.id = lote_id AND l.medico_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS lote_itens_staff_insert ON receituarios.lote_itens;
CREATE POLICY lote_itens_staff_insert ON receituarios.lote_itens
  FOR INSERT TO authenticated
  WITH CHECK (receituarios.eh_staff() AND tenant_id = receituarios.tenant_atual());

DROP POLICY IF EXISTS lote_itens_update ON receituarios.lote_itens;
CREATE POLICY lote_itens_update ON receituarios.lote_itens
  FOR UPDATE TO authenticated
  USING (
    tenant_id = receituarios.tenant_atual()
    AND (
      receituarios.eh_staff()
      OR EXISTS (SELECT 1 FROM receituarios.lotes l WHERE l.id = lote_id AND l.medico_id = auth.uid())
    )
  )
  WITH CHECK (
    tenant_id = receituarios.tenant_atual()
    AND (
      receituarios.eh_staff()
      OR EXISTS (SELECT 1 FROM receituarios.lotes l WHERE l.id = lote_id AND l.medico_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS lote_itens_admin_delete ON receituarios.lote_itens;
CREATE POLICY lote_itens_admin_delete ON receituarios.lote_itens
  FOR DELETE TO authenticated
  USING (receituarios.eh_admin() AND tenant_id = receituarios.tenant_atual());

-- convites
DROP POLICY IF EXISTS convites_admin_all ON receituarios.convites;
CREATE POLICY convites_admin_all ON receituarios.convites
  FOR ALL TO authenticated
  USING (receituarios.eh_admin() AND tenant_id = receituarios.tenant_atual())
  WITH CHECK (receituarios.eh_admin() AND tenant_id = receituarios.tenant_atual());

-- templates
DROP POLICY IF EXISTS templates_select ON receituarios.templates;
CREATE POLICY templates_select ON receituarios.templates
  FOR SELECT TO authenticated
  USING (tenant_id = receituarios.tenant_atual() AND (receituarios.eh_staff() OR receituarios.eh_medico()));

DROP POLICY IF EXISTS templates_admin_write ON receituarios.templates;
CREATE POLICY templates_admin_write ON receituarios.templates
  FOR ALL TO authenticated
  USING (receituarios.eh_admin() AND tenant_id = receituarios.tenant_atual())
  WITH CHECK (receituarios.eh_admin() AND tenant_id = receituarios.tenant_atual());

-- documentos
DROP POLICY IF EXISTS documentos_select ON receituarios.documentos;
CREATE POLICY documentos_select ON receituarios.documentos
  FOR SELECT TO authenticated
  USING (
    tenant_id = receituarios.tenant_atual()
    AND (
      receituarios.eh_staff()
      OR EXISTS (SELECT 1 FROM receituarios.lotes l WHERE l.id = lote_id AND l.medico_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS documentos_insert ON receituarios.documentos;
CREATE POLICY documentos_insert ON receituarios.documentos
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = receituarios.tenant_atual()
    AND (
      receituarios.eh_staff()
      OR EXISTS (SELECT 1 FROM receituarios.lotes l WHERE l.id = lote_id AND l.medico_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS documentos_admin_delete ON receituarios.documentos;
CREATE POLICY documentos_admin_delete ON receituarios.documentos
  FOR DELETE TO authenticated
  USING (receituarios.eh_admin() AND tenant_id = receituarios.tenant_atual());

-- tenants: cada um enxerga só o próprio; ninguém cria/edita pela API.
-- Provisionar cliente novo é operação de service_role (ver provisionar_tenant).
ALTER TABLE receituarios.tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_select_proprio ON receituarios.tenants;
CREATE POLICY tenants_select_proprio ON receituarios.tenants
  FOR SELECT TO authenticated
  USING (id = receituarios.tenant_atual());

GRANT SELECT ON receituarios.tenants TO authenticated;
GRANT ALL    ON receituarios.tenants TO service_role;

-- ── Bootstrap e provisionamento ──────────────────────────────────────────────

-- O bootstrap continua sendo só da PRIMEIRA instalação (tabela de usuários
-- vazia). Com multi-tenant seria tentador deixar qualquer um criar o próprio
-- tenant, mas o auth.users é compartilhado com a Imago: isso deixaria qualquer
-- funcionário de lá abrir uma clínica no produto. Cliente novo entra por
-- provisionar_tenant, que exige service_role.
CREATE OR REPLACE FUNCTION receituarios.bootstrap_admin(
  p_nome        text DEFAULT NULL,
  p_tenant_nome text DEFAULT NULL
)
RETURNS receituarios.usuarios
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = receituarios, public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_email  text;
  v_tenant uuid;
  v_row    receituarios.usuarios;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'É preciso estar autenticado';
  END IF;
  IF EXISTS (SELECT 1 FROM receituarios.usuarios) THEN
    RAISE EXCEPTION 'Bootstrap já foi feito — peça um convite a um admin';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user;

  -- Se já existe EXATAMENTE um tenant, o admin entra nele em vez de criar
  -- outro. É o caso do banco da Imago: a Fase 2 copiou 46 lotes para o tenant
  -- "Clínica Imago", mas não copiou staff nenhum — então a tabela de usuários
  -- está vazia e o bootstrap roda. Criando um tenant novo, o primeiro admin
  -- entraria num espaço vazio e não enxergaria lote nenhum.
  SELECT id INTO v_tenant FROM receituarios.tenants LIMIT 2;
  IF (SELECT count(*) FROM receituarios.tenants) <> 1 THEN
    v_tenant := NULL;
  END IF;

  IF v_tenant IS NULL THEN
    INSERT INTO receituarios.tenants (nome, slug)
    VALUES (
      coalesce(nullif(p_tenant_nome, ''), 'Minha clínica'),
      'principal-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
    )
    RETURNING id INTO v_tenant;
  END IF;

  INSERT INTO receituarios.usuarios (id, tenant_id, nome, email, papel)
  VALUES (v_user, v_tenant, coalesce(nullif(p_nome, ''), split_part(v_email, '@', 1)), v_email, 'admin')
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION receituarios.bootstrap_admin(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION receituarios.bootstrap_admin(text, text) TO authenticated, service_role;

-- A assinatura antiga de 1 argumento deixaria duas versões conviverem e a
-- chamada do front viraria ambígua.
DROP FUNCTION IF EXISTS receituarios.bootstrap_admin(text);

-- Provisionamento de cliente novo: cria o tenant e devolve um convite de admin.
-- Só service_role — é o backend/você abrindo cliente, nunca a interface.
CREATE OR REPLACE FUNCTION receituarios.provisionar_tenant(
  p_nome text,
  p_slug text
)
RETURNS TABLE (tenant_id uuid, token_convite text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = receituarios, public
AS $$
DECLARE
  v_tenant uuid;
  v_token  text;
BEGIN
  INSERT INTO receituarios.tenants (nome, slug)
  VALUES (p_nome, p_slug)
  RETURNING id INTO v_tenant;

  INSERT INTO receituarios.convites (tenant_id, tipo, expira_em)
  VALUES (v_tenant, 'admin', now() + interval '30 days')
  RETURNING token INTO v_token;

  RETURN QUERY SELECT v_tenant, v_token;
END;
$$;

REVOKE ALL ON FUNCTION receituarios.provisionar_tenant(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION receituarios.provisionar_tenant(text, text) TO service_role;

-- ── Storage ──────────────────────────────────────────────────────────────────
-- FURO FECHADO AQUI: as policies da Fase 1 liberavam o bucket para
-- `eh_staff()` sem olhar tenant nenhum. Como o caminho do arquivo é
-- <lote_id>/…, um staff da clínica B que descobrisse o uuid de um lote da
-- clínica A baixaria o PDF assinado dela. Agora todo acesso passa por um lote
-- do PRÓPRIO tenant.

CREATE OR REPLACE FUNCTION receituarios.pode_acessar_arquivo(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = receituarios, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM receituarios.lotes l
    WHERE l.id::text = split_part(p_name, '/', 1)
      AND l.tenant_id = receituarios.tenant_atual()
      AND (receituarios.eh_staff() OR l.medico_id = auth.uid())
  );
$$;

GRANT EXECUTE ON FUNCTION receituarios.pode_acessar_arquivo(text) TO authenticated, service_role;

DROP POLICY IF EXISTS receituarios_bucket_select ON storage.objects;
CREATE POLICY receituarios_bucket_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'receituarios' AND receituarios.pode_acessar_arquivo(name));

DROP POLICY IF EXISTS receituarios_bucket_insert ON storage.objects;
CREATE POLICY receituarios_bucket_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receituarios' AND receituarios.pode_acessar_arquivo(name));

DROP POLICY IF EXISTS receituarios_bucket_update ON storage.objects;
CREATE POLICY receituarios_bucket_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'receituarios' AND receituarios.pode_acessar_arquivo(name))
  WITH CHECK (bucket_id = 'receituarios' AND receituarios.pode_acessar_arquivo(name));

-- validar_convite passa a devolver também o nome do tenant, pra tela de
-- cadastro dizer em qual clínica a pessoa está entrando.
DROP FUNCTION IF EXISTS receituarios.validar_convite(text);
CREATE OR REPLACE FUNCTION receituarios.validar_convite(p_token text)
RETURNS TABLE (valido boolean, tipo text, tenant_nome text, motivo text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = receituarios, public
AS $$
DECLARE
  v receituarios.convites;
  v_nome text;
BEGIN
  SELECT * INTO v FROM receituarios.convites WHERE token = p_token;

  IF NOT FOUND              THEN RETURN QUERY SELECT false, NULL::text, NULL::text, 'invalido'::text; RETURN; END IF;
  IF v.usado_em IS NOT NULL THEN RETURN QUERY SELECT false, v.tipo,     NULL::text, 'usado'::text;    RETURN; END IF;
  IF v.expira_em < now()    THEN RETURN QUERY SELECT false, v.tipo,     NULL::text, 'expirado'::text; RETURN; END IF;

  SELECT nome INTO v_nome FROM receituarios.tenants WHERE id = v.tenant_id;
  RETURN QUERY SELECT true, v.tipo, v_nome, NULL::text;
END;
$$;

GRANT EXECUTE ON FUNCTION receituarios.validar_convite(text) TO anon, authenticated;
