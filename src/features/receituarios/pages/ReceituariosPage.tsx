import { useState } from "react";
import { logError } from "@/lib/logger";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Navigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, Download, Files, Loader2, Plus,
  ScrollText, Stethoscope, Link2, ChevronRight,
  ArrowLeft, Users, CheckCircle2, Clock, FileText,
} from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { receituariosService } from "@/features/receituarios/services/receituariosService";
import { gerarPdfLote, gerarPdfLoteAssinado, type TipoReceita } from "@/features/receituarios/lib/gerarPdf";
import type { PrescriptionJobStatus } from "@/features/receituarios/types";
import { useAuth } from "@/shared/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// ── Convite médico ────────────────────────────────────────────────────────────
function InviteButton({ tenantId }: { tenantId: string | undefined }) {
  const [loading, setLoading] = useState(false);
  async function gerarConvite() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("medico_invite_tokens")
        .insert({ tenant_id: tenantId })
        .select("token").single();
      if (error) throw error;
      const link = `${window.location.origin}/cadastro/medico?token=${data.token}`;
      await navigator.clipboard.writeText(link);
      toast.success("Link de convite copiado!", { description: "Válido por 7 dias." });
    } catch (e: any) {
      toast.error("Erro ao gerar convite", { description: e?.message });
    } finally { setLoading(false); }
  }
  return (
    <Button variant="outline" onClick={gerarConvite} disabled={loading} className="gap-2">
      <Link2 className="h-4 w-4" />
      {loading ? "Gerando…" : "Convidar médico"}
    </Button>
  );
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<PrescriptionJobStatus, string> = {
  draft: "Rascunho", imported: "Importado", review_pending: "Em revisão",
  signature_pending: "Aguardando assinatura", partially_signed: "Parcialmente assinado",
  completed: "Assinado", cancelled: "Cancelado",
};
const STATUS_BADGE: Record<string, string> = {
  signature_pending: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  review_pending:    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  completed:         "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  imported:          "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  cancelled:         "bg-red-100 text-red-600",
};

const JOB_TYPE_LABELS: Record<string, string> = {
  anestesia_dr_felix: "Anestesia Dr. Felix",
  longactil: "Longactil",
  procedimentos_dia: "Procedimentos do dia",
  custom: "Template customizado",
};

// ── Painel de detalhe do lote ─────────────────────────────────────────────────
function LoteDetalhe({ jobId, jobType, jobTitle, jobStatus, onClose }: {
  jobId: string; jobType: string; jobTitle: string; jobStatus: string; onClose: () => void;
}) {
  const { profile } = useAuth();
  const [baixando, setBaixando] = useState<"original" | "assinado" | null>(null);
  const [atribuindo, setAtribuindo] = useState(false);
  const [medicoSelecionado, setMedicoSelecionado] = useState<string>("");

  // Lista de médicos para atribuição
  const { data: medicos = [] } = useQuery<{ id: string; full_name: string; crm: string | null }[]>({
    queryKey: ["medicos-lista", profile?.tenant_id],
    queryFn: async () => {
      const { data: roles } = await (supabase as any)
        .from("user_roles").select("user_id")
        .eq("tenant_id", profile?.tenant_id).eq("role", "medico");
      const ids = (roles ?? []).map((r: any) => r.user_id as string);
      if (!ids.length) return [];
      const { data: profs } = await (supabase as any)
        .from("profiles").select("id, full_name, crm, especialidade").in("id", ids);
      return profs ?? [];
    },
    enabled: !!profile?.tenant_id,
  });

  const qc = useQueryClient();

  async function atribuirMedico() {
    if (!medicoSelecionado) { toast.error("Selecione um médico"); return; }
    setAtribuindo(true);
    try {
      const { error } = await (supabase as any)
        .from("prescription_jobs")
        .update({
          doctor_user_id: medicoSelecionado,
          status: "signature_pending",
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);
      if (error) throw error;
      toast.success("Médico atribuído — lote agora aparece na caixa de entrada do médico");
      qc.invalidateQueries({ queryKey: ["todos-lotes"] });
      qc.invalidateQueries({ queryKey: ["job-medico", jobId] });
    } catch (e: any) {
      toast.error("Erro ao atribuir", { description: e?.message });
    } finally { setAtribuindo(false); }
  }
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["job-items-admin", jobId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("prescription_job_items")
        .select("id, sequence, patient_name, exam_date, procedure_name, setor, doctor_name, status, row_payload")
        .eq("job_id", jobId).order("sequence");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: medicoNome } = useQuery({
    queryKey: ["job-medico", jobId],
    queryFn: async () => {
      // Busca o job pra pegar doctor_user_id
      const { data: job } = await (supabase as any)
        .from("prescription_jobs")
        .select("doctor_user_id")
        .eq("id", jobId).maybeSingle();

      if (!job?.doctor_user_id) return null;

      // Busca perfil separado (não há FK direta entre doctor_user_id e profiles)
      const { data: prof } = await (supabase as any)
        .from("profiles")
        .select("full_name, crm, especialidade, signature_data")
        .eq("id", job.doctor_user_id).maybeSingle();

      return prof ? { doctor_user_id: job.doctor_user_id, profiles: prof } : null;
    },
  });

  const tipo = jobType as TipoReceita;
  const podePdf = tipo === "anestesia_dr_felix" || tipo === "longactil";

  async function baixarOriginal() {
    if (!podePdf) { toast.error("Tipo sem PDF automático"); return; }
    setBaixando("original");
    try {
      const { linhas } = await receituariosService.getLinhasDoLote(jobId);
      if (!linhas.length) { toast.error("Lote sem itens"); return; }
      await gerarPdfLote(tipo, linhas);
      toast.success("PDF original baixado");
    } catch (e: any) {
      toast.error("Erro", { description: e?.message });
    } finally { setBaixando(null); }
  }

  async function baixarAssinado() {
    if (!podePdf) { toast.error("Tipo sem PDF automático"); return; }
    const sig = medicoNome?.profiles?.signature_data;
    if (!sig) { toast.error("Médico ainda não assinou — assinatura não encontrada no perfil"); return; }
    setBaixando("assinado");
    try {
      const { linhas } = await receituariosService.getLinhasDoLote(jobId);
      if (!linhas.length) { toast.error("Lote sem itens"); return; }
      const medico = {
        nome:         medicoNome?.profiles?.full_name ?? "",
        crm:          medicoNome?.profiles?.crm ?? "",
        especialidade:medicoNome?.profiles?.especialidade ?? "",
      };
      const { blob } = await gerarPdfLoteAssinado(tipo, linhas, sig, medico);
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), {
        href: url, download: `${jobTitle}_assinado.pdf`,
      }).click();
      URL.revokeObjectURL(url);
      toast.success("PDF assinado baixado");
    } catch (e: any) {
      toast.error("Erro", { description: e?.message });
    } finally { setBaixando(null); }
  }

  const assinado = jobStatus === "completed";
  const medico = medicoNome?.profiles;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5 shrink-0">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Detalhes do lote</p>
          <h2 className="text-lg font-extrabold tracking-tight text-foreground truncate">{jobTitle}</h2>
        </div>
        <Badge className={cn("shrink-0", STATUS_BADGE[jobStatus] ?? "bg-muted text-muted-foreground")}>
          {STATUS_LABELS[jobStatus as PrescriptionJobStatus] ?? jobStatus}
        </Badge>
      </div>

      {/* Médico atribuído ou seletor de atribuição */}
      {medico ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
          <Stethoscope className="h-4 w-4 text-primary shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">{medico.full_name}</p>
            <p className="text-xs text-muted-foreground">{[medico.especialidade, medico.crm ? `CRM ${medico.crm}` : null].filter(Boolean).join(" · ")}</p>
          </div>
          {assinado && <CheckCircle2 className="h-4 w-4 text-emerald-500 ml-auto shrink-0" />}
        </div>
      ) : medicos.length > 0 && !assinado ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            Sem médico atribuído — atribua agora
          </p>
          <div className="flex gap-2 flex-wrap">
            <select
              value={medicoSelecionado}
              onChange={e => setMedicoSelecionado(e.target.value)}
              className="flex-1 min-w-40 rounded-md border border-input bg-card px-3 py-2 text-sm"
            >
              <option value="">Selecionar médico…</option>
              {medicos.map(m => (
                <option key={m.id} value={m.id}>{m.full_name}{m.crm ? ` — CRM ${m.crm}` : ""}</option>
              ))}
            </select>
            <Button size="sm" onClick={atribuirMedico} disabled={atribuindo || !medicoSelecionado} className="gap-1.5">
              {atribuindo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="h-3.5 w-3.5" />}
              Atribuir
            </Button>
          </div>
        </div>
      ) : null}

      {/* Downloads */}
      {podePdf && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={baixarOriginal}
            disabled={!!baixando} className="gap-1.5">
            {baixando === "original" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Baixar PDF original
          </Button>
          {assinado && (
            <Button size="sm" onClick={baixarAssinado} disabled={!!baixando} className="gap-1.5">
              {baixando === "assinado" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Baixar PDF assinado
            </Button>
          )}
        </div>
      )}

      {/* Lista de pacientes */}
      <div className="rounded-lg border border-border bg-card shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Pacientes</p>
          <span className="text-xs text-muted-foreground">{items.length} receita(s)</span>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Sem itens</p>
        ) : (
          <div className="divide-y divide-border/50 max-h-80 overflow-y-auto">
            {items.map((it: any) => (
              <div key={it.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{it.sequence}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{it.patient_name}</p>
                  <p className="text-xs text-muted-foreground">{[it.procedure_name, it.exam_date].filter(Boolean).join(" · ")}</p>
                </div>
                {it.status === "signed" && <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function ReceituariosPage() {
  const { tenant, profile, role } = useAuth();
  const navigate = useNavigate();
  const [selectedJob, setSelectedJob] = useState<{ id: string; type: string; title: string; status: string } | null>(null);

  // Uma única query para todos os lotes — sem os 5 requests do getOverview
  const tenantId = tenant?.id ?? profile?.tenant_id;

  const { data: todosLotes = [], isLoading: loadingLotes, error: lotesError } = useQuery({
    queryKey: ["todos-lotes", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("prescription_jobs")
        .select("id, title, job_type, status, total_items, signed_items, created_at, updated_at, doctor_user_id")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) { logError("[ReceituariosPage] lotes:", error.message, error); throw error; }
      return data ?? [];
    },
    enabled: !!tenantId && role !== "medico",
    staleTime: 30_000,
  });

  // Médico prescritor vai direto pro inbox — não cai na página admin
  if (role === "medico_prescritor") return <Navigate to="/receituarios/medico" replace />;

  // KPIs calculados localmente dos lotes já carregados
  const kpis = {
    total:     todosLotes.length,
    pendentes: todosLotes.filter((j: any) => ["signature_pending","review_pending","imported"].includes(j.status)).length,
    assinados: todosLotes.filter((j: any) => j.status === "completed").length,
  };

  if (selectedJob) {
    return (
      <MainLayout>
        <div className="space-y-6 animate-fade-in">
          <LoteDetalhe
            jobId={selectedJob.id}
            jobType={selectedJob.type}
            jobTitle={selectedJob.title}
            jobStatus={selectedJob.status}
            onClose={() => setSelectedJob(null)}
          />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          eyebrow="Clínica"
          title="Receituários"
          subtitle="Geração, revisão e assinatura digital de receitas em lote"
          actions={
            <>
              {role === "medico" && (
                <Button variant="outline" onClick={() => navigate("/receituarios/medico")} className="gap-2">
                  <ScrollText className="h-4 w-4" /> Minha caixa de entrada
                </Button>
              )}
              {(role === "admin" || role === "developer") && (
                <InviteButton tenantId={tenant?.id} />
              )}
              {role !== "medico" && (
                <Button onClick={() => navigate("/receituarios/novo")} className="gap-2">
                  <Plus className="h-4 w-4" /> Novo lote
                </Button>
              )}
            </>
          }
        />

        {lotesError && (
          <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
            <p className="text-sm text-red-700">Erro ao carregar lotes: {(lotesError as any)?.message ?? "verifique o console"}</p>
          </div>
        )}

        {/* KPIs rápidos */}
        {!loadingLotes && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total de lotes",     value: kpis.total,     icon: Files   },
              { label: "Pendentes",          value: kpis.pendentes, icon: Clock   },
              { label: "Assinados",          value: kpis.assinados, icon: CheckCircle2 },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-lg border border-border bg-card p-4 flex items-center gap-3">
                <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-2xl font-bold text-foreground leading-none">{value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{label}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Todos os lotes — cards clicáveis */}
        {role !== "medico" && (
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
              Lotes {loadingLotes && <span className="normal-case font-normal text-muted-foreground/60">(carregando…)</span>}
            </p>
            {loadingLotes ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />)}
              </div>
            ) : todosLotes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Nenhum lote criado ainda</p>
              </div>
            ) : (
              <div className="space-y-2">
                {todosLotes.map((job: any) => (
                  <button
                    key={job.id}
                    onClick={() => setSelectedJob({ id: job.id, type: job.job_type, title: job.title, status: job.status })}
                    className="w-full rounded-lg border border-border bg-card shadow-card p-4 flex items-center gap-4 hover:border-primary/30 hover:shadow-lg transition-all text-left group"
                  >
                    <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <ScrollText className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{job.title}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <Badge className={cn("text-[10px] py-0", STATUS_BADGE[job.status] ?? "bg-muted text-muted-foreground")}>
                          {STATUS_LABELS[job.status as PrescriptionJobStatus] ?? job.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Users className="h-3 w-3" />{job.total_items} pac.
                        </span>
                        {job.doctor_user_id && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Stethoscope className="h-3 w-3" />Médico atribuído
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {format(new Date(job.created_at), "dd/MM/yy", { locale: ptBR })}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </MainLayout>
  );
}
