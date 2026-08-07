-- ─────────────────────────────────────────────────────────────────────────────
-- Configuração da integração NetRis no banco, não em variável de ambiente
--
-- Antes: NETRIS_BASE_URL / NETRIS_TOKEN / NETRIS_FILIAL_ID viviam no env do
-- servidor — trocar o token exigia mexer no EasyPanel e reiniciar. Passa para
-- cá, editável pela tela de Configurações → Integração.
--
-- SEGURANÇA: o token é segredo. Esta tabela NÃO tem policy de SELECT para
-- `authenticated` — com RLS ligada e nenhuma policy, ninguém logado lê nada
-- daqui pela API. Só o service_role (servidor) enxerga. A tela usa a RPC
-- `integracao_netris_status()`, que devolve se está configurado e a URL, mas
-- NUNCA o token.
--
-- O env continua valendo como fallback: se não houver linha aqui, o servidor
-- usa as variáveis de ambiente como antes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS receituarios.integracoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES receituarios.tenants(id) ON DELETE CASCADE,
  provedor      text NOT NULL DEFAULT 'netris' CHECK (provedor IN ('netris')),
  ativo         boolean NOT NULL DEFAULT false,
  base_url      text,
  token         text,
  filial_id     text NOT NULL DEFAULT '1',
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provedor)
);

ALTER TABLE receituarios.integracoes ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy para `authenticated`: RLS ligada sem policy = ninguém logado
-- lê nem escreve pela API. É de propósito — o token sai só pelo servidor.
GRANT ALL ON receituarios.integracoes TO service_role;
REVOKE ALL ON receituarios.integracoes FROM authenticated, anon;

-- Status sem segredo, para a tela mostrar o estado da conexão.
CREATE OR REPLACE FUNCTION receituarios.integracao_netris_status()
RETURNS TABLE (ativo boolean, base_url text, filial_id text, token_configurado boolean, atualizado_em timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = receituarios, public
AS $$
BEGIN
  IF NOT receituarios.eh_admin() THEN
    RAISE EXCEPTION 'Só administradores veem a configuração de integração';
  END IF;

  RETURN QUERY
  SELECT i.ativo, i.base_url, i.filial_id, (i.token IS NOT NULL AND i.token <> ''), i.atualizado_em
    FROM receituarios.integracoes i
   WHERE i.tenant_id = receituarios.tenant_atual()
     AND i.provedor = 'netris';
END;
$$;

REVOKE ALL ON FUNCTION receituarios.integracao_netris_status() FROM public, anon;
GRANT EXECUTE ON FUNCTION receituarios.integracao_netris_status() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
