import { useMemo, useRef, useState, useEffect } from "react";
import { logError } from "@/lib/logger";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft, ScrollText, Upload, ClipboardPaste, CheckCircle2, AlertCircle, AlertTriangle, FileText,
  Search, Loader2, UserCheck, Download,
} from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  parseLote, linhaDeValores, resumoLinhas,
  CAMPOS_LOTE, type CampoLote, type ResultadoParse,
} from "@/features/receituarios/lib/parseLote";
import { buscarAtendimentos } from "@/services/netris/atendimentos";
import { hojeISO, SITUACAO } from "@/services/netris/client";
import { gerarPdfLote } from "@/features/receituarios/lib/gerarPdf";
import { receituariosService } from "@/features/receituarios/services/receituariosService";
import { useAuth } from "@/shared/contexts/AuthContext";

const TIPOS = [
  { id: "anestesia_dr_felix", label: "Anestesia Dr. Felix", desc: "Receituário de anestesia em lote" },
  { id: "longactil",          label: "Longactil",            desc: "Receituário de Longactil em lote" },
] as const;
type TipoReceita = (typeof TIPOS)[number]["id"];

const COL_LABELS: Record<CampoLote, string> = {
  data_exame: "Data", horario: "Horário", paciente: "Paciente", procedimento: "Procedimento",
  situacao: "Situação", convenio: "Convênio", sala: "Sala", medico: "Médico", setor: "Setor",
};

// Colunas que a busca do NetRis preenche (sem "setor", que é regra posterior).
const COLUNAS_NETRIS: CampoLote[] = ["data_exame", "horario", "paciente", "procedimento", "situacao", "convenio", "sala", "medico"];

// Um atendimento é "de anestesia" se o procedimento cita anestesia ou a
// modalidade NetRis é Anestesia (id 3).
function ehAnestesia(exame: string | undefined, modalidadeId: number | undefined): boolean {
  return (exame ?? "").toUpperCase().includes("ANESTESIA") || modalidadeId === 3;
}

// Um atendimento é de EEG do Dr. Igor Gondim se:
//   - o nome do exame contém "ELETROENCEFALOGRAMA" ou "EEG", E
//   - o nome do médico contém "IGOR" e ("GONDIM" ou "CASTRO")
function ehEegIgorGondim(exame: string | undefined, medico: string | undefined): boolean {
  const ex  = (exame  ?? "").toUpperCase();
  const med = (medico ?? "").toUpperCase();
  const isEeg    = ex.includes("ELETROENCEFALOGRAMA") || ex.includes("EEG");
  const isIgor   = med.includes("IGOR") && (med.includes("GONDIM") || med.includes("CASTRO"));
  return isEeg && isIgor;
}

// Situações descartadas na busca: apenas marcados simples (futuro sem confirmação)
// e cancelados. A_CONFIRMAR e CONFIRMADO entram porque já têm data definida.
const SITUACOES_EXCLUIR: number[] = [SITUACAO.MARCADO, SITUACAO.CANCELADO];

interface Medico { id: string; full_name: string; crm: string | null; especialidade: string | null; }

export default function NovoLoteReceituario() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [gerando, setGerando] = useState(false);

  const [tipo, setTipo] = useState<TipoReceita | null>(null);
  const [texto, setTexto] = useState("");
  const [resultado, setResultado] = useState<ResultadoParse | null>(null);

  // Seletor de médico
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [medicoId, setMedicoId] = useState<string>("");

  useEffect(() => {
    if (!profile?.tenant_id) return;
    (async () => {
      // Busca em duas etapas: user_roles não tem FK direta pra profiles
      const { data: roles } = await (supabase as any)
        .from("user_roles")
        .select("user_id")
        .eq("tenant_id", profile.tenant_id)
        .eq("role", "medico");

      const ids = (roles ?? []).map((r: any) => r.user_id as string);
      if (!ids.length) return;

      const { data: profs } = await (supabase as any)
        .from("profiles")
        .select("id, full_name, crm, especialidade")
        .in("id", ids);

      setMedicos((profs ?? []).map((p: any) => ({
        id:            p.id,
        full_name:     p.full_name,
        crm:           p.crm,
        especialidade: p.especialidade,
      })));
    })();
  }, [profile?.tenant_id]);

  // Busca no NetRis
  const [dataInicial, setDataInicial] = useState(hojeISO());
  const [dataFinal, setDataFinal] = useState(hojeISO());
  const [buscando, setBuscando] = useState(false);

  function processar(conteudo: string) {
    const r = parseLote(conteudo);
    setResultado(r);
    if (r.linhas.length === 0) {
      toast.error("Nada para importar", { description: "Não encontrei linhas de dados abaixo do cabeçalho." });
    } else if (r.colunasReconhecidas.length === 0) {
      toast.error("Colunas não reconhecidas", { description: "Verifique se a primeira linha tem os títulos (Paciente, Procedimento, etc.)." });
    }
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const conteudo = String(reader.result ?? "");
      setTexto(conteudo);
      processar(conteudo);
    };
    reader.readAsText(file, "utf-8");
  }

  async function buscarNoNetris() {
    if (!dataInicial || !dataFinal) {
      toast.error("Selecione as datas");
      return;
    }
    if (dataInicial > dataFinal) {
      toast.error("Período inválido", { description: "A data inicial é depois da final." });
      return;
    }
    setBuscando(true);
    try {
      const ats = await buscarAtendimentos({ dataInicial, dataFinal });

      // Filtra de acordo com o tipo de receita selecionado
      const filtrados = tipo === "longactil"
        ? ats.filter(a => ehEegIgorGondim(a.exame, a.medico) && !SITUACOES_EXCLUIR.includes(a.situacaoId))
        : ats.filter(a => ehAnestesia(a.exame, a.modalidadeId) && !SITUACOES_EXCLUIR.includes(a.situacaoId));

      const linhas = filtrados.map((a, i) => linhaDeValores(i + 1, {
        data_exame:   a.dataHora ?? "",
        horario:      a.horario ?? "",
        paciente:     a.nomePaciente,
        procedimento: a.exame,
        situacao:     a.situacao ?? "",
        convenio:     a.convenio ?? "",
        sala:         a.sala ?? "",
        medico:       a.medico ?? "",
      }));
      setResultado({
        linhas,
        colunasReconhecidas: COLUNAS_NETRIS,
        cabecalhosIgnorados: [],
        ...resumoLinhas(linhas),
      });
      if (linhas.length === 0) {
        const msgVazia = tipo === "longactil"
          ? "Não há eletroencefalogramas do Dr. Igor Gondim no período selecionado."
          : "Não há atendimentos de anestesia no período selecionado.";
        toast("Nenhum resultado encontrado", { description: msgVazia });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Erro ao buscar no NetRis", { description: msg });
    } finally {
      setBuscando(false);
    }
  }

  const faltando = useMemo(() => {
    if (!resultado) return [];
    return CAMPOS_LOTE.filter(c => !resultado.colunasReconhecidas.includes(c));
  }, [resultado]);

  const podeGerar = !!tipo && !!resultado && resultado.totalValidas > 0;

  return (
    <MainLayout>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/receituarios")} aria-label="Voltar">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100">
            <ScrollText className="h-5 w-5 text-sky-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Novo lote de receituário</h1>
            <p className="text-sm text-muted-foreground">Busque os pacientes pela data ou cole a lista, confira e gere o PDF</p>
          </div>
        </div>

        {/* Passo 1 — tipo de receita */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">1. Tipo de receita</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {TIPOS.map(t => (
              <button
                key={t.id}
                onClick={() => setTipo(t.id)}
                className={cn(
                  "rounded-lg border px-4 py-3 text-left transition-colors",
                  tipo === t.id ? "border-sky-500 bg-sky-50 ring-1 ring-sky-500" : "hover:bg-muted/50",
                )}
              >
                <p className="font-medium">{t.label}</p>
                <p className="text-sm text-muted-foreground">{t.desc}</p>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Passo 2 — médico responsável */}
        {medicos.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-primary" />
                2. Médico responsável
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {medicos.map(m => {
                  const selecionado = medicoId === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setMedicoId(prev => prev === m.id ? "" : m.id)}
                      className={cn(
                        "rounded-lg border px-4 py-3 text-left transition-all relative",
                        selecionado
                          ? "border-primary bg-primary/5 ring-2 ring-primary/30 shadow-sm"
                          : "border-border hover:border-primary/40 hover:bg-muted/50",
                      )}
                    >
                      {selecionado && (
                        <span className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                          <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                        </span>
                      )}
                      <p className="font-semibold text-sm text-foreground pr-6">{m.full_name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {[m.especialidade, m.crm].filter(Boolean).join(" · ")}
                      </p>
                    </button>
                  );
                })}
              </div>
              {/* Confirmação visual */}
              {medicoId ? (
                <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-400 rounded-lg px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Médico selecionado: <strong>{medicos.find(m => m.id === medicoId)?.full_name}</strong></span>
                </div>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Nenhum médico selecionado — lote será salvo sem atribuição
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Passo 3 — origem dos pacientes */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{medicos.length > 0 ? "3." : "2."} Pacientes</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="netris">
              <TabsList>
                <TabsTrigger value="netris" className="gap-2"><Search className="h-4 w-4" /> Buscar por data</TabsTrigger>
                <TabsTrigger value="manual" className="gap-2"><ClipboardPaste className="h-4 w-4" /> Colar / CSV</TabsTrigger>
              </TabsList>

              {/* Busca no NetRis por data */}
              <TabsContent value="netris" className="space-y-3 pt-3">
                {tipo === "longactil" ? (
                  <p className="text-sm text-muted-foreground">
                    Busca automaticamente os <strong>eletroencefalogramas</strong> do{" "}
                    <strong>Dr. Igor Silveira de Castro Gondim</strong> no NetRis.
                    Inclui situações A Confirmar e Confirmado. Apenas marcados simples e cancelados são descartados.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Escolha o período e busque automaticamente os atendimentos de <strong>anestesia</strong> no NetRis.
                    Inclui situações A Confirmar e Confirmado. Apenas marcados simples e cancelados são descartados.
                  </p>
                )}
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Data inicial</label>
                    <Input type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} className="w-44" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Data final</label>
                    <Input type="date" value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} className="w-44" />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setDataInicial(hojeISO()); setDataFinal(hojeISO()); }}>Hoje</Button>
                    <Button onClick={buscarNoNetris} disabled={buscando || !tipo} className="gap-2">
                      {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      {buscando ? "Buscando…" : tipo === "longactil" ? "Buscar EEG Dr. Igor" : "Buscar anestesias"}
                    </Button>
                  </div>
                  {!tipo && (
                    <p className="text-xs text-amber-600">Selecione o tipo de receita no passo 1 para buscar.</p>
                  )}
                </div>
              </TabsContent>

              {/* Colagem / CSV */}
              <TabsContent value="manual" className="space-y-3 pt-3">
                <p className="text-sm text-muted-foreground">
                  Cole a grade direto do NetRis/Excel (com a 1ª linha de títulos) ou envie um .csv.
                  Se a Situação vier numa linha separada, tudo bem — o sistema junta cada paciente pela Data.
                  Colunas reconhecidas: {CAMPOS_LOTE.map(c => COL_LABELS[c]).join(", ")}.
                </p>
                <Textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder={"Data\tHorário\tPaciente\tProcedimento\tSituação\tConvênio\tSala\tMédico\n02/04/2026\t06:50/20min\tFULANO DE TAL\tANESTESIA RM\tFATURADO\tUNIMED\tRESSONÂNCIA\tDR. FELIX"}
                  className="min-h-[140px] font-mono text-xs"
                />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => processar(texto)} disabled={!texto.trim()} className="gap-2">
                    <ClipboardPaste className="h-4 w-4" /> Processar texto colado
                  </Button>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onUpload} />
                  <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-2">
                    <Upload className="h-4 w-4" /> Enviar .csv
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Passo 3 — preview */}
        {resultado && resultado.linhas.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">3. Conferência ({resultado.linhas.length} linhas)</CardTitle>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {resultado.totalValidas} válidas
                </Badge>
                {resultado.totalInvalidas > 0 && (
                  <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700 gap-1">
                    <AlertCircle className="h-3.5 w-3.5" /> {resultado.totalInvalidas} com erro
                  </Badge>
                )}
                {faltando.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Colunas não encontradas: {faltando.map(c => COL_LABELS[c]).join(", ")}
                  </span>
                )}
                {resultado.cabecalhosIgnorados.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Ignoradas: {resultado.cabecalhosIgnorados.join(", ")}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      {resultado.colunasReconhecidas.map(c => (
                        <TableHead key={c}>{COL_LABELS[c]}</TableHead>
                      ))}
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resultado.linhas.map(linha => (
                      <TableRow key={linha.index} className={cn(linha.erros.length > 0 && "bg-red-50/60")}>
                        <TableCell className="text-muted-foreground">{linha.index}</TableCell>
                        {resultado.colunasReconhecidas.map(c => (
                          <TableCell key={c} className="whitespace-nowrap">{linha[c] || "—"}</TableCell>
                        ))}
                        <TableCell>
                          {linha.erros.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 text-xs">
                              <CheckCircle2 className="h-3.5 w-3.5" /> ok
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-600 text-xs">
                              <AlertCircle className="h-3.5 w-3.5" /> {linha.erros.join(", ")}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                {!tipo && <p className="text-sm text-amber-600">Selecione o tipo de receita no passo 1.</p>}
                <Button
                  variant="outline"
                  className="gap-2"
                  disabled={!podeGerar || gerando}
                  onClick={async () => {
                    if (!tipo || !resultado) return;
                    setGerando(true);
                    try {
                      await gerarPdfLote(tipo, resultado.linhas);
                    } catch (e: any) {
                      toast.error("Erro ao gerar PDF", { description: e?.message });
                    } finally {
                      setGerando(false);
                    }
                  }}
                >
                  <Download className="h-4 w-4" /> Baixar PDF (sem assinatura)
                </Button>
                <Button
                  className="gap-2 ml-auto"
                  disabled={!podeGerar || gerando}
                  onClick={async () => {
                    if (!tipo || !resultado) return;
                    setGerando(true);
                    try {
                      // Salva o lote pra permitir rebaixar o PDF depois
                      const tenantId = profile?.tenant_id;
                      if (tenantId) {
                        try {
                          const tipoLabel = TIPOS.find(t => t.id === tipo)?.label ?? tipo;
                          console.info("[NovoLote] medicoId selecionado:", medicoId || "(nenhum)");
                          const lote = await receituariosService.criarLote({
                            tenantId,
                            userId:       profile?.id,
                            tipo,
                            titulo:       `${tipoLabel} — ${new Date().toLocaleDateString("pt-BR")}`,
                            linhas:       resultado.linhas,
                            doctorUserId: medicoId || undefined,
                          });
                          console.info("[NovoLote] lote criado:", lote);
                          // Notifica o médico se foi atribuído
                          if (medicoId && lote?.id) {
                            await (supabase as any).from("sys_notifications").insert({
                              user_id:   medicoId,
                              tenant_id: tenantId,
                              title:     "Novo lote para assinar",
                              body:      `Lote atribuído a você: ${tipoLabel} — ${new Date().toLocaleDateString("pt-BR")}`,
                              type:      "receituario_atribuido",
                              data:      { job_id: lote.id },
                            });
                          }
                          qc.invalidateQueries({ queryKey: ["todos-lotes"] });
                          toast.success("Lote salvo!", {
                            description: medicoId
                              ? "Médico notificado. Baixe o PDF na lista de lotes."
                              : "Lote salvo. Baixe o PDF na lista de lotes.",
                          });
                          navigate("/receituarios");
                          return; // não baixa o PDF automaticamente
                        } catch (err: any) {
                          logError("[NovoLote] erro ao salvar:", err);
                          toast.error("Lote não foi salvo.", { description: err?.message ?? String(err) });
                        }
                      }
                    } finally {
                      setGerando(false);
                    }
                  }}
                >
                  <FileText className="h-4 w-4" /> {gerando ? "Salvando…" : `Salvar lote (${resultado.totalValidas} receitas)`}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}
