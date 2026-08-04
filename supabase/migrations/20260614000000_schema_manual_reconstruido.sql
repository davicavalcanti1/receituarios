-- ─────────────────────────────────────────────────────────────────────────────
-- RECONSTRUÇÃO de schema que foi aplicado À MÃO no banco da Imago (sem migration).
-- Shape INFERIDO do código em 04/ago/2026 — conferir contra o banco real antes
-- de usar em produção nova. Objetos cobertos:
--   1. prescription_jobs.doctor_user_id (usado por ReceituariosPage/MedicoPortal;
--      sem FK para profiles — o código busca o perfil separado por causa disso)
--   2. profiles: crm, especialidade, signature_data, signature_configured_at
--      (preenchidos pelo cadastro do médico via server/medico-cadastro.ts)
--   3. medico_invite_tokens (convite gerado no ReceituariosPage inserindo só
--      tenant_id — token e expires_at têm DEFAULT; "válido por 7 dias")
-- Datada ANTES de 20260615000000_medico_rls_fix.sql, que referencia doctor_user_id.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.prescription_jobs
  ADD COLUMN IF NOT EXISTS doctor_user_id uuid;

CREATE INDEX IF NOT EXISTS idx_prescription_jobs_doctor
  ON public.prescription_jobs (doctor_user_id);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS crm text,
  ADD COLUMN IF NOT EXISTS especialidade text,
  ADD COLUMN IF NOT EXISTS signature_data text,
  ADD COLUMN IF NOT EXISTS signature_configured_at timestamptz;

CREATE TABLE IF NOT EXISTS public.medico_invite_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  used_at    timestamptz,
  used_by    uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.medico_invite_tokens ENABLE ROW LEVEL SECURITY;

-- Admin/staff do tenant gera e consulta convites pela UI; a validação/consumo
-- no cadastro público passa pelo backend com service_role (bypassa RLS).
DROP POLICY IF EXISTS "medico_invite_tokens_select_tenant" ON public.medico_invite_tokens;
CREATE POLICY "medico_invite_tokens_select_tenant" ON public.medico_invite_tokens
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "medico_invite_tokens_insert_tenant" ON public.medico_invite_tokens;
CREATE POLICY "medico_invite_tokens_insert_tenant" ON public.medico_invite_tokens
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));
