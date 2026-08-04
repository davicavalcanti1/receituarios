// ─────────────────────────────────────────────────────────────────────────────
// NetRis — porte mínimo do server do sistema de origem (lib/netris.ts):
// só o fetch paginado de atendimentos, que é o que a aba "Buscar por data"
// do Novo Lote usa. Cache em memória no lugar do Redis (instância única).
//
// Regras herdadas dos testes reais no NetRis:
//   - Datas nos params em DD/MM/YYYY; limit default da API é 10 → paginar
//   - Intervalos longos quebram em chunks de 7 dias, 4 em paralelo
//     (evita 504 do gateway); dedup por idAtendimentoProcedimento
// ─────────────────────────────────────────────────────────────────────────────

export const NETRIS_FILIAL = process.env.NETRIS_FILIAL_ID ?? "1";

const NETRIS_BASE  = process.env.NETRIS_BASE_URL ?? "";
const NETRIS_TOKEN = process.env.NETRIS_TOKEN ?? "";

const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const CHUNK_DAYS = 7;
const CHUNK_CONCURRENCY = 4;

function isoToBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function chunkDateRange(fromISO: string, toISO: string, maxDays: number): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  let cur = new Date(fromISO + "T00:00:00Z");
  const end = new Date(toISO + "T00:00:00Z");
  while (cur <= end) {
    const chunkEnd = new Date(cur);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maxDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    chunks.push({ start: cur.toISOString().slice(0, 10), end: chunkEnd.toISOString().slice(0, 10) });
    cur = new Date(chunkEnd);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return chunks;
}

function unwrapList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const k of ["aaData", "content", "data", "items", "result"]) {
      if (Array.isArray(obj[k])) return obj[k] as unknown[];
    }
  }
  return [];
}

async function fetchChunkPaginado(dataInicial: string, dataFinal: string, filialId: string): Promise<unknown[]> {
  const all: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      filialId,
      limit:       String(PAGE_SIZE),
      page:        String(page),
      dataInicial: isoToBR(dataInicial),
      dataFinal:   isoToBR(dataFinal),
    });
    const url = `${NETRIS_BASE}/netris/api/atendimentos?${params}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "Content-Type": "application/json", Authorization: NETRIS_TOKEN },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      console.error("[netris-lib] upstream error", { status: res.status, page, dataInicial, dataFinal, bodySnippet: body.slice(0, 300) });
      throw new Error(`NetRis ${res.status}: ${body.slice(0, 200)}`);
    }
    const pageData = unwrapList(await res.json());
    all.push(...pageData);
    if (pageData.length < PAGE_SIZE) break;
  }
  return all;
}

export async function fetchAtendimentosPaginados(dataInicial: string, dataFinal: string, filialId: string): Promise<unknown[]> {
  if (!NETRIS_BASE || !NETRIS_TOKEN) {
    throw new Error("NetRis não configurado no servidor (NETRIS_BASE_URL / NETRIS_TOKEN ausentes)");
  }

  const chunks = chunkDateRange(dataInicial, dataFinal, CHUNK_DAYS);
  if (chunks.length === 1) return fetchChunkPaginado(dataInicial, dataFinal, filialId);

  const all: unknown[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
    const lote = chunks.slice(i, i + CHUNK_CONCURRENCY);
    const resultados = await Promise.all(lote.map(c => fetchChunkPaginado(c.start, c.end, filialId)));
    for (const items of resultados) {
      for (const item of items) {
        const id = String((item as Record<string, unknown>).idAtendimentoProcedimento ?? (item as Record<string, unknown>).id ?? "");
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        all.push(item);
      }
    }
  }
  return all;
}

// ── Cache em memória (substitui o Redis do sistema de origem) ────────────────
const CACHE_TTL_MS = 180_000;
const cache = new Map<string, { at: number; data: unknown[] }>();

export async function fetchAtendimentosCacheado(dataInicial: string, dataFinal: string, filialId: string): Promise<unknown[]> {
  const key = `${dataInicial}:${dataFinal}:${filialId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const data = await fetchAtendimentosPaginados(dataInicial, dataFinal, filialId);
  cache.set(key, { at: Date.now(), data });
  return data;
}
