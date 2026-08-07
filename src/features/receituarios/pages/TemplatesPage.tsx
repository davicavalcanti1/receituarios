// /templates — configuração dos receituários (só admin)
//
// É a tela que tira do código o que era hardcoded: quais medicações entram no
// PDF, qual médico assina, e QUAIS ATENDIMENTOS o NetRis traz. Antes, mudar o
// médico da "Anestesia Dr. Félix" exigia editar gerarPdf.ts e fazer deploy.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";
import {
  Plus, Save, ArrowLeft, Loader2, ScrollText, Search,
  Stethoscope, FlaskConical, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAuth } from "@/shared/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useConfig } from "@/lib/config";
import {
  listarTemplates, salvarTemplate, templateNovo, type Template,
} from "@/features/receituarios/lib/templates";
import { aplicarFiltro, filtroVazio, type FiltroNetris } from "@/features/receituarios/lib/filtroNetris";
import { buscarAtendimentos } from "@/services/netris/atendimentos";
import { hojeISO, MODALIDADE, SITUACAO } from "@/services/netris/client";

interface MedicoOpcao { id: string; nome: string; crm: string | null }

// Só as modalidades que aparecem em receituário — a lista inteira do NetRis
// tem 16 e polui a tela.
const MODALIDADES_COMUNS: Array<{ id: number; label: string }> = [
  { id: MODALIDADE.ANESTESIA,            label: "Anestesia" },
  { id: MODALIDADE.ELETROENCEFALOGRAMA,  label: "Eletroencefalograma" },
  { id: MODALIDADE.RESSONANCIA,          label: "Ressonância" },
  { id: MODALIDADE.TOMOGRAFIA,           label: "Tomografia" },
  { id: MODALIDADE.USG,                  label: "Ultrassonografia" },
  { id: MODALIDADE.BIOPSIA_US,           label: "Biópsia US" },
  { id: MODALIDADE.MAMOGRAFIA,           label: "Mamografia" },
];

const SITUACOES_COMUNS: Array<{ id: number; label: string }> = [
  { id: SITUACAO.MARCADO,      label: "Marcado (sem confirmação)" },
  { id: SITUACAO.CANCELADO,    label: "Cancelado" },
  { id: SITUACAO.A_CONFIRMAR,  label: "A confirmar" },
  { id: SITUACAO.CONFIRMADO,   label: "Confirmado" },
];

// Listas de texto viram uma-por-linha no textarea: é o jeito mais direto de
// editar sem inventar um componente de chips.
const paraTexto = (l: string[]) => l.join("\n");
const deTexto   = (t: string) => t.split("\n").map(s => s.trim()).filter(Boolean);

function Campo({ label, dica, children }: { label: string; dica?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
      {children}
    </div>
  );
}

function Marcavel({ ativo, onToggle, children }: { ativo: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors",
        ativo ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground hover:bg-muted/50",
      )}
    >
      {children}
    </button>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────────
function Editor({ inicial, medicos, onVoltar }: {
  inicial: Template; medicos: MedicoOpcao[]; onVoltar: () => void;
}) {
  const { tenantId } = useAuth();
  const { config } = useConfig();
  const qc = useQueryClient();
  const [t, setT] = useState<Template>(inicial);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [resultadoTeste, setResultadoTeste] = useState<{ total: number; casaram: number; exemplos: string[] } | null>(null);

  const novo = !t.id;
  const set = (patch: Partial<Template>) => setT(prev => ({ ...prev, ...patch }));
  const setFiltro = (patch: Partial<FiltroNetris>) =>
    setT(prev => ({ ...prev, filtroNetris: { ...prev.filtroNetris, ...patch } }));

  function alternar(lista: number[], id: number): number[] {
    return lista.includes(id) ? lista.filter(x => x !== id) : [...lista, id];
  }

  async function salvar() {
    if (!t.nome.trim())   { toast.error("Dê um nome ao receituário"); return; }
    if (!t.codigo.trim()) { toast.error("O código é obrigatório"); return; }
    if (!tenantId)        { toast.error("Sem tenant no perfil — refaça o login"); return; }
    setSalvando(true);
    try {
      await salvarTemplate(t, tenantId);
      qc.invalidateQueries({ queryKey: ["templates"] });
      qc.invalidateQueries({ queryKey: ["templates-admin"] });
      toast.success("Receituário salvo");
      onVoltar();
    } catch (e: any) {
      toast.error("Erro ao salvar", { description: e?.message });
    } finally { setSalvando(false); }
  }

  // Testar o filtro contra o NetRis de hoje. Sem isso, configurar filtro é às
  // cegas — só se descobre o erro na hora de gerar o lote.
  async function testarFiltro() {
    setTestando(true);
    setResultadoTeste(null);
    try {
      const hoje = hojeISO();
      const ats = await buscarAtendimentos({ dataInicial: hoje, dataFinal: hoje });
      const casaram = aplicarFiltro(ats, t.filtroNetris);
      setResultadoTeste({
        total: ats.length,
        casaram: casaram.length,
        exemplos: casaram.slice(0, 5).map(a => `${a.nomePaciente} — ${a.exame ?? "?"}${a.medico ? ` (${a.medico})` : ""}`),
      });
    } catch (e: any) {
      toast.error("Erro ao consultar o NetRis", { description: e?.message });
    } finally { setTestando(false); }
  }

  const semCriterio = filtroVazio(t.filtroNetris);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onVoltar} className="gap-1.5 shrink-0">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">
            {novo ? "Novo receituário" : "Editando"}
          </p>
          <h2 className="text-lg font-extrabold tracking-tight text-foreground truncate">
            {t.nome || "Sem nome"}
          </h2>
        </div>
        <Button onClick={salvar} disabled={salvando} className="gap-2 shrink-0">
          {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar
        </Button>
      </div>

      {/* Identificação */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Identificação</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Campo label="Nome">
            <Input value={t.nome} onChange={e => set({ nome: e.target.value })} placeholder="Anestesia Dr. Felix" />
          </Campo>
          <Campo label="Código" dica={novo ? "Identificador interno, sem espaços. Não muda depois." : "Não pode ser alterado — os lotes existentes apontam para ele."}>
            <Input
              value={t.codigo}
              onChange={e => set({ codigo: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
              placeholder="anestesia_dr_felix"
              disabled={!novo}
            />
          </Campo>
          <Campo label="Descrição">
            <Input value={t.descricao ?? ""} onChange={e => set({ descricao: e.target.value })} placeholder="Receituário de anestesia em lote" />
          </Campo>
          <Campo label="Ordem na lista">
            <Input type="number" value={t.ordem ?? 0} onChange={e => set({ ordem: Number(e.target.value) })} />
          </Campo>
          <div className="sm:col-span-2 flex gap-2">
            <Marcavel ativo={t.ativo !== false} onToggle={() => set({ ativo: t.ativo === false })}>
              {t.ativo !== false ? "Ativo" : "Inativo"}
            </Marcavel>
          </div>
        </CardContent>
      </Card>

      {/* Médico */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-primary" /> Médico
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Campo label="Médico padrão" dica="Já vem selecionado ao criar um lote deste tipo. É quem assina digitalmente.">
            <select
              value={t.medicoPadraoId ?? ""}
              onChange={e => set({ medicoPadraoId: e.target.value || null })}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
            >
              <option value="">Nenhum — escolher a cada lote</option>
              {medicos.map(m => (
                <option key={m.id} value={m.id}>{m.nome}{m.crm ? ` — CRM ${m.crm}` : ""}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Imprimir campo &quot;MÉDICO:&quot;">
            <Marcavel ativo={!!t.mostrarMedico} onToggle={() => set({ mostrarMedico: !t.mostrarMedico })}>
              {t.mostrarMedico ? "Sim" : "Não"}
            </Marcavel>
          </Campo>

          <div className="sm:col-span-2 rounded-lg border border-border bg-muted/20 p-4 space-y-3">
            <p className="text-sm font-medium">Bloco de assinatura impresso</p>
            <p className="text-xs text-muted-foreground">
              Sai no PDF <strong>sem</strong> assinatura digital. Quando o médico assina no portal,
              este bloco é substituído pelos dados dele.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["nome", "cargo", "crm"] as const).map(campo => (
                <Input
                  key={campo}
                  value={t.assinatura?.[campo] ?? ""}
                  placeholder={{ nome: "FÉLIX SOARES NÓBREGA", cargo: "ANESTESIOLOGISTA", crm: "CRM-PB: 7608" }[campo]}
                  onChange={e => {
                    const base = t.assinatura ?? { nome: "", cargo: "", crm: "" };
                    const atualizado = { ...base, [campo]: e.target.value };
                    const vazio = !atualizado.nome && !atualizado.cargo && !atualizado.crm;
                    set({ assinatura: vazio ? null : atualizado });
                  }}
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Conteúdo do receituário */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" /> Conteúdo do receituário
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Campo label="Título impresso">
            <Input value={t.titulo} onChange={e => set({ titulo: e.target.value })} />
          </Campo>

          <Campo
            label="Medicações"
            dica="Uma por linha, cada uma vira um item com caixa de marcar. Deixe uma linha em branco para gerar um espaço a preencher à mão."
          >
            <Textarea
              value={t.itens.join("\n")}
              onChange={e => set({ itens: e.target.value.split("\n").map(s => s.trim()) })}
              className="min-h-[120px] font-mono text-xs"
              placeholder={"FENTANIL\nMIDAZOLAM\nPROPOFOL"}
            />
          </Campo>

          <div className="flex flex-wrap gap-2">
            <Marcavel ativo={!!t.comOutro} onToggle={() => set({ comOutro: !t.comOutro })}>
              Incluir linha &quot;OUTRO: ____&quot;
            </Marcavel>
            <Marcavel ativo={!!t.derivarSetor} onToggle={() => set({ derivarSetor: !t.derivarSetor, setorFixo: "" })}>
              Setor derivado do exame/sala
            </Marcavel>
          </div>

          {!t.derivarSetor ? (
            <Campo label="Setor fixo" dica="Texto impresso sempre no campo SETOR.">
              <Input
                value={t.setorFixo ?? ""}
                onChange={e => set({ setorFixo: e.target.value })}
                placeholder="ELETROENCEFALOGRAMA EM VIGILIA…"
              />
            </Campo>
          ) : (
            <Campo
              label="Regras de setor"
              dica="Uma por linha, no formato TERMO = SETOR. Casa contra sala + procedimento; vence a primeira que casar. Se o atendimento já traz setor, ele tem prioridade."
            >
              <Textarea
                value={t.setorRegras.map(r => `${r.termos.join(", ")} = ${r.setor}`).join("\n")}
                onChange={e => set({
                  setorRegras: e.target.value.split("\n").map(l => {
                    const [esq, ...resto] = l.split("=");
                    const setor = resto.join("=").trim();
                    const termos = (esq ?? "").split(",").map(x => x.trim()).filter(Boolean);
                    return { termos, setor };
                  }).filter(r => r.termos.length > 0 && r.setor),
                })}
                className="min-h-[110px] font-mono text-xs"
                placeholder={"RESSON = RESSONÂNCIA\nTOMO = TOMOGRAFIA\nULTRA, USG = ULTRASSONOGRAFIA"}
              />
            </Campo>
          )}
        </CardContent>
      </Card>

      {/* Busca no NetRis */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" /> Quais pacientes o NetRis traz
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!config.integracoes.netris && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              A integração NetRis está desligada neste ambiente. A configuração fica guardada,
              mas a busca por data não aparece no novo lote.
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Um atendimento entra quando: <strong>(casa algum termo de exame OU alguma modalidade)</strong>{" "}
            <strong>E</strong> casa algum termo de médico (se houver) <strong>E</strong> a situação não está excluída.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              label="Termos no nome do exame"
              dica="Um por linha. Dentro de um termo, TODAS as palavras precisam aparecer; entre termos, basta um casar."
            >
              <Textarea
                value={paraTexto(t.filtroNetris.termos_exame)}
                onChange={e => setFiltro({ termos_exame: deTexto(e.target.value) })}
                className="min-h-[90px] font-mono text-xs"
                placeholder={"ANESTESIA"}
              />
            </Campo>

            <Campo
              label="Termos no nome do médico"
              dica='Vazio = qualquer médico. "IGOR GONDIM" casa com "IGOR SILVEIRA DE CASTRO GONDIM".'
            >
              <Textarea
                value={paraTexto(t.filtroNetris.termos_medico)}
                onChange={e => setFiltro({ termos_medico: deTexto(e.target.value) })}
                className="min-h-[90px] font-mono text-xs"
                placeholder={"IGOR GONDIM\nIGOR CASTRO"}
              />
            </Campo>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Termos no nome da sala" dica="Vazio = qualquer sala.">
              <Textarea
                value={paraTexto(t.filtroNetris.termos_sala)}
                onChange={e => setFiltro({ termos_sala: deTexto(e.target.value) })}
                className="min-h-[70px] font-mono text-xs"
                placeholder={"RESSONANCIA"}
              />
            </Campo>

            <Campo label="Termos no convênio" dica="Vazio = qualquer convênio.">
              <Textarea
                value={paraTexto(t.filtroNetris.termos_convenio)}
                onChange={e => setFiltro({ termos_convenio: deTexto(e.target.value) })}
                className="min-h-[70px] font-mono text-xs"
                placeholder={"UNIMED"}
              />
            </Campo>
          </div>

          <Campo label="Modalidades" dica="Alternativa aos termos de exame: entra se casar por qualquer um dos dois.">
            <div className="flex flex-wrap gap-2">
              {MODALIDADES_COMUNS.map(m => (
                <Marcavel
                  key={m.id}
                  ativo={t.filtroNetris.modalidades.includes(m.id)}
                  onToggle={() => setFiltro({ modalidades: alternar(t.filtroNetris.modalidades, m.id) })}
                >
                  {m.label}
                </Marcavel>
              ))}
            </div>
          </Campo>

          <Campo label="Situações descartadas" dica="Atendimentos nessas situações não entram no lote.">
            <div className="flex flex-wrap gap-2">
              {SITUACOES_COMUNS.map(s => (
                <Marcavel
                  key={s.id}
                  ativo={t.filtroNetris.situacoes_excluir.includes(s.id)}
                  onToggle={() => setFiltro({ situacoes_excluir: alternar(t.filtroNetris.situacoes_excluir, s.id) })}
                >
                  {s.label}
                </Marcavel>
              ))}
            </div>
          </Campo>

          {semCriterio && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Sem nenhum critério de exame, modalidade ou médico, <strong>todos</strong> os
                atendimentos do dia entram no lote.
              </p>
            </div>
          )}

          {/* Teste contra o NetRis real */}
          {config.integracoes.netris && (
            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm font-medium">Testar com os atendimentos de hoje</p>
                <Button variant="outline" size="sm" onClick={testarFiltro} disabled={testando} className="gap-1.5">
                  {testando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  Testar filtro
                </Button>
              </div>
              {resultadoTeste && (
                <div className="space-y-2">
                  <p className="text-sm flex items-center gap-2">
                    <CheckCircle2 className={cn("h-4 w-4", resultadoTeste.casaram > 0 ? "text-emerald-500" : "text-muted-foreground")} />
                    <strong>{resultadoTeste.casaram}</strong> de {resultadoTeste.total} atendimentos de hoje casam.
                  </p>
                  {resultadoTeste.exemplos.length > 0 && (
                    <ul className="text-xs text-muted-foreground space-y-0.5 pl-6 list-disc">
                      {resultadoTeste.exemplos.map((ex, i) => <li key={i}>{ex}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────
export default function TemplatesPage() {
  const { papel } = useAuth();
  const [editando, setEditando] = useState<Template | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["templates-admin"],
    queryFn: () => listarTemplates(true),
  });

  const { data: medicos = [] } = useQuery<MedicoOpcao[]>({
    queryKey: ["medicos-lista"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("medicos").select("id, nome, crm").eq("ativo", true).order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (papel !== "admin") return <Navigate to="/receituarios" replace />;

  if (editando) {
    return (
      <MainLayout>
        <div className="animate-fade-in">
          <Editor inicial={editando} medicos={medicos} onVoltar={() => setEditando(null)} />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          eyebrow="Configuração"
          title="Receituários"
          subtitle="Medicações, médico responsável e quais pacientes vêm do NetRis"
          actions={
            <Button onClick={() => setEditando(templateNovo())} className="gap-2">
              <Plus className="h-4 w-4" /> Novo receituário
            </Button>
          }
        />

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />)}
          </div>
        ) : templates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
            <ScrollText className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Nenhum receituário configurado</p>
            <p className="text-xs mt-1">Crie o primeiro para poder gerar lotes.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map(t => {
              const medico = medicos.find(m => m.id === t.medicoPadraoId);
              return (
                <button
                  key={t.codigo}
                  onClick={() => setEditando(t)}
                  className="w-full rounded-lg border border-border bg-card shadow-card p-4 flex items-center gap-4 hover:border-primary/30 hover:shadow-lg transition-all text-left group"
                >
                  <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <ScrollText className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{t.nome}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {t.ativo === false && <Badge className="bg-muted text-muted-foreground text-[10px] py-0">Inativo</Badge>}
                      <span className="text-xs text-muted-foreground">{t.itens.filter(Boolean).length} medicação(ões)</span>
                      {medico && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Stethoscope className="h-3 w-3" />{medico.nome}
                        </span>
                      )}
                      {filtroVazio(t.filtroNetris) && (
                        <span className="text-xs text-amber-600 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />sem filtro do NetRis
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </MainLayout>
  );
}
