-- ─────────────────────────────────────────────────────────────────────────────
-- Recarregar o cache de schema do PostgREST + conferir se as tabelas existem
--
-- Sintoma que motivou: com o schema já exposto, o PostgREST respondia
--   PGRST205 "Could not find the table 'receituarios.tenants' in the schema cache"
--
-- Duas causas possíveis, e a migration anterior não distinguia porque só
-- checava `to_regnamespace('receituarios')` — o namespace pode existir vazio:
--   1. cache de schema velho: o `reload config` da migration anterior recarrega
--      a CONFIG, mas quem redescobre tabelas é `reload schema`;
--   2. as tabelas realmente não existem (migrations 1-7 não rodaram).
--
-- Aqui as duas são tratadas: confere primeiro, recarrega depois.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  esperadas text[] := ARRAY['tenants','usuarios','medicos','lotes','lote_itens','convites','templates','documentos'];
  faltando  text[];
  achadas   int;
BEGIN
  SELECT array_agg(e ORDER BY e)
    INTO faltando
    FROM unnest(esperadas) AS e
   WHERE to_regclass('receituarios.' || quote_ident(e)) IS NULL;

  SELECT count(*) INTO achadas
    FROM pg_tables WHERE schemaname = 'receituarios';

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION
      'Faltam tabelas em receituarios: %. Existem hoje: % tabela(s). '
      'Isso não é cache — as migrations das fases 1-7 não criaram tudo. '
      'Confira o histórico em supabase_migrations.schema_migrations.',
      array_to_string(faltando, ', '), achadas;
  END IF;

  RAISE NOTICE 'As 8 tabelas existem (% no total no schema). Recarregando o cache do PostgREST.', achadas;
END $$;

-- `reload schema` é o que faz o PostgREST redescobrir tabelas e colunas.
-- O `reload config` da migration anterior não cobre isso.
NOTIFY pgrst, 'reload schema';
