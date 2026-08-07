-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 6 — Templates no banco + trilha de auditoria do PDF assinado
--
-- Dois problemas distintos:
--
-- 1. TEMPLATES HARDCODED. gerarPdf.ts tinha nome, cargo e CRM do Dr. Félix e do
--    Dr. Igor, mais a lista de medicações, fixos no código. Dados de UM cliente
--    dentro do produto: outra clínica precisaria de um fork. Passam a viver aqui.
--
-- 2. SEM TRILHA DE AUDITORIA. O PDF assinado era enviado ao storage e o caminho
--    gravado no item, mas nada registrava o arquivo em si — e a falha de upload
--    era engolida com um console.warn enquanto o lote virava "completed".
--    Para receituário de CONTROLE ESPECIAL isso é a lacuna mais séria do módulo.
--    `documentos` passa a registrar cada PDF assinado com hash SHA-256, o que
--    torna adulteração detectável.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Templates ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS receituarios.templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo         text NOT NULL UNIQUE,
  nome           text NOT NULL,          -- rótulo na interface
  descricao      text,
  titulo         text NOT NULL DEFAULT 'RECEITUÁRIO INTERNO DE CONTROLE ESPECIAL',
  -- Setor: ou é texto fixo (Longactil), ou é derivado do exame/sala (Anestesia)
  setor_fixo     text,
  derivar_setor  boolean NOT NULL DEFAULT false,
  -- Medicações com checkbox. String vazia = linha em branco para preencher à mão.
  itens          jsonb NOT NULL DEFAULT '[]'::jsonb,
  com_outro      boolean NOT NULL DEFAULT false,   -- acrescenta a linha "OUTRO:____"
  mostrar_medico boolean NOT NULL DEFAULT false,   -- imprime o campo "MÉDICO:"
  -- Bloco de assinatura impresso no PDF SEM assinatura digital.
  -- {"nome": "...", "cargo": "...", "crm": "..."} ou null.
  -- No PDF assinado ele é substituído pelos dados do médico que assinou.
  assinatura     jsonb,
  ativo          boolean NOT NULL DEFAULT true,
  ordem          integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_templates_updated_at ON receituarios.templates;
CREATE TRIGGER trg_templates_updated_at BEFORE UPDATE ON receituarios.templates
  FOR EACH ROW EXECUTE FUNCTION receituarios.tocar_updated_at();

-- Seed: reproduz EXATAMENTE o que estava em gerarPdf.ts, para o PDF sair
-- idêntico ao de hoje. Os códigos batem com lotes.tipo, que já tem 46 linhas.
INSERT INTO receituarios.templates
  (codigo, nome, descricao, setor_fixo, derivar_setor, itens, com_outro, mostrar_medico, assinatura, ordem)
VALUES
  (
    'anestesia_dr_felix',
    'Anestesia Dr. Felix',
    'Receituário de anestesia em lote',
    NULL,
    true,
    '["FENTANIL","FLUMAZENIL","MIDAZOLAM","PROPOFOL","SEVOFLURANO"]'::jsonb,
    true,
    false,
    '{"nome":"FÉLIX SOARES NÓBREGA","cargo":"ANESTESIOLOGISTA","crm":"CRM-PB: 7608"}'::jsonb,
    1
  ),
  (
    'longactil',
    'Longactil',
    'Receituário de Longactil em lote',
    'ELETROENCEFALOGRAMA EM VIGILIA, E SONO ESPONTANEO OU INDUZIDO',
    false,
    '["LONGACTIL","","","",""]'::jsonb,
    false,
    true,
    '{"nome":"IGOR SILVEIRA DE CASTRO GONDIM","cargo":"NEUROLOGISTA","crm":"CRM-PB: 7850"}'::jsonb,
    2
  )
ON CONFLICT (codigo) DO NOTHING;

-- ── Documentos (trilha de auditoria) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS receituarios.documentos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id        uuid NOT NULL REFERENCES receituarios.lotes(id) ON DELETE CASCADE,
  tipo           text NOT NULL DEFAULT 'assinado' CHECK (tipo IN ('assinado', 'original')),
  storage_bucket text NOT NULL DEFAULT 'receituarios',
  storage_path   text NOT NULL,
  nome_arquivo   text NOT NULL,
  tamanho_bytes  bigint,
  -- SHA-256 do arquivo enviado: permite provar depois que o PDF guardado é o
  -- mesmo que foi assinado.
  hash_sha256    text,
  total_receitas integer,
  gerado_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documentos_lote ON receituarios.documentos (lote_id, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE receituarios.templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE receituarios.documentos ENABLE ROW LEVEL SECURITY;

-- Templates: todo mundo com vínculo lê (o médico precisa para gerar o PDF que
-- assina); só admin altera.
DROP POLICY IF EXISTS templates_select ON receituarios.templates;
CREATE POLICY templates_select ON receituarios.templates
  FOR SELECT TO authenticated
  USING (receituarios.eh_staff() OR receituarios.eh_medico());

DROP POLICY IF EXISTS templates_admin_write ON receituarios.templates;
CREATE POLICY templates_admin_write ON receituarios.templates
  FOR ALL TO authenticated
  USING (receituarios.eh_admin())
  WITH CHECK (receituarios.eh_admin());

-- Documentos: mesma visibilidade do lote.
DROP POLICY IF EXISTS documentos_select ON receituarios.documentos;
CREATE POLICY documentos_select ON receituarios.documentos
  FOR SELECT TO authenticated
  USING (
    receituarios.eh_staff()
    OR EXISTS (SELECT 1 FROM receituarios.lotes l WHERE l.id = lote_id AND l.medico_id = auth.uid())
  );

DROP POLICY IF EXISTS documentos_insert ON receituarios.documentos;
CREATE POLICY documentos_insert ON receituarios.documentos
  FOR INSERT TO authenticated
  WITH CHECK (
    receituarios.eh_staff()
    OR EXISTS (SELECT 1 FROM receituarios.lotes l WHERE l.id = lote_id AND l.medico_id = auth.uid())
  );

-- Sem UPDATE para ninguém: registro de auditoria não se edita. Apagar, só admin
-- (e o CASCADE do lote).
DROP POLICY IF EXISTS documentos_admin_delete ON receituarios.documentos;
CREATE POLICY documentos_admin_delete ON receituarios.documentos
  FOR DELETE TO authenticated
  USING (receituarios.eh_admin());

-- ── Grants ───────────────────────────────────────────────────────────────────
-- As tabelas nasceram depois do GRANT da Fase 1; o ALTER DEFAULT PRIVILEGES de
-- lá cobre isso, mas explicitar não custa e protege contra owner diferente.

GRANT SELECT, INSERT, UPDATE, DELETE ON receituarios.templates  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON receituarios.documentos TO authenticated;
GRANT ALL ON receituarios.templates  TO service_role;
GRANT ALL ON receituarios.documentos TO service_role;
