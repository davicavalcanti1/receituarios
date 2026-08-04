import { supabase } from "@/integrations/supabase/client";
import type { PrescriptionJobSummary, PrescriptionOverview } from "@/features/receituarios/types";
import type { LinhaLote } from "@/features/receituarios/lib/parseLote";

function brParaIso(d: string): string | null {
  const m = (d ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const EMPTY_OVERVIEW: PrescriptionOverview = {
  schemaReady: false,
  templatesCount: 0,
  activeJobsCount: 0,
  pendingSignatureCount: 0,
  signedItemsCount: 0,
  recentJobs: [],
};

function isMissingRelation(error: unknown): boolean {
  const err = error as { code?: string; message?: string; details?: string } | null;
  if (!err) return false;
  if (err.code === "42P01") return true;
  const haystack = `${err.message ?? ""} ${err.details ?? ""}`;
  return /relation .* does not exist/i.test(haystack);
}

export const receituariosService = {
  async getOverview(tenantId: string): Promise<PrescriptionOverview> {
    const [
      templatesResult,
      jobsResult,
      pendingItemsResult,
      signedItemsResult,
      recentJobsResult,
    ] = await Promise.all([
      (supabase as any)
        .from("prescription_templates")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("is_active", true),
      (supabase as any)
        .from("prescription_jobs")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .in("status", ["draft", "imported", "review_pending", "signature_pending", "partially_signed"]),
      (supabase as any)
        .from("prescription_job_items")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "signature_pending"),
      (supabase as any)
        .from("prescription_job_items")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "signed"),
      (supabase as any)
        .from("prescription_jobs")
        .select("id, title, job_type, status, total_items, signed_items, updated_at")
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false })
        .limit(6),
    ]);

    const errors = [
      templatesResult.error,
      jobsResult.error,
      pendingItemsResult.error,
      signedItemsResult.error,
      recentJobsResult.error,
    ].filter(Boolean);

    if (errors.some(isMissingRelation)) {
      return EMPTY_OVERVIEW;
    }

    const unexpectedError = errors[0];
    if (unexpectedError) {
      throw unexpectedError;
    }

    const recentJobs = ((recentJobsResult.data ?? []) as any[]).map(
      (job): PrescriptionJobSummary => ({
        id: job.id,
        title: job.title,
        jobType: job.job_type,
        status: job.status,
        totalItems: job.total_items ?? 0,
        signedItems: job.signed_items ?? 0,
        updatedAt: job.updated_at ?? null,
      }),
    );

    return {
      schemaReady: true,
      templatesCount: templatesResult.count ?? 0,
      activeJobsCount: jobsResult.count ?? 0,
      pendingSignatureCount: pendingItemsResult.count ?? 0,
      signedItemsCount: signedItemsResult.count ?? 0,
      recentJobs,
    };
  },

  // Salva o lote (job + itens). A LinhaLote completa fica em row_payload pra
  // permitir regenerar o mesmo PDF depois sem armazenar o arquivo.
  async criarLote(params: {
    tenantId: string; userId?: string | null; tipo: string; titulo: string;
    linhas: LinhaLote[]; doctorUserId?: string;
  }): Promise<{ id: string }> {
    const { tenantId, userId, tipo, titulo, linhas, doctorUserId } = params;
    const validas = linhas.filter(l => l.erros.length === 0);

    const { data: job, error: jobErr } = await (supabase as any)
      .from("prescription_jobs")
      .insert({
        tenant_id:      tenantId,
        title:          titulo,
        job_type:       tipo,
        status:         doctorUserId ? "signature_pending" : "imported",
        source_type:    "manual_import",
        total_items:    validas.length,
        requested_by:   userId ?? null,
        doctor_user_id: doctorUserId ?? null,
      })
      .select("id")
      .single();
    if (jobErr) throw jobErr;

    const items = validas.map((l, idx) => ({
      tenant_id: tenantId,
      job_id: job.id,
      sequence: idx + 1,
      status: "draft",
      patient_name: l.paciente,
      exam_date: brParaIso(l.data_exame),
      procedure_name: l.procedimento || null,
      setor: l.setor || null,
      doctor_name: l.medico || null,
      row_payload: l,
    }));
    if (items.length) {
      const { error: itErr } = await (supabase as any).from("prescription_job_items").insert(items);
      if (itErr) throw itErr;
    }
    return { id: job.id as string };
  },

  // Carrega as linhas de um lote salvo (a partir de row_payload) pra regenerar o PDF.
  async getLinhasDoLote(jobId: string): Promise<{ jobType: string; linhas: LinhaLote[] }> {
    const { data: job, error: jErr } = await (supabase as any)
      .from("prescription_jobs").select("job_type").eq("id", jobId).single();
    if (jErr) throw jErr;

    const { data: items, error: iErr } = await (supabase as any)
      .from("prescription_job_items")
      .select("row_payload, sequence")
      .eq("job_id", jobId)
      .order("sequence", { ascending: true });
    if (iErr) throw iErr;

    const linhas = (items ?? []).map((it: any) => it.row_payload as LinhaLote);
    return { jobType: job.job_type as string, linhas };
  },
};
