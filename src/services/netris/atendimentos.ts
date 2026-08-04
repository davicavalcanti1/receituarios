// ─────────────────────────────────────────────────────────────────────────────
// Atendimentos — toda consulta/mutação de atendimentos no NetRis
//
// Campo names confirmados via API real (14/04/2026):
//   idAtendimentoProcedimento, nomePaciente, nomeProcedimento,
//   nomeMedicoExecutor, nomeSala, horaInicial (ms desde meia-noite),
//   data (epoch ms), idSituacao, nomeSituacao, idModalidade,
//   descricaoModalidade, cpf, telefoneCelularPaciente, dataNascimento (epoch ms)
//
// ATENÇÃO: situacaoId no query param NÃO filtra — filtrar no cliente!
//          limit default = 10 — SEMPRE passar limit=5000
// ─────────────────────────────────────────────────────────────────────────────

import {
  netrisGet, netrisPatch, netrisHeaders, NETRIS_FILIAL, NETRIS_PACS_BASE,
  SITUACAO, unwrapList, epochToDate, msToTime, isoParaBR, hojeISO,
} from "./client";
import type { Atendimento, BuscarAtendimentosParams } from "./types";
import { supabase } from "@/integrations/supabase/client";

// ── Normaliza um registro bruto da API ───────────────────────────────────────
function normalizar(raw: Record<string, unknown>): Atendimento {
  const dataEpoch   = epochToDate(raw.data as number);
  const nascEpoch   = epochToDate(raw.dataNascimento as number);
  const horaStr     = msToTime(raw.horaInicial as number);

  return {
    id:              String(raw.idAtendimentoProcedimento ?? ""),
    nomePaciente:    String(raw.nomePaciente ?? ""),
    cpf:             String(raw.cpf ?? "") || undefined,
    telefone:        String(raw.telefoneCelularPaciente ?? raw.telefonePaciente ?? "") || undefined,
    dataNascimento:  nascEpoch ? nascEpoch.toISOString().split("T")[0] : undefined,
    exame:           String(raw.nomeProcedimento ?? ""),
    modalidade:      String(raw.descricaoModalidade ?? "") || undefined,
    modalidadeId:    typeof raw.idModalidade === "number" ? raw.idModalidade : undefined,
    medico:          String(raw.nomeMedicoExecutor ?? "") || undefined,
    medicoId:        raw.idMedicoExecutor ? String(raw.idMedicoExecutor) : undefined,
    sala:            String(raw.nomeSala ?? "") || undefined,
    horario:         horaStr ?? undefined,
    dataHora:        dataEpoch ? dataEpoch.toISOString() : undefined,
    situacaoId:      Number(raw.idSituacao ?? 0),
    situacao:        String(raw.nomeSituacao ?? "") || undefined,
    filialId:        raw.idFilial ? String(raw.idFilial) : undefined,
    // extras úteis
    convenio:        String(raw.nomeConvenio ?? "") || undefined,
    valorProcedimento: typeof raw.valorProcedimento === "number" ? raw.valorProcedimento : undefined,
    nomeMae:         String(raw.nomeMae ?? "") || undefined,
    sexo:            String(raw.sexoPaciente ?? "") || undefined,
    idPaciente:      raw.idPaciente ? String(raw.idPaciente) : undefined,
    raw,
  };
}

// ── Busca principal ──────────────────────────────────────────────────────────
// Chama o backend que pagina e armazena em Redis por 3 min (chave por data+filial).
// Filtros (situacaoId, modalidadeId, etc.) são aplicados no cliente após receber.

export async function buscarAtendimentos(
  params: BuscarAtendimentosParams = {}
): Promise<Atendimento[]> {
  const dataInicial = params.dataInicial ?? hojeISO();
  const dataFinal = params.dataFinal ?? hojeISO();
  const qs = new URLSearchParams({ dataInicial, dataFinal });
  if (params.filialId) qs.set("filialId", params.filialId);

  const { data: { session: sbSession } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (sbSession?.access_token) headers["Authorization"] = `Bearer ${sbSession.access_token}`;

  const res = await fetch(`/api/netris/atendimentos?${qs}`, { credentials: "include", headers });
  if (!res.ok) {
    // Tenta extrair o detail JSON do server (vem como { error, detail }); se não for JSON, usa o body cru
    let detail = "";
    try {
      const body = await res.clone().json();
      detail = body?.detail ?? body?.error ?? "";
    } catch {
      detail = (await res.text().catch(() => "")).slice(0, 300);
    }
    const err = new Error(`NetRis backend ${res.status}${detail ? `: ${detail}` : ""}`);
    // Loga sempre — facilita diagnóstico em prod sem precisar abrir Network manualmente
    console.error("[netris] /api/netris/atendimentos falhou:", { status: res.status, detail, url: `/api/netris/atendimentos?${qs}` });
    throw err;
  }
  const { data } = (await res.json()) as { data: Record<string, unknown>[] };

  let lista = data.map(normalizar);

  // Filtros aplicados NO CLIENTE (a API ignora situacaoId e modalidadeId no query)
  if (params.situacaoId) {
    const ids = Array.isArray(params.situacaoId) ? params.situacaoId : [params.situacaoId];
    lista = lista.filter(a => ids.includes(a.situacaoId));
  }
  if (params.modalidadeId) {
    lista = lista.filter(a => a.modalidadeId === params.modalidadeId);
  }
  if (params.pacienteNome) {
    const q = params.pacienteNome.toLowerCase();
    lista = lista.filter(a => a.nomePaciente.toLowerCase().includes(q));
  }
  if (params.cpf) {
    const digits = params.cpf.replace(/\D/g, "");
    lista = lista.filter(a => (a.cpf ?? "").replace(/\D/g, "").includes(digits));
  }

  return lista.filter(a => a.id && a.nomePaciente);
}

// ── Atalhos ──────────────────────────────────────────────────────────────────

export function buscarHoje(extras?: Omit<BuscarAtendimentosParams, "dataInicial" | "dataFinal">) {
  const hoje = hojeISO();
  return buscarAtendimentos({ dataInicial: hoje, dataFinal: hoje, ...extras });
}

// ── Busca pública (flow do /checkin/:slug, sem login) ────────────────────────
// Chama /api/public/checkin/atendimentos que devolve só atendimentos do paciente
// identificado pelo CPF/idPaciente/nome — nunca o dump completo do dia.
// Pelo menos um dos 3 identificadores precisa vir, senão a rota recusa.

export interface BuscarPublicoParams {
  cpf?: string;
  idPaciente?: string;
  nome?: string;
  filialId?: string;
  /** Filtros aplicados no cliente (mesmo padrão de buscarAtendimentos) */
  situacaoId?: number | number[];
}

export async function buscarHojePublico(params: BuscarPublicoParams): Promise<Atendimento[]> {
  const qs = new URLSearchParams();
  if (params.cpf)        qs.set("cpf", params.cpf.replace(/\D/g, ""));
  if (params.idPaciente) qs.set("idPaciente", params.idPaciente);
  if (params.nome)       qs.set("nome", params.nome);
  if (params.filialId)   qs.set("filialId", params.filialId);

  const res = await fetch(`/api/public/checkin/atendimentos?${qs}`, { credentials: "include" });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.clone().json();
      detail = body?.detail ?? body?.error ?? "";
    } catch {
      detail = (await res.text().catch(() => "")).slice(0, 300);
    }
    throw new Error(`Checkin público ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const { data } = (await res.json()) as { data: Record<string, unknown>[] };

  let lista = data.map(normalizar);

  if (params.situacaoId) {
    const ids = Array.isArray(params.situacaoId) ? params.situacaoId : [params.situacaoId];
    lista = lista.filter(a => ids.includes(a.situacaoId));
  }

  return lista.filter(a => a.id && a.nomePaciente);
}

export function buscarHojeChegou() {
  return buscarHoje({ situacaoId: [SITUACAO.CONFIRMADO, SITUACAO.ENCAMINHADO_EXAME] });
}

export function buscarHojeFaltas() {
  return buscarHoje({ situacaoId: [SITUACAO.A_CONFIRMAR, SITUACAO.A_CANCELAR] });
}

export function buscarHojePorModalidade(modalidadeId: number) {
  return buscarHoje({ modalidadeId });
}

export function buscarPeriodo(
  dataInicial: string, dataFinal: string,
  extras?: Omit<BuscarAtendimentosParams, "dataInicial" | "dataFinal">
) {
  return buscarAtendimentos({ dataInicial, dataFinal, ...extras });
}

// ── Agenda futura ────────────────────────────────────────────────────────────

/** Atendimentos dos próximos N dias (amanhã até hoje + diasAdiante). */
export function buscarFuturos(
  diasAdiante = 30,
  extras?: Omit<BuscarAtendimentosParams, "dataInicial" | "dataFinal">
) {
  const inicio = new Date();
  inicio.setDate(inicio.getDate() + 1);
  const fim = new Date();
  fim.setDate(fim.getDate() + diasAdiante);
  return buscarAtendimentos({
    dataInicial: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(inicio),
    dataFinal:   new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(fim),
    ...extras,
  });
}

export interface AgendaMedico {
  medico:      string;
  medicoId:    string | undefined;
  modalidade:  string;
  modalidadeId: number | undefined;
  totalAgendado: number;
  datas:       string[]; // ISOs dos dias com atendimento
  atendimentos: Atendimento[];
}

/**
 * Resumo da agenda futura agrupado por médico × modalidade.
 * Útil para triagem: quais médicos vão atender, em quais dias, quantos pacientes.
 */
export async function buscarAgendaFutura(diasAdiante = 30): Promise<AgendaMedico[]> {
  const lista = await buscarFuturos(diasAdiante, {
    situacaoId: [
      SITUACAO.MARCADO,
      SITUACAO.A_CONFIRMAR,
      SITUACAO.CONFIRMADO,
    ],
  });

  const map = new Map<string, AgendaMedico>();

  for (const a of lista) {
    const medico     = a.medico ?? "Sem médico";
    const modalidade = a.modalidade ?? a.exame ?? "Outros";
    const chave      = `${medico}|${modalidade}`;
    const dataRef    = a.dataHora?.split("T")[0] ?? "";

    if (!map.has(chave)) {
      map.set(chave, {
        medico,
        medicoId:    a.medicoId,
        modalidade,
        modalidadeId: a.modalidadeId,
        totalAgendado: 0,
        datas:        [],
        atendimentos: [],
      });
    }

    const entry = map.get(chave)!;
    entry.totalAgendado++;
    entry.atendimentos.push(a);
    if (dataRef && !entry.datas.includes(dataRef)) entry.datas.push(dataRef);
  }

  return [...map.values()].sort((a, b) => b.totalAgendado - a.totalAgendado);
}

// ── Farol: pacientes encaminhados para exame ─────────────────────────────────
export function buscarFarol(modalidadeId?: number) {
  return buscarHoje({
    situacaoId: SITUACAO.ENCAMINHADO_EXAME,
    ...(modalidadeId ? { modalidadeId } : {}),
  });
}

// ── Detalhe de um atendimento ────────────────────────────────────────────────
export async function buscarAtendimento(id: string): Promise<Atendimento | null> {
  try {
    const raw = await netrisGet<Record<string, unknown>>(`/netris/api/atendimentos/${id}`);
    return normalizar(raw);
  } catch { return null; }
}

// ── Alterar situação ─────────────────────────────────────────────────────────
export async function alterarSituacao(id: string, situacaoId: number): Promise<void> {
  await netrisPatch(`/netris/api/atendimentos/${id}/alterar-situacao`, { idSituacao: situacaoId });
  // Invalida o cache Redis para que a próxima busca reflita a mudança
  supabase.auth.getSession().then(({ data: { session: s } }) => {
    const h: Record<string, string> = s?.access_token ? { Authorization: `Bearer ${s.access_token}` } : {};
    fetch("/api/netris/invalidate", { method: "POST", credentials: "include", headers: h }).catch(() => {});
  });
}

export function confirmarAtendimento(id: string) {
  return alterarSituacao(id, SITUACAO.CONFIRMADO);
}

// ── Cancelar ─────────────────────────────────────────────────────────────────
export async function cancelarAtendimento(id: string, motivoId = 1): Promise<void> {
  await netrisPatch(`/netris/api/atendimentos/${id}/cancelar`, { idMotivoSituacao: motivoId });
}

// ── Histórico de situações de um atendimento (PACS) ──────────────────────────
// Endpoint: pacs.imagoradiologia.com.br/Netris-web/atendimento/findAllAPSituacao?idAP={id}
// Retorna a linha do tempo de transições de situação do atendimento.

export interface HistoricoSituacao {
  idSituacao:   number;
  nomeSituacao: string;
  dataHora:     string; // ISO
  usuario?:     string;
}

export async function buscarHistoricoSituacoes(atendimentoId: string): Promise<HistoricoSituacao[]> {
  const url = `${NETRIS_PACS_BASE}/atendimento/findAllAPSituacao?idAP=${atendimentoId}`;
  const res = await fetch(url, { credentials: "include", headers: await netrisHeaders() });
  if (!res.ok) throw new Error(`NetRis PACS ${res.status}: histórico de ${atendimentoId}`);
  const raw = await res.json();
  const lista = unwrapList<Record<string, unknown>>(raw);
  return lista.map(r => ({
    idSituacao:   Number(r.idSituacao ?? r.id ?? 0),
    nomeSituacao: String(r.nomeSituacao ?? r.descricao ?? r.situacao ?? ""),
    dataHora:     r.dataHora
      ? new Date(r.dataHora as number).toISOString()
      : String(r.data ?? ""),
    usuario:      r.nomeUsuario ? String(r.nomeUsuario) : undefined,
  }));
}

// ── Listar modalidades ───────────────────────────────────────────────────────
let _modalidadesCache: Array<{ id: number; nome: string }> | null = null;

export async function listarModalidades(): Promise<Array<{ id: number; nome: string }>> {
  if (_modalidadesCache) return _modalidadesCache;
  try {
    const raw = await netrisGet<unknown>("/netris/api/modalidades");
    const lista = unwrapList<Record<string, unknown>>(raw);
    _modalidadesCache = lista.map(m => ({
      id:   Number(m.id_modalidade ?? m.id ?? 0),
      nome: String(m.descricao ?? m.nome ?? ""),
    }));
    return _modalidadesCache;
  } catch { return []; }
}
