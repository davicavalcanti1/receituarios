// /receituarios/medico — Caixa de entrada do médico
// Usa o layout padrão do sistema (MainLayout com sidebar)

import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  FileText, CheckCircle2, Clock, PenLine, RotateCcw,
  ChevronRight, Loader2, ArrowLeft, FileSignature,
  AlertCircle, History, Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/PageHeader";
import imagoLogo from "@/assets/imago-logo.png";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type Medico as MedicoCtx } from "@/shared/contexts/AuthContext";
import { gerarPdfLoteAssinado } from "../lib/gerarPdf";

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface Lote {
  id: string; titulo: string; tipo: string; status: string;
  total_itens: number; itens_assinados: number; created_at: string;
}
interface LoteItem {
  id: string; sequencia: number; paciente_nome: string;
  data_exame: string | null; procedimento: string | null;
  setor: string | null; status: string;
  payload: Record<string, unknown>;
}

const STATUS: Record<string, { label: string; color: string }> = {
  imported:          { label: "Aguarda assinatura",  color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  signature_pending: { label: "Aguarda assinatura",  color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  review_pending:    { label: "Em análise",           color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  completed:         { label: "Assinado",             color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
};

const JOB_LABELS: Record<string, string> = {
  anestesia_dr_felix: "Anestesia", longactil: "Longactil",
  procedimentos_dia: "Procedimentos", custom: "Receituário",
};

/** SHA-256 do arquivo, em hex — a impressão digital guardada em `documentos`. */
async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Canvas ────────────────────────────────────────────────────────────────────
function AssinaturaCanvas({ existing, onSave, onClear, saved }: {
  existing?: string | null; onSave: (png: string) => void;
  onClear: () => void; saved: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!existing || !ref.current) return;
    const img = new Image();
    img.onload = () => { const ctx = ref.current!.getContext("2d")!; ctx.clearRect(0,0,600,160); ctx.drawImage(img,0,0,600,160); };
    img.src = existing;
  }, [existing]);

  function pos(e: React.MouseEvent | React.TouchEvent) {
    const r = ref.current!.getBoundingClientRect();
    const s = "touches" in e ? e.touches[0] : e;
    return { x: (s.clientX-r.left)*(ref.current!.width/r.width), y: (s.clientY-r.top)*(ref.current!.height/r.height) };
  }
  function start(e: React.MouseEvent | React.TouchEvent) { e.preventDefault(); drawing.current=true; last.current=pos(e); }
  function move(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault(); if (!drawing.current || !ref.current) return;
    const ctx = ref.current.getContext("2d")!; const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.current!.x,last.current!.y); ctx.lineTo(p.x,p.y);
    ctx.strokeStyle="#0d1b3e"; ctx.lineWidth=2; ctx.lineCap="round"; ctx.stroke();
    last.current=p;
  }
  function end() { drawing.current=false; }
  function clear() { ref.current!.getContext("2d")!.clearRect(0,0,600,160); onClear(); }
  function save() {
    const d = ref.current!.getContext("2d")!.getImageData(0,0,600,160).data;
    if (!d.some((v,i) => i%4!==3 && v<250)) { toast.error("Desenhe sua assinatura primeiro"); return; }
    onSave(ref.current!.toDataURL("image/png"));
  }

  return (
    <div className="space-y-3">
      <div className={cn("rounded-lg border-2 overflow-hidden transition-colors",
        saved ? "border-emerald-500" : "border-dashed border-border")}>
        <canvas ref={ref} width={600} height={160}
          className="w-full touch-none cursor-crosshair bg-white dark:bg-zinc-950"
          style={{ height: 160 }}
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        />
        <p className="text-[10px] text-muted-foreground text-center py-1">Assine acima</p>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={clear} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" /> Limpar
        </Button>
        <Button type="button" size="sm" onClick={save} className="gap-1.5">
          <PenLine className="h-3.5 w-3.5" /> {saved ? "Atualizar" : "Confirmar assinatura"}
        </Button>
      </div>
    </div>
  );
}

// ── Detalhe ───────────────────────────────────────────────────────────────────
function LoteDetalhe({ lote, medico, onBack, onSigned }: {
  lote: Lote; medico: MedicoCtx | null;
  onBack: () => void; onSigned: () => void;
}) {
  const qc = useQueryClient();
  const { user, tenantId, recarregar } = useAuth();
  const [signaturePng, setSignaturePng] = useState<string | null>(medico?.assinatura_png ?? null);
  const [signing, setSigning] = useState(false);

  const { data: items = [], isLoading } = useQuery<LoteItem[]>({
    queryKey: ["lote-itens", lote.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lote_itens")
        .select("id, sequencia, paciente_nome, data_exame, procedimento, setor, status, payload")
        .eq("lote_id", lote.id).order("sequencia");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Abrir o lote marca "em análise". O ref evita o disparo duplicado do
  // StrictMode (e de qualquer re-render) — antes o UPDATE saía duas vezes.
  const marcouRevisao = useRef(false);
  useEffect(() => {
    if (lote.status !== "signature_pending" || marcouRevisao.current) return;
    marcouRevisao.current = true;
    supabase.from("lotes")
      .update({ status: "review_pending" })
      .eq("id", lote.id)
      .then(() => qc.invalidateQueries({ queryKey: ["meus-lotes"] }));
  }, [lote.id, lote.status, qc]);

  async function assinar() {
    if (!signaturePng) { toast.error("Configure sua assinatura"); return; }
    setSigning(true);
    try {
      const linhas = items.map(it => it.payload as any);
      const { blob, receitas } = await gerarPdfLoteAssinado(
        lote.tipo as any, linhas, signaturePng,
        { nome: medico?.nome ?? "", crm: medico?.crm ?? "", especialidade: medico?.especialidade ?? "" },
      );
      // Bucket próprio, path <lote_id>/… — o tenant deixou de existir.
      const fileName = `${lote.id}/assinado_${Date.now()}.pdf`;

      // Fase 6: o arquivo assinado é a PROVA do ato. Antes o erro de upload era
      // engolido com console.warn e o lote virava "completed" mesmo assim —
      // ficava marcado como assinado sem nenhum documento guardado. Agora falha.
      const { error: uploadError } = await supabase.storage
        .from("receituarios").upload(fileName, blob, { upsert: true, contentType: "application/pdf" });
      if (uploadError) {
        throw new Error(
          `Não foi possível guardar o PDF assinado (${uploadError.message}). ` +
          `O lote NÃO foi marcado como assinado — tente de novo.`,
        );
      }

      // Registro de auditoria com hash: permite provar depois que o arquivo
      // guardado é exatamente o que foi assinado.
      const hash = await sha256Hex(blob);
      const { error: docError } = await supabase.from("documentos").insert({
        tenant_id:      tenantId,
        lote_id:        lote.id,
        tipo:           "assinado",
        storage_bucket: "receituarios",
        storage_path:   fileName,
        nome_arquivo:   `receituario_${lote.titulo}.pdf`,
        tamanho_bytes:  blob.size,
        hash_sha256:    hash,
        total_receitas: receitas,
        gerado_por:     user?.id ?? null,
      });
      if (docError) {
        throw new Error(
          `PDF enviado, mas o registro de auditoria falhou (${docError.message}). ` +
          `O lote NÃO foi marcado como assinado.`,
        );
      }

      const { error: loteUpdateError } = await supabase.from("lotes").update({
        status: "completed", concluido_em: new Date().toISOString(),
        itens_assinados: items.length,
      }).eq("id", lote.id);
      if (loteUpdateError) throw new Error(`Erro ao atualizar lote: ${loteUpdateError.message}`);

      const { error: itemsUpdateError } = await supabase.from("lote_itens")
        .update({ status: "signed", assinado_em: new Date().toISOString(), pdf_assinado_path: fileName })
        .eq("lote_id", lote.id);
      if (itemsUpdateError) throw new Error(`Erro ao atualizar itens: ${itemsUpdateError.message}`);

      await supabase.from("medicos")
        .update({ assinatura_png: signaturePng, assinatura_atualizada_em: new Date().toISOString() })
        .eq("id", user?.id);
      await recarregar();

      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href: url, download: `receituario_${lote.titulo}.pdf` }).click();
      URL.revokeObjectURL(url);

      toast.success(`${receitas} receita(s) assinadas e baixadas`);
      qc.invalidateQueries({ queryKey: ["meus-lotes"] });
      onSigned();
    } catch (e: any) {
      toast.error("Erro ao assinar", { description: e?.message });
    } finally { setSigning(false); }
  }

  const st = STATUS[lote.status] ?? STATUS.signature_pending;
  const assinado = lote.status === "completed";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 shrink-0">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">{JOB_LABELS[lote.tipo] ?? "Lote"}</p>
          <h2 className="text-lg font-extrabold tracking-tight text-foreground truncate">{lote.titulo}</h2>
        </div>
        <Badge className={st.color}>{st.label}</Badge>
      </div>

      {/* Pacientes */}
      <div className="rounded-lg border border-border bg-card shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Pacientes</p>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {items.length} receita{items.length !== 1 ? "s" : ""}
          </span>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : (
          <div className="divide-y divide-border/50 max-h-72 overflow-y-auto">
            {items.map(item => (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                <span className="text-xs text-muted-foreground tabular-nums w-5 text-right shrink-0 font-mono">{item.sequencia}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{item.paciente_nome}</p>
                  {item.procedimento && <p className="text-xs text-muted-foreground truncate">{item.procedimento}</p>}
                </div>
                {item.status === "signed" && <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assinatura */}
      {assinado ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-5 flex items-center gap-4">
          <CheckCircle2 className="h-8 w-8 text-emerald-600 shrink-0" />
          <div>
            <p className="font-semibold text-emerald-800 dark:text-emerald-300">Lote assinado com sucesso</p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
              {lote.total_itens} receita{lote.total_itens !== 1 ? "s" : ""} assinada{lote.total_itens !== 1 ? "s" : ""} digitalmente
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <FileSignature className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold text-foreground">Assinatura digital</p>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-xs text-muted-foreground">
              {signaturePng
                ? "Assinatura carregada do seu perfil. Redesenhe se necessário."
                : "Desenhe sua assinatura. Será aplicada em todas as receitas deste lote."}
            </p>
            <AssinaturaCanvas
              existing={medico?.assinatura_png}
              saved={!!signaturePng}
              onSave={setSignaturePng}
              onClear={() => setSignaturePng(null)}
            />
            <Button onClick={assinar} disabled={signing || !signaturePng} className="w-full gap-2 h-11">
              {signing
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando PDF assinado…</>
                : <><FileSignature className="h-4 w-4" /> Assinar e baixar PDF</>}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function MedicoPortalPage() {
  // O médico já vem carregado do AuthContext — não precisa de query própria.
  const { user, medico } = useAuth();
  const [selectedLote, setSelectedLote] = useState<Lote | null>(null);
  const userId = user?.id;

  const { data: lotes = [], isLoading, error: lotesError } = useQuery<Lote[]>({
    queryKey: ["meus-lotes", userId],
    queryFn: async () => {
      // Busca todos os lotes atribuídos ao médico, incluindo "imported"
      // (pode acontecer se o lote foi criado antes da feature de status automático)
      const { data, error } = await supabase.from("lotes")
        .select("id, titulo, tipo, status, total_itens, itens_assinados, created_at")
        .eq("medico_id", userId)
        .not("status", "eq", "cancelled")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!userId,
  });

  const pendentes  = lotes.filter(l => l.status !== "completed" && l.status !== "cancelled");
  const concluidos = lotes.filter(l => l.status === "completed");

  return (
    <div className="min-h-screen bg-background">
      {/* TopNav mínimo — logo + nome do médico */}
      <header className="sticky top-0 z-20 bg-card border-b border-border">
        <div className="flex h-14 items-center gap-4 px-6">
          <img src={imagoLogo} alt="Imago" className="h-8 w-auto object-contain dark:hidden shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-xs font-bold uppercase tracking-widest text-primary">Receituários</span>
          </div>
          {(medico?.crm || medico?.especialidade) && (
            <p className="text-xs text-muted-foreground hidden sm:block">
              {[medico.especialidade, medico.crm ? `CRM ${medico.crm}` : null].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6 animate-fade-in">

        {selectedLote ? (
          <LoteDetalhe
            lote={selectedLote}
            medico={medico}
            onBack={() => setSelectedLote(null)}
            onSigned={() => setSelectedLote(null)}
          />
        ) : (
          <>
            <PageHeader
              eyebrow="Receituários"
              title={medico?.nome ? `Dr${medico.nome.match(/^Ana |^Amanda /i) ? "a" : ""}. ${medico.nome.split(" ")[0]}` : "Meus Receituários"}
              subtitle={[medico?.especialidade, medico?.crm ? `CRM ${medico.crm}` : null].filter(Boolean).join(" · ") || "Lotes atribuídos para assinatura digital"}
            />

            {/* Pendentes */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Inbox className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Caixa de entrada</p>
                {pendentes.length > 0 && (
                  <span className="h-5 px-1.5 min-w-[20px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                    {pendentes.length}
                  </span>
                )}
              </div>

              {isLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : lotesError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-4 flex items-start gap-3">
                  <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-400">{(lotesError as Error).message}</p>
                </div>
              ) : pendentes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm font-medium">Em dia</p>
                  <p className="text-xs mt-1">Nenhum lote aguardando assinatura</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {pendentes.map(lote => {
                    const st = STATUS[lote.status] ?? STATUS.signature_pending;
                    const urgent = lote.status === "imported" || lote.status === "signature_pending";
                    return (
                      <button key={lote.id} onClick={() => setSelectedLote(lote)}
                        className="w-full rounded-lg border border-border bg-card shadow-card p-4 flex items-center gap-4 hover:border-primary/30 hover:shadow-md transition-all text-left group">
                        <div className={cn("w-1 self-stretch rounded-full shrink-0", urgent ? "bg-primary" : "bg-amber-400")} />
                        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                          <FileText className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{lote.titulo}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <Badge className={cn("text-[10px] py-0", st.color)}>{st.label}</Badge>
                            <span className="text-xs text-muted-foreground">{lote.total_itens} paciente{lote.total_itens !== 1 ? "s" : ""}</span>
                            <span className="text-xs text-muted-foreground">{format(new Date(lote.created_at), "d MMM", { locale: ptBR })}</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Histórico */}
            {concluidos.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <History className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Histórico</p>
                </div>
                <div className="rounded-lg border border-border bg-card shadow-card divide-y divide-border overflow-hidden">
                  {concluidos.map(lote => (
                    <button key={lote.id} onClick={() => setSelectedLote(lote)}
                      className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/40 transition-colors text-left group">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{lote.titulo}</p>
                        <p className="text-xs text-muted-foreground">
                          {lote.total_itens} receita{lote.total_itens !== 1 ? "s" : ""} · {format(new Date(lote.created_at), "d MMM yyyy", { locale: ptBR })}
                        </p>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground shrink-0" />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

      </div>
    </div>
  );
}
