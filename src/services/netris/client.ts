// ─────────────────────────────────────────────────────────────────────────────
// NetRis HTTP Client — fundação de TODAS as integrações
//
// Dados confirmados via testes em 14/04/2026:
//   - Datas nos params: DD/MM/YYYY
//   - Datas nos responses: epoch ms (timestamps)
//   - horaInicial: ms desde meia-noite (57600000 = 16:00)
//   - Paginação: &limit=5000 (default retorna só 10!)
//   - situacaoId no query NÃO filtra — filtrar no cliente
// ─────────────────────────────────────────────────────────────────────────────

// Todas as chamadas vão pelo proxy autenticado do Express (/api/netris/proxy),
// que injeta o token NetRis SERVER-SIDE. O bundle do front não conhece mais o
// token (antes: VITE_NETRIS_TOKEN exposto pra qualquer um no devtools).
import { hojeBRT } from "@/lib/dataBRT";

export const NETRIS_BASE      = "/api/netris/proxy";
export const NETRIS_PACS_BASE = "/api/netris/pacs"; // proxy autenticado → pacs.imagoradiologia.com.br/Netris-web
// Fase 5: a filial deixou de ser VITE_* (build time). Quem resolve o default é
// o servidor, pela NETRIS_FILIAL_ID — assim o front não precisa de nenhuma env
// do NetRis para ser buildado.
export const NETRIS_FILIAL    = "";

// ── IDs de situação (confirmados via API) ────────────────────────────────────
// Confirmados via API real em 15/04/2026 (varredura de 1.036 atendimentos)
export const SITUACAO = {
  MARCADO:              1,
  A_CONFIRMAR:          2,   // "A CONFIRMAR" — faltas/campanhas
  CONFIRMADO:           3,   // "CONFIRMADO"
  CANCELADO:            5,
  CHEGOU:              10,   // "CHEGOU" — check-in/totem
  ATENDIMENTO:         11,   // "ATENDIMENTO" — em atendimento na recepção
  ENCAMINHADO_EXAME:   13,   // "ENCAMINHADO PARA EXAME" — FAROL geral
  EXAME_REALIZADO:     18,   // "EXECUTADO" — exame realizado, relatórios
  LANCAR_MATERIAL:     19,   // "LANCAR_MATERIAL"
  A_CANCELAR:          26,
  FINALIZADO:          27,   // "FINALIZADO"
  FATURADO:            28,   // "FATURADO"
  EM_SALA:             45,   // "EM SALA" — paciente já na sala de exame
  ANAMNESE:            61,   // "ANAMNESE REALIZADA" — pré RM/TC
  PACIENTE_PREPARADO:  62,   // "PACIENTE PREPARADO" — pré RM/TC
  PREPARADO_ENFERMAGEM:63,   // "PREPARADO ENFERMAGEM" — pronto para exame
  ENCAMINHADO_RM_TC:   64,   // "RM E TC ENCAMINHADO PARA EXAME" — exclusivo RM e TC

  // ── Fluxo financeiro / faturamento (confirmados via dados reais) ─────────
  // IDs numéricos precisam ser validados contra NetRis; nomes confirmados pelo usuário
  GUIA_DEVOLVIDA_RECEPCAO: 51, // "GUIA DEVOLVIDA À RECEPÇÃO" — confirmado via sync-controle-guias
} as const;

// ── IDs de modalidade (confirmados via API) ──────────────────────────────────
export const MODALIDADE = {
  RAIO_X:              1,
  USG:                 2,
  ANESTESIA:           3,
  TOMOGRAFIA:          4,
  RESSONANCIA:         5,
  MAMOGRAFIA:          6,
  DENSITOMETRIA:       7,
  BIOPSIA_US:          8,
  ECOCARDIOGRAMA:     10,
  ELETROENCEFALOGRAMA:14,
  ELETROCARDIOGRAMA:  15,
  RESSONANCIA_CONTRASTE:16,
  ESPIROMETRIA:       18,
  HOLTER:             19,
  RETORNO_MAPA:       20,
  RETORNO_HOLTER:     21,
} as const;

export const IMPRESSAO = {
  MOTIVO_PADRAO: 1,
  MODELO_PADRAO: 10,
} as const;

export type SituacaoId   = (typeof SITUACAO)[keyof typeof SITUACAO];
export type ModalidadeId = (typeof MODALIDADE)[keyof typeof MODALIDADE];

// ── Headers ──────────────────────────────────────────────────────────────────
// O proxy aceita sessão Express (cookie, vai automático em same-origin) OU
// JWT Supabase como Bearer. Mandamos o Bearer quando disponível pra cobrir
// o caso da sessão Express expirada com Supabase ainda logado.
import { supabase } from "@/integrations/supabase/client";

export async function netrisHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  } catch { /* segue só com cookie de sessão */ }
  return headers;
}

// ── Utilitários de lista ─────────────────────────────────────────────────────
export function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const k of ["aaData", "content", "data", "items", "result"]) {
      if (Array.isArray(obj[k])) return obj[k] as T[];
    }
  }
  return [];
}

// ── Conversão de timestamps do NetRis ────────────────────────────────────────
/** epoch ms → Date */
export function epochToDate(ms: unknown): Date | null {
  if (typeof ms !== "number" || ms <= 0) return null;
  return new Date(ms);
}

/** ms desde meia-noite UTC (NetRis envia em UTC) → "HH:mm" em BRT (UTC−3) */
export function msToTime(ms: unknown): string | null {
  // 0 significa "sem horário definido" no NetRis — tratar como ausente
  if (typeof ms !== "number" || ms <= 0) return null;
  const BRT_OFFSET = 3 * 3_600_000; // UTC−3 (Brasil, sem horário de verão)
  const brt = ms - BRT_OFFSET;
  if (brt < 0) return null;
  const h = Math.floor(brt / 3_600_000) % 24;
  const m = Math.floor((brt % 3_600_000) / 60_000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ── Datas para os query params (DD/MM/YYYY) ──────────────────────────────────
export function dataBR(date?: Date): string {
  const d = date ?? new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export function hojeBR(): string { return dataBR(); }

export function hojeISO(): string { return hojeBRT(); }

export function dataISO(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date);
}

export function isoParaBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function ontemISO(): string {
  const d = new Date(); d.setDate(d.getDate() - 1); return dataISO(d);
}

export function ontemBR(): string {
  const d = new Date(); d.setDate(d.getDate() - 1); return dataBR(d);
}

export function umAnoAtrasISO(): string {
  const d = new Date(); d.setFullYear(d.getFullYear() - 1); return dataISO(d);
}

export function umAnoAtrasBR(): string {
  const d = new Date(); d.setFullYear(d.getFullYear() - 1); return dataBR(d);
}

// ── Fetch wrapper ────────────────────────────────────────────────────────────
export async function netrisFetch<T = unknown>(
  endpoint: string, options?: RequestInit, retries = 2
): Promise<T> {
  const url = `${NETRIS_BASE}${endpoint}`;
  const baseHeaders = await netrisHeaders();
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        credentials: "include",
        headers: { ...baseHeaders, ...(options?.headers ?? {}) },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => res.statusText);
        if (res.status >= 500 && attempt < retries) continue;
        throw new Error(`NetRis ${res.status}: ${body.slice(0, 200)}`);
      }
      return res.json() as Promise<T>;
    } catch (e) {
      if (attempt === retries) throw e;
    }
  }
  throw new Error("NetRis: max retries");
}

export async function netrisGet<T = unknown>(
  path: string, params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  let url = `${NETRIS_BASE}${path}`;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, { credentials: "include", headers: await netrisHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`NetRis GET ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function netrisPost<T = unknown>(path: string, body: unknown): Promise<T> {
  return netrisFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export async function netrisPatch<T = unknown>(path: string, body: unknown): Promise<T> {
  return netrisFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

export async function netrisPut<T = unknown>(path: string, body: unknown): Promise<T> {
  return netrisFetch<T>(path, { method: "PUT", body: JSON.stringify(body) });
}
