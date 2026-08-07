-- ─────────────────────────────────────────────────────────────────────────────
-- Garante a versão CORRETA de bootstrap_admin
--
-- A correção original foi feita editando a migration da Fase 7 (20260807150000),
-- partindo do princípio de que ela ainda não tinha sido aplicada. Como as
-- migrations foram aplicadas e não dá para saber de fora qual versão entrou (as
-- duas têm a mesma assinatura, muda só a lógica interna), esta migration
-- reaplica a versão correta. É idempotente: inofensiva se já estiver certa.
--
-- O bug que ela corrige: bootstrap_admin criava um tenant NOVO sempre. Neste
-- banco isso quebraria o caso principal — a Fase 2 copiou 46 lotes para o
-- tenant "Clínica Imago", mas não copiou staff nenhum, então `usuarios` está
-- vazia e o bootstrap roda. Criando outro tenant, o primeiro admin entraria num
-- espaço vazio e veria ZERO lotes, sem erro nenhum aparente.
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- Existindo EXATAMENTE um tenant, o admin entra nele em vez de criar outro.
  SELECT id INTO v_tenant FROM receituarios.tenants LIMIT 1;
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

DO $$
DECLARE v_tenants int;
BEGIN
  SELECT count(*) INTO v_tenants FROM receituarios.tenants;
  RAISE NOTICE 'bootstrap_admin garantido. Tenants no banco: % — com 1, o primeiro admin entra nele.', v_tenants;
END $$;

NOTIFY pgrst, 'reload schema';
