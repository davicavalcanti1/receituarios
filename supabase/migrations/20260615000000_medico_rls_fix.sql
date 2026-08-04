-- ─────────────────────────────────────────────────────────────────────────────
-- FIX: Permissões do médico para assinar receituários
--
-- Problemas identificados em 15/jun/2026:
--   1. prescription_jobs_write_tenant (FOR ALL) já cobre UPDATE pelo tenant,
--      mas a policy medico_update_own_jobs (FOR UPDATE via doctor_user_id)
--      pode conflitar dependendo da ordem de avaliação.
--   2. prescription_job_items_write_tenant (FOR ALL) filtra por tenant_id via
--      get_user_tenant_id() — se o perfil do médico não tiver tenant_id gravado
--      corretamente, o UPDATE nos itens é bloqueado.
--   3. Storage bucket receituarios-pdfs: a policy de INSERT usa
--      split_part(name,'/1') = get_user_tenant_id() — médico precisa estar
--      no tenant correto.
--   4. A role 'medico' precisa de permissão de UPDATE em profiles para
--      salvar a assinatura no próprio perfil.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Recriar policy de UPDATE de prescription_jobs para o médico
--    Usa OR com a policy de tenant pra cobrir ambos os casos
DROP POLICY IF EXISTS "medico_update_own_jobs" ON public.prescription_jobs;
CREATE POLICY "medico_update_own_jobs" ON public.prescription_jobs
  FOR UPDATE TO authenticated
  USING (
    doctor_user_id = auth.uid()
  )
  WITH CHECK (
    doctor_user_id = auth.uid()
  );

-- 2. Recriar policy de UPDATE de prescription_job_items para o médico
--    Médico atualiza itens do lote quando assina
DROP POLICY IF EXISTS "medico_update_own_items" ON public.prescription_job_items;
CREATE POLICY "medico_update_own_items" ON public.prescription_job_items
  FOR UPDATE TO authenticated
  USING (
    job_id IN (
      SELECT id FROM public.prescription_jobs
      WHERE doctor_user_id = auth.uid()
    )
  )
  WITH CHECK (
    job_id IN (
      SELECT id FROM public.prescription_jobs
      WHERE doctor_user_id = auth.uid()
    )
  );

-- 3. Garantir que o médico pode atualizar seu próprio perfil (assinatura)
--    A policy padrão de profiles pode bloquear UPDATE para roles não-admin
DROP POLICY IF EXISTS "medico_update_own_profile" ON public.profiles;
CREATE POLICY "medico_update_own_profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 4. Storage: garantir que o médico pode fazer INSERT/UPDATE no bucket
--    A policy existente usa get_user_tenant_id() — reforçamos com uma
--    policy alternativa que usa profiles diretamente
DROP POLICY IF EXISTS "receituarios_pdfs_medico_insert" ON storage.objects;
CREATE POLICY "receituarios_pdfs_medico_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'receituarios-pdfs'
    AND split_part(name, '/', 1) = (
      SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "receituarios_pdfs_medico_update" ON storage.objects;
CREATE POLICY "receituarios_pdfs_medico_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'receituarios-pdfs'
    AND split_part(name, '/', 1) = (
      SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'receituarios-pdfs'
    AND split_part(name, '/', 1) = (
      SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid()
    )
  );

-- 5. Garantir que o médico pode ler os itens do seu lote
DROP POLICY IF EXISTS "medico_select_own_items" ON public.prescription_job_items;
CREATE POLICY "medico_select_own_items" ON public.prescription_job_items
  FOR SELECT TO authenticated
  USING (
    job_id IN (
      SELECT id FROM public.prescription_jobs
      WHERE doctor_user_id = auth.uid()
         OR tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    )
  );

-- 6. Garantir que o médico pode ler lotes atribuídos a ele
DROP POLICY IF EXISTS "medico_select_own_jobs" ON public.prescription_jobs;
CREATE POLICY "medico_select_own_jobs" ON public.prescription_jobs
  FOR SELECT TO authenticated
  USING (
    doctor_user_id = auth.uid()
    OR tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );
