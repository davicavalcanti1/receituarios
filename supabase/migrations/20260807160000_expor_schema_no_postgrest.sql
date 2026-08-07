-- ─────────────────────────────────────────────────────────────────────────────
-- Expor o schema `receituarios` no PostgREST por SQL
--
-- O caminho normal é o painel (Settings → API → Exposed schemas). Esta migration
-- faz o mesmo por SQL, para quando o painel não estiver acessível ou não salvar.
--
-- Como funciona: o PostgREST do Supabase lê a lista de schemas do parâmetro
-- `pgrst.db_schemas` da role `authenticator`. Alterar a role e mandar um
-- `NOTIFY pgrst, 'reload config'` recarrega sem reiniciar nada.
--
-- ATENÇÃO: o painel continua sendo a fonte de verdade. Se alguém abrir aquela
-- tela e salvar sem `receituarios` na lista, isto é sobrescrito. Vale conferir
-- lá depois que funcionar.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_cfg text;
BEGIN
  -- Diagnóstico primeiro: se o schema não existe, o problema nunca foi o
  -- painel — foram as migrations anteriores que não rodaram.
  IF to_regnamespace('receituarios') IS NULL THEN
    RAISE EXCEPTION 'O schema "receituarios" não existe neste banco. '
                    'As migrations das fases 1-7 não foram aplicadas (ou falharam). '
                    'Exponha nada — rode as migrations primeiro.';
  END IF;

  -- Lê a lista atual da role em vez de assumir uma: sobrescrever com uma lista
  -- chutada derrubaria o `controlemidia`, que já está exposto e em uso.
  SELECT coalesce(
    (SELECT split_part(c, '=', 2)
       FROM pg_roles r, unnest(r.rolconfig) AS c
      WHERE r.rolname = 'authenticator'
        AND c LIKE 'pgrst.db_schemas=%'
      LIMIT 1),
    'public, graphql_public'
  ) INTO v_cfg;

  IF v_cfg ~ '(^|,)\s*receituarios\s*(,|$)' THEN
    RAISE NOTICE 'Schema receituarios já estava exposto: %', v_cfg;
  ELSE
    EXECUTE format('ALTER ROLE authenticator SET pgrst.db_schemas = %L', v_cfg || ', receituarios');
    RAISE NOTICE 'Exposto. Lista agora: %', v_cfg || ', receituarios';
  END IF;
END $$;

-- Recarrega a config do PostgREST (não derruba conexão).
NOTIFY pgrst, 'reload config';
