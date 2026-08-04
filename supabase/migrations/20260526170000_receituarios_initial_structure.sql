-- Modulo inicial de receituarios:
-- - role medico_prescritor
-- - bucket privado para PDFs
-- - tabelas para templates, lotes, itens e saidas
-- - RLS por tenant para leitura/escrita interna

DO $$
BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'medico_prescritor';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('receituarios-pdfs', 'receituarios-pdfs', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.prescription_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  template_type text NOT NULL CHECK (template_type IN ('anestesia_dr_felix', 'longactil', 'procedimentos_dia', 'custom')),
  description text,
  document_layout text NOT NULL DEFAULT 'dupla_por_pagina',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS public.prescription_procedure_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.prescription_templates(id) ON DELETE CASCADE,
  procedure_code text,
  procedure_name text NOT NULL,
  setor text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prescription_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.prescription_templates(id) ON DELETE SET NULL,
  title text NOT NULL,
  job_type text NOT NULL CHECK (job_type IN ('anestesia_dr_felix', 'longactil', 'procedimentos_dia', 'custom')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'imported', 'review_pending', 'signature_pending', 'partially_signed', 'completed', 'cancelled')),
  source_type text NOT NULL DEFAULT 'manual_import',
  source_reference text,
  notes text,
  total_items integer NOT NULL DEFAULT 0,
  signed_items integer NOT NULL DEFAULT 0,
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  doctor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  submitted_for_signature_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prescription_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.prescription_jobs(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'review_pending', 'signature_pending', 'signed', 'rejected', 'cancelled')),
  patient_name text NOT NULL,
  patient_cpf text,
  exam_date date,
  procedure_name text,
  procedure_code text,
  setor text,
  doctor_name text,
  doctor_document text,
  row_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_pdf_path text,
  signed_pdf_path text,
  submitted_at timestamptz,
  signed_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, sequence)
);

CREATE TABLE IF NOT EXISTS public.prescription_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.prescription_jobs(id) ON DELETE CASCADE,
  job_item_id uuid REFERENCES public.prescription_job_items(id) ON DELETE CASCADE,
  output_type text NOT NULL CHECK (output_type IN ('draft_pdf', 'signed_pdf', 'zip_export')),
  status text NOT NULL DEFAULT 'generated' CHECK (status IN ('generated', 'signed', 'superseded', 'failed')),
  storage_bucket text NOT NULL DEFAULT 'receituarios-pdfs',
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/pdf',
  file_size_bytes bigint,
  external_provider text,
  external_document_id text,
  external_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prescription_templates_tenant ON public.prescription_templates (tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_prescription_procedure_mappings_tenant ON public.prescription_procedure_mappings (tenant_id, template_id, is_active);
CREATE INDEX IF NOT EXISTS idx_prescription_jobs_tenant_status ON public.prescription_jobs (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_prescription_items_tenant_status ON public.prescription_job_items (tenant_id, status, signed_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_prescription_outputs_tenant_job ON public.prescription_outputs (tenant_id, job_id, created_at DESC);

ALTER TABLE public.prescription_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_procedure_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_job_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_outputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prescription_templates_select_tenant" ON public.prescription_templates;
CREATE POLICY "prescription_templates_select_tenant" ON public.prescription_templates
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "prescription_templates_write_tenant" ON public.prescription_templates;
CREATE POLICY "prescription_templates_write_tenant" ON public.prescription_templates
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "prescription_procedure_mappings_select_tenant" ON public.prescription_procedure_mappings;
CREATE POLICY "prescription_procedure_mappings_select_tenant" ON public.prescription_procedure_mappings
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "prescription_procedure_mappings_write_tenant" ON public.prescription_procedure_mappings;
CREATE POLICY "prescription_procedure_mappings_write_tenant" ON public.prescription_procedure_mappings
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "prescription_jobs_select_tenant" ON public.prescription_jobs;
CREATE POLICY "prescription_jobs_select_tenant" ON public.prescription_jobs
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "prescription_jobs_write_tenant" ON public.prescription_jobs;
CREATE POLICY "prescription_jobs_write_tenant" ON public.prescription_jobs
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "prescription_job_items_select_tenant" ON public.prescription_job_items;
CREATE POLICY "prescription_job_items_select_tenant" ON public.prescription_job_items
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "prescription_job_items_write_tenant" ON public.prescription_job_items;
CREATE POLICY "prescription_job_items_write_tenant" ON public.prescription_job_items
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "prescription_outputs_select_tenant" ON public.prescription_outputs;
CREATE POLICY "prescription_outputs_select_tenant" ON public.prescription_outputs
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "prescription_outputs_write_tenant" ON public.prescription_outputs;
CREATE POLICY "prescription_outputs_write_tenant" ON public.prescription_outputs
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "receituarios_pdfs_read_tenant" ON storage.objects;
CREATE POLICY "receituarios_pdfs_read_tenant" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'receituarios-pdfs'
    AND split_part(name, '/', 1) = public.get_user_tenant_id(auth.uid())::text
  );

DROP POLICY IF EXISTS "receituarios_pdfs_insert_tenant" ON storage.objects;
CREATE POLICY "receituarios_pdfs_insert_tenant" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'receituarios-pdfs'
    AND split_part(name, '/', 1) = public.get_user_tenant_id(auth.uid())::text
  );

DROP POLICY IF EXISTS "receituarios_pdfs_update_tenant" ON storage.objects;
CREATE POLICY "receituarios_pdfs_update_tenant" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'receituarios-pdfs'
    AND split_part(name, '/', 1) = public.get_user_tenant_id(auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'receituarios-pdfs'
    AND split_part(name, '/', 1) = public.get_user_tenant_id(auth.uid())::text
  );

DROP POLICY IF EXISTS "receituarios_pdfs_delete_tenant" ON storage.objects;
CREATE POLICY "receituarios_pdfs_delete_tenant" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'receituarios-pdfs'
    AND split_part(name, '/', 1) = public.get_user_tenant_id(auth.uid())::text
  );

INSERT INTO public.role_permissions (role_name, module, sub_module, can_view, can_create, can_edit, can_delete)
VALUES
  ('medico_prescritor', 'receituarios', '', true, false, true, false)
ON CONFLICT (role_name, module, sub_module) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;
