// /templates — configuração dos receituários (só admin)
//
// É a tela que tira do código o que era hardcoded: quais medicações entram no
// PDF, qual médico assina, e QUAIS ATENDIMENTOS o NetRis traz. Antes, mudar o
// médico da "Anestesia Dr. Félix" exigia editar gerarPdf.ts e fazer deploy.
//
// Tudo que vem do NetRis é ESCOLHIDO de uma lista carregada do próprio NetRis,
// nunca digitado: um "ANASTESIA" com erro de grafia fazia o filtro não trazer
// ninguém, em silêncio.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";
import {
  Plus, Save, ArrowLeft, Loader2, ScrollText, Search, RefreshCw,
  Stethoscope, FlaskConical, AlertTriangle, CheckCircle2, X,
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
import { aplicarFiltro, type FiltroNetris } from "@/features/receituarios/lib/filtroNetris";
import { carregarOpcoesNetris, type Opcao, type OpcoesNetris } from "@/features/receituarios/lib/opcoesNetris";

interface MedicoOpcao { id: string; nome: string; crm: string | null }

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

// ── Seleção múltipla ─────────────────────────────────────────────────────────
// A caixa de busca filtra a LISTA — não é onde se configura o valor. Sem ela,
// uma clínica com 300 exames vira uma parede de opções.
function Selecao({ titulo, dica, opcoes, selecionados, onChange }: {
  titulo: string; dica?: string; opcoes: Opcao[];
  selecionados: string[]; onChange: (v: string[]) => void;
}) {
  const [busca, setBusca] = useState("");
  const [verTodos, setVerTodos] = useState(false);

  const filtradas = useMemo(() => {
    const b = busca.trim().toLowerCase();
    const base = b ? opcoes.filter(o => o.rotulo.toLowerCase().includes(b)) : opcoes;
    return verTodos ? base : base.slice(0, 12);
  }, [opcoes, busca, verTodos]);

  const escolhidas = opcoes.filter(o => selecionados.includes(o.valor));
  // Valor gravado que não apareceu no período carregado — não some da tela.
  const orfaos = selecionados.filter(v => !opcoes.some(o => o.valor === v));

  function alternar(valor: string) {
    onChange(selecionados.includes(valor)
      ? selecionados.filter(v => v !== valor)
      : [...selecionados, valor]);
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-sm font-medium text-foreground">
          {titulo}
          {selecionados.length > 0 && (
            <span className="ml-2 text-xs font-normal text-primary">{selecionados.length} selecionado(s)</span>
          )}
        </p>
        {opcoes.length > 12 && (
          <Input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar na lista…"
            className="h-7 w-44 text-xs"
          />
        )}
      </div>
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}

      {escolhidas.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-1">
          {escolhidas.map(o => (
            <button
              key={o.valor}
              type="button"
              onClick={() => alternar(o.valor)}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary px-2.5 py-1 text-xs text-primary"
            >
              {o.rotulo} <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      {orfaos.length > 0 && (
        <p className="text-xs text-amber-600">
          {orfaos.length} valor(es) selecionado(s) não apareceram no período carregado — continuam valendo.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {filtradas.filter(o => !selecionados.includes(o.valor)).map(o => (
          <button
            key={o.valor}
            type="button"
            onClick={() => alternar(o.valor)}
            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/50 hover:border-primary/40 transition-colors"
          >
            {o.rotulo}
            <span className="ml-1 opacity-50">{o.ocorrencias}</span>
          </button>
        ))}
      </div>

      {!verTodos && opcoes.length > 12 && (
        <button type="button" onClick={() => setVerTodos(true)} className="text-xs text-primary hover:underline">
          ver todas as {opcoes.length} opções
        </button>
      )}
    </div>
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

  // As opções carregam sozinhas ao abrir — sem botão nem escolha de período.
  // 30 dias é o bastante para conter tudo que a clínica faz com frequência.
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(false);
  const [opcoes, setOpcoes] = useState<OpcoesNetris | null>(null);

  const novo = !t.id;
  const set = (patch: Partial<Template>) => setT(prev => ({ ...prev, ...patch }));
  const setFiltro = (patch: Partial<FiltroNetris>) =>
    setT(prev => ({ ...prev, filtroNetris: { ...prev.filtroNetris, ...patch } }));

  // Contagem ao vivo sobre os atendimentos já carregados: o número muda
  // conforme se marca e desmarca, então não precisa de botão "testar".
  const { casamAgora, exemplosAgora } = useMemo(() => {
    if (!opcoes) return { casamAgora: 0, exemplosAgora: [] as string[] };
    const casaram = aplicarFiltro(opcoes.atendimentos, t.filtroNetris);
    return {
      casamAgora: casaram.length,
      exemplosAgora: casaram.slice(0, 3).map(
        a => `${a.nomePaciente} — ${a.exame ?? "?"}${a.medico ? ` (${a.medico})` : ""}`,
      ),
    };
  }, [opcoes, t.filtroNetris]);

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

  const carregarOpcoes = useCallback(async () => {
    setCarregandoOpcoes(true);
    try {
      setOpcoes(await carregarOpcoesNetris(30));
    } catch (e: any) {
      toast.error("Erro ao carregar as opções do NetRis", { description: e?.message });
    } finally { setCarregandoOpcoes(false); }
  }, []);

  useEffect(() => {
    if (config.integracoes.netris) carregarOpcoes();
  }, [config.integracoes.netris, carregarOpcoes]);

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
          <div className="sm:col-span-2">
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
                  placeholder={{ nome: "Nome do médico", cargo: "Especialidade", crm: "CRM-PB: 0000" }[campo]}
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
              dica="Uma por linha, no formato TERMO = SETOR. Casa contra sala + procedimento; vence a primeira. Se o atendimento já traz setor, ele tem prioridade."
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
            <Search className="h-4 w-4 text-primary" /> Quais pacientes vêm do NetRis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!config.integracoes.netris ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              A integração NetRis está desligada. Ligue em Configurações → Integração.
            </div>
          ) : carregandoOpcoes ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando o que existe no NetRis…
            </div>
          ) : !opcoes ? (
            <div className="flex items-center gap-3 py-2">
              <p className="text-sm text-muted-foreground">Não consegui carregar as opções.</p>
              <Button variant="outline" size="sm" onClick={carregarOpcoes} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" /> Tentar de novo
              </Button>
            </div>
          ) : (
            <>
              <Selecao
                titulo="Situações"
                dica="Nenhuma marcada = todas entram."
                opcoes={opcoes.situacoes}
                selecionados={t.filtroNetris.situacoes.map(String)}
                onChange={v => setFiltro({ situacoes: v.map(Number), situacoes_excluir: [] })}
              />
              <Selecao
                titulo="Exames"
                dica="Nenhum marcado = todos entram."
                opcoes={opcoes.exames}
                selecionados={t.filtroNetris.exames}
                onChange={v => setFiltro({ exames: v, termos_exame: [], modalidades: [] })}
              />
              <Selecao
                titulo="Médicos"
                dica="Nenhum marcado = todos entram."
                opcoes={opcoes.medicos}
                selecionados={t.filtroNetris.medicos}
                onChange={v => setFiltro({ medicos: v, termos_medico: [] })}
              />

              {/* Contagem ao vivo sobre os dados já carregados — sem botão de
                  testar: o número muda conforme se marca e desmarca. */}
              <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                <p className="text-sm">
                  <strong>{casamAgora}</strong> de {opcoes.totalAtendimentos} atendimentos dos
                  últimos 30 dias entram neste receituário.
                </p>
                {exemplosAgora.length > 0 && (
                  <ul className="text-xs text-muted-foreground space-y-0.5 mt-1.5 pl-4 list-disc">
                    {exemplosAgora.map((ex, i) => <li key={i}>{ex}</li>)}
                  </ul>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────
// Renderizado como aba de /configuracoes — sem MainLayout nem PageHeader
// próprios, que vêm da página pai.
export function ConfiguracaoReceituarios() {
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

  if (editando) {
    return <Editor inicial={editando} medicos={medicos} onVoltar={() => setEditando(null)} />;
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <p className="text-sm text-muted-foreground max-w-xl">
            Cada receituário define as medicações impressas, quem assina e quais
            pacientes vêm do NetRis.
          </p>
          <Button onClick={() => setEditando(templateNovo())} className="gap-2">
            <Plus className="h-4 w-4" /> Novo receituário
          </Button>
        </div>

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
                      {false && (
                        <span className="text-xs text-amber-600 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />filtro antigo, por texto
                        </span>
                      )}
                      {false && (
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
    </>
  );
}
