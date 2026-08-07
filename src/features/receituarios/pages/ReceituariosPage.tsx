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
import { receituariosService } from "@/features/receituarios/services/receituariosService";
import { gerarPdfLote, gerarPdfLoteAssinado, listarTemplates, type TipoReceita } from "@/features/receituarios/lib/gerarPdf";
import type { StatusLote } from "@/features/receituarios/types";
import { useAuth } from "@/shared/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// ── Convite médico ────────────────────────────────────────────────────────────
function InviteButton() {
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  async function gerarConvite() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("convites")
        .insert({ tipo: "medico", criado_por: user?.id ?? null })
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
const STATUS_LABELS: Record<StatusLote, string> = {
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

interface MedicoLista { id: string; nome: string; crm: string | null; especialidade: string | null }

// ── Painel de detalhe do lote ─────────────────────────────────────────────────
function LoteDetalhe({ loteId, tipoLote, tituloLote, statusLote, onClose }: {
  loteId: string; tipoLote: string; tituloLote: string; statusLote: string; onClose: () => void;
}) {
  const [baixando, setBaixando] = useState<"original" | "assinado" | null>(null);
  const [atribuindo, setAtribuindo] = useState(false);
  const [medicoSelecionado, setMedicoSelecionado] = useState<string>("");

  // Lista de médicos para atribuição — uma query só (antes eram duas, por causa
  // de user_roles não ter FK para profiles). Inativos ficam de fora.
  const { data: medicos = [] } = useQuery<MedicoLista[]>({
    queryKey: ["medicos-lista"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("medicos").select("id, nome, crm, especialidade")
        .eq("ativo", true).order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const qc = useQueryClient();

  async function atribuirMedico() {
    if (!medicoSelecionado) { toast.error("Selecione um médico"); return; }
    setAtribuindo(true);
    try {
      const { error } = await supabase
        .from("lotes")
        .update({
          medico_id: medicoSelecionado,
          status: "signature_pending",
          enviado_para_assinatura_em: new Date().toISOString(),
        }).eq("id", loteId);
      if (error) throw error;
      toast.success("Médico atribuído — lote agora aparece na caixa de entrada do médico");
      qc.invalidateQueries({ queryKey: ["todos-lotes"] });
      qc.invalidateQueries({ queryKey: ["lote-medico", loteId] });
    } catch (e: any) {
      toast.error("Erro ao atribuir", { description: e?.message });
    } finally { setAtribuindo(false); }
  }

  const { data: itens = [], isLoading } = useQuery({
    queryKey: ["lote-itens-admin", loteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lote_itens")
        .select("id, sequencia, paciente_nome, data_exame, procedimento, setor, medico_nome, status")
        .eq("lote_id", loteId).order("sequencia");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: medicoDoLote } = useQuery({
    queryKey: ["lote-medico", loteId],
    queryFn: async () => {
      const { data: lote } = await supabase
        .from("lotes").select("medico_id").eq("id", loteId).maybeSingle();
      if (!lote?.medico_id) return null;

      // Query separada de propósito: lotes.medico_id não tem FK para medicos —
      // o lote pode ser atribuído antes de o médico aceitar o convite.
      const { data: m } = await supabase
        .from("medicos")
        .select("nome, crm, especialidade, assinatura_png")
        .eq("id", lote.medico_id).maybeSingle();
      return m ?? null;
    },
  });

  const tipo = tipoLote as TipoReceita;

  // Quais tipos geram PDF passou a ser dado do banco (Fase 6), não uma lista
  // fixa no código.
  const { data: templates = [] } = useQuery({
    queryKey: ["templates"],
    queryFn: listarTemplates,
    staleTime: 5 * 60_000,
  });
  const podePdf = templates.some(t => t.codigo === tipo);

  // Documento assinado guardado no storage — é o arquivo que o médico realmente
  // assinou, e não uma regeração. Só existe para lotes assinados a partir da
  // Fase 6; nos antigos o download cai na regeração.
  const { data: documento } = useQuery({
    queryKey: ["documento-assinado", loteId],
    queryFn: async () => {
      const { data } = await supabase
        .from("documentos")
        .select("storage_bucket, storage_path, nome_arquivo, hash_sha256, created_at")
        .eq("lote_id", loteId).eq("tipo", "assinado")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data ?? null;
    },
  });

  async function baixarOriginal() {
    if (!podePdf) { toast.error("Tipo sem PDF automático"); return; }
    setBaixando("original");
    try {
      const { linhas } = await receituariosService.getLinhasDoLote(loteId);
      if (!linhas.length) { toast.error("Lote sem itens"); return; }
      await gerarPdfLote(tipo, linhas);
      toast.success("PDF original baixado");
    } catch (e: any) {
      toast.error("Erro", { description: e?.message });
    } finally { setBaixando(null); }
  }

  function baixarBlob(blob: Blob, nome: string) {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: nome }).click();
    URL.revokeObjectURL(url);
  }

  async function baixarAssinado() {
    setBaixando("assinado");
    try {
      // Caminho preferido: o arquivo guardado, que é a prova do ato.
      if (documento) {
        const { data, error } = await supabase.storage
          .from(documento.storage_bucket).download(documento.storage_path);
        if (error) throw error;
        baixarBlob(data, documento.nome_arquivo ?? `${tituloLote}_assinado.pdf`);
        toast.success("PDF assinado baixado", { description: "Arquivo original guardado na assinatura." });
        return;
      }

      // Fallback para lotes assinados antes da Fase 6, que não têm documento
      // guardado: regera a partir do payload e da assinatura do médico.
      if (!podePdf) { toast.error("Tipo sem PDF automático"); return; }
      const sig = medicoDoLote?.assinatura_png;
      if (!sig) { toast.error("Sem arquivo guardado e sem assinatura do médico para regerar"); return; }
      const { linhas } = await receituariosService.getLinhasDoLote(loteId);
      if (!linhas.length) { toast.error("Lote sem itens"); return; }
      const { blob } = await gerarPdfLoteAssinado(tipo, linhas, sig, {
        nome:          medicoDoLote?.nome ?? "",
        crm:           medicoDoLote?.crm ?? "",
        especialidade: medicoDoLote?.especialidade ?? "",
      });
      baixarBlob(blob, `${tituloLote}_assinado.pdf`);
      toast.success("PDF assinado baixado", { description: "Regerado — este lote é anterior ao arquivamento." });
    } catch (e: any) {
      toast.error("Erro", { description: e?.message });
    } finally { setBaixando(null); }
  }

  const assinado = statusLote === "completed";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5 shrink-0">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Detalhes do lote</p>
          <h2 className="text-lg font-extrabold tracking-tight text-foreground truncate">{tituloLote}</h2>
        </div>
        <Badge className={cn("shrink-0", STATUS_BADGE[statusLote] ?? "bg-muted text-muted-foreground")}>
          {STATUS_LABELS[statusLote as StatusLote] ?? statusLote}
        </Badge>
      </div>

      {/* Médico atribuído ou seletor de atribuição */}
      {medicoDoLote ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
          <Stethoscope className="h-4 w-4 text-primary shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">{medicoDoLote.nome}</p>
            <p className="text-xs text-muted-foreground">
              {[medicoDoLote.especialidade, medicoDoLote.crm ? `CRM ${medicoDoLote.crm}` : null].filter(Boolean).join(" · ")}
            </p>
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
                <option key={m.id} value={m.id}>{m.nome}{m.crm ? ` — CRM ${m.crm}` : ""}</option>
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

      {/* Trilha de auditoria do documento assinado */}
      {assinado && documento && (
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-primary" /> Documento arquivado
          </p>
          <p className="text-xs text-muted-foreground">
            Guardado em {format(new Date(documento.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
          </p>
          {documento.hash_sha256 && (
            <p className="text-[10px] text-muted-foreground/80 font-mono break-all">
              SHA-256: {documento.hash_sha256}
            </p>
          )}
        </div>
      )}

      {/* Lista de pacientes */}
      <div className="rounded-lg border border-border bg-card shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Pacientes</p>
          <span className="text-xs text-muted-foreground">{itens.length} receita(s)</span>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : itens.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Sem itens</p>
        ) : (
          <div className="divide-y divide-border/50 max-h-80 overflow-y-auto">
            {itens.map((it: any) => (
              <div key={it.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{it.sequencia}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{it.paciente_nome}</p>
                  <p className="text-xs text-muted-foreground">{[it.procedimento, it.data_exame].filter(Boolean).join(" · ")}</p>
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
  const { papel } = useAuth();
  const navigate = useNavigate();
  const [selecionado, setSelecionado] = useState<{ id: string; tipo: string; titulo: string; status: string } | null>(null);

  const ehStaff = papel === "admin" || papel === "operador";

  const { data: todosLotes = [], isLoading: loadingLotes, error: lotesError } = useQuery({
    queryKey: ["todos-lotes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lotes")
        .select("id, titulo, tipo, status, total_itens, itens_assinados, created_at, medico_id")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) { logError("[ReceituariosPage] lotes:", error.message, error); throw error; }
      return data ?? [];
    },
    enabled: ehStaff,
    staleTime: 30_000,
  });

  // Médico não tem o que fazer na tela administrativa — vai direto pro inbox.
  // Antes havia dois conceitos convivendo ('medico' e 'medico_prescritor'), com
  // comportamentos diferentes; agora é um só.
  if (papel === "medico") return <Navigate to="/receituarios/medico" replace />;

  const kpis = {
    total:     todosLotes.length,
    pendentes: todosLotes.filter((l: any) => ["signature_pending", "review_pending", "imported"].includes(l.status)).length,
    assinados: todosLotes.filter((l: any) => l.status === "completed").length,
  };

  if (selecionado) {
    return (
      <MainLayout>
        <div className="space-y-6 animate-fade-in">
          <LoteDetalhe
            loteId={selecionado.id}
            tipoLote={selecionado.tipo}
            tituloLote={selecionado.titulo}
            statusLote={selecionado.status}
            onClose={() => setSelecionado(null)}
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
              {papel === "admin" && <InviteButton />}
              <Button onClick={() => navigate("/receituarios/novo")} className="gap-2">
                <Plus className="h-4 w-4" /> Novo lote
              </Button>
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
              { label: "Total de lotes", value: kpis.total,     icon: Files },
              { label: "Pendentes",      value: kpis.pendentes, icon: Clock },
              { label: "Assinados",      value: kpis.assinados, icon: CheckCircle2 },
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
              {todosLotes.map((lote: any) => (
                <button
                  key={lote.id}
                  onClick={() => setSelecionado({ id: lote.id, tipo: lote.tipo, titulo: lote.titulo, status: lote.status })}
                  className="w-full rounded-lg border border-border bg-card shadow-card p-4 flex items-center gap-4 hover:border-primary/30 hover:shadow-lg transition-all text-left group"
                >
                  <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <ScrollText className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{lote.titulo}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <Badge className={cn("text-[10px] py-0", STATUS_BADGE[lote.status] ?? "bg-muted text-muted-foreground")}>
                        {STATUS_LABELS[lote.status as StatusLote] ?? lote.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Users className="h-3 w-3" />{lote.total_itens} pac.
                      </span>
                      {lote.medico_id && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Stethoscope className="h-3 w-3" />Médico atribuído
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">
                        {format(new Date(lote.created_at), "dd/MM/yy", { locale: ptBR })}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

      </div>
    </MainLayout>
  );
}
