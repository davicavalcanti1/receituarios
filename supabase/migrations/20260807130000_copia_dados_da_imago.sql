-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 2 — Cópia dos dados de public.prescription_* para o schema receituarios
--
-- Roda DENTRO do mesmo banco, então é INSERT … SELECT puro: nada de export,
-- nada de recriar usuário. Os UUIDs são preservados — inclusive os de
-- auth.users — o que mantém autoria e atribuição de médico intactas.
--
-- Idempotente: tudo com ON CONFLICT (id) DO NOTHING. Rodar duas vezes não
-- duplica nada. NÃO apaga nada em public.* — a Imago continua usando aquelas
-- tabelas até a Fase 4.
--
-- Estado do banco conferido em 07/ago/2026 antes de escrever:
--   • 46 lotes / 603 itens, tenant único (864440c5-…), todo source_type
--     'manual_import', status de item só 'draft' e 'signed'
--   • prescription_templates / _procedure_mappings / _outputs com ZERO linhas
--     → não são copiados, o schema novo nem tem equivalente
--   • 14 lotes com médico atribuído (12 + 2), dos 2 únicos médicos existentes
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_tenant   uuid;
  v_medicos  int;
  v_lotes    int;
  v_itens    int;
  v_convites int;
BEGIN
  -- Num banco que não seja o da Imago (ou depois da Fase 4, se as tabelas
  -- forem removidas) não há nada a copiar — a migration passa em branco em vez
  -- de estourar.
  IF to_regclass('public.prescription_jobs') IS NULL THEN
    RAISE NOTICE 'Fase 2: public.prescription_jobs não existe — nada a copiar.';
    RETURN;
  END IF;

  -- Single-tenant: o tenant é derivado dos próprios lotes, não hardcoded.
  -- Se algum dia houver mais de um, é melhor falhar do que misturar dados de
  -- clientes diferentes num schema que não tem mais coluna de tenant.
  SELECT DISTINCT tenant_id INTO v_tenant FROM public.prescription_jobs;

  IF v_tenant IS NULL THEN
    RAISE NOTICE 'Fase 2: nenhum lote a copiar.';
    RETURN;
  END IF;

  IF (SELECT count(DISTINCT tenant_id) FROM public.prescription_jobs) > 1 THEN
    RAISE EXCEPTION 'Fase 2 abortada: há mais de um tenant em prescription_jobs. '
                    'O schema receituarios é single-tenant — decida qual migrar.';
  END IF;

  -- ── 1. Médicos ─────────────────────────────────────────────────────────────
  -- Copiados com ativo = FALSE de propósito. Os 2 cadastros existentes são de
  -- teste, mas 14 lotes (10 deles assinados) apontam para eles: sem a linha, as
  -- telas perdem nome, CRM e assinatura do histórico. Inativos, aparecem no
  -- histórico e ficam fora do seletor de atribuição. Os médicos de verdade
  -- entram por convite novo.
  --
  -- Fonte: quem tem role medico/medico_prescritor no tenant, MAIS quem estiver
  -- atribuído a algum lote (garante que nenhum lote fique órfão).
  INSERT INTO receituarios.medicos (
    id, nome, email, crm, especialidade,
    assinatura_png, assinatura_atualizada_em, ativo, created_at
  )
  SELECT
    p.id,
    coalesce(nullif(p.full_name, ''), 'Médico sem nome'),
    p.email,
    coalesce(nullif(p.crm, ''), 'não informado'),   -- crm é NOT NULL no schema novo
    p.especialidade,
    p.signature_data,
    p.signature_configured_at,
    false,
    coalesce(p.created_at, now())
  FROM public.profiles p
  WHERE p.id IN (
      SELECT ur.user_id FROM public.user_roles ur
      WHERE ur.tenant_id = v_tenant AND ur.role::text IN ('medico', 'medico_prescritor')
      UNION
      SELECT j.doctor_user_id FROM public.prescription_jobs j
      WHERE j.doctor_user_id IS NOT NULL
    )
    -- FK para auth.users: só entra quem realmente existe no Auth.
    AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_medicos = ROW_COUNT;

  -- ── 2. Lotes ───────────────────────────────────────────────────────────────
  -- Não vieram: template_id, source_reference, notes, reviewer_id,
  -- doctor_profile_id — nunca foram preenchidos nem lidos pelo código.
  INSERT INTO receituarios.lotes (
    id, titulo, tipo, status, origem, total_itens, itens_assinados,
    medico_id, criado_por, enviado_para_assinatura_em, concluido_em,
    created_at, updated_at
  )
  SELECT
    j.id,
    j.title,
    j.job_type,
    j.status,
    CASE WHEN j.source_type = 'netris' THEN 'netris' ELSE 'manual_import' END,
    coalesce(j.total_items, 0),
    coalesce(j.signed_items, 0),
    j.doctor_user_id,
    -- requested_by aponta para profiles; se a conta sumiu do Auth, vira NULL
    -- em vez de derrubar a FK.
    (SELECT u.id FROM auth.users u WHERE u.id = j.requested_by),
    j.submitted_for_signature_at,
    j.completed_at,
    j.created_at,
    j.updated_at
  FROM public.prescription_jobs j
  WHERE j.tenant_id = v_tenant
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_lotes = ROW_COUNT;

  -- ── 3. Itens ───────────────────────────────────────────────────────────────
  -- Não vieram: patient_cpf, procedure_code, doctor_document,
  -- validation_errors, current_pdf_path, submitted_at, rejected_at.
  --
  -- ATENÇÃO em pdf_assinado_path: o valor é copiado como está e aponta para o
  -- bucket ANTIGO (receituarios-pdfs, path <tenant>/<lote>/…). Os arquivos não
  -- são movidos — SQL não copia blob de storage. Hoje nenhuma tela lê essa
  -- coluna (o PDF é sempre regerado a partir do payload), então isso não
  -- quebra nada; a persistência de verdade fica para a Fase 6.
  INSERT INTO receituarios.lote_itens (
    id, lote_id, sequencia, status, paciente_nome, data_exame,
    procedimento, setor, medico_nome, payload,
    pdf_assinado_path, assinado_em, created_at, updated_at
  )
  SELECT
    i.id,
    i.job_id,
    i.sequence,
    i.status,
    i.patient_name,
    i.exam_date,
    i.procedure_name,
    i.setor,
    i.doctor_name,
    coalesce(i.row_payload, '{}'::jsonb),
    i.signed_pdf_path,
    i.signed_at,
    i.created_at,
    i.updated_at
  FROM public.prescription_job_items i
  -- Só itens cujo lote veio junto (evita órfão se algum lote for de outro tenant).
  WHERE EXISTS (SELECT 1 FROM receituarios.lotes l WHERE l.id = i.job_id)
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_itens = ROW_COUNT;

  -- ── 4. Convites ────────────────────────────────────────────────────────────
  -- Preserva a trilha de quem foi convidado. Todos os antigos são de médico.
  IF to_regclass('public.medico_invite_tokens') IS NOT NULL THEN
    INSERT INTO receituarios.convites (
      id, token, tipo, expira_em, usado_em, usado_por, created_at
    )
    SELECT
      t.id,
      t.token,
      'medico',
      t.expires_at,
      t.used_at,
      (SELECT u.id FROM auth.users u WHERE u.id = t.used_by),
      t.created_at
    FROM public.medico_invite_tokens t
    WHERE t.tenant_id = v_tenant
    ON CONFLICT (id) DO NOTHING;

    GET DIAGNOSTICS v_convites = ROW_COUNT;
  ELSE
    v_convites := 0;
  END IF;

  -- ── 5. Conferência ─────────────────────────────────────────────────────────
  -- Falha ruidosamente se faltou linha: é melhor a migration não passar do que
  -- descobrir depois que sumiu receita. A comparação é "<", não "<>": depois da
  -- Fase 3 o app grava lotes novos aqui, e num db reset o destino legitimamente
  -- tem MAIS linhas que a origem.
  IF (SELECT count(*) FROM receituarios.lotes)
     < (SELECT count(*) FROM public.prescription_jobs WHERE tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Fase 2: contagem de lotes não bate (% no destino, % na origem)',
      (SELECT count(*) FROM receituarios.lotes),
      (SELECT count(*) FROM public.prescription_jobs WHERE tenant_id = v_tenant);
  END IF;

  IF (SELECT count(*) FROM receituarios.lote_itens)
     < (SELECT count(*) FROM public.prescription_job_items i
        WHERE EXISTS (SELECT 1 FROM public.prescription_jobs j
                      WHERE j.id = i.job_id AND j.tenant_id = v_tenant)) THEN
    RAISE EXCEPTION 'Fase 2: contagem de itens não bate (% no destino, % na origem)',
      (SELECT count(*) FROM receituarios.lote_itens),
      (SELECT count(*) FROM public.prescription_job_items i
       WHERE EXISTS (SELECT 1 FROM public.prescription_jobs j
                     WHERE j.id = i.job_id AND j.tenant_id = v_tenant));
  END IF;

  RAISE NOTICE 'Fase 2 concluída — % médico(s), % lote(s), % item(ns), % convite(s) copiados.',
    v_medicos, v_lotes, v_itens, v_convites;
END $$;
