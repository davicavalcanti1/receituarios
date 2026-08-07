// GET /api/netris/catalogo — listas do NetRis para os campos de configuração.
//
// Modelo do ExameQR (src/integrations/netris/routes.js): o NetRis expõe os
// catálogos, então basta listá-los, paginando de 100 em 100 (o `limit` capa aí).
//
// EXCEÇÃO — médicos. Confirmado contra a API real em 07/ago/2026:
//   • /medicos não traz nome nenhum, só id_medico + id_profissional
//   • o `idMedicoExecutor` do atendimento NÃO é id_medico (28 e 18 não existem lá)
//   • nem id_profissional (id_profissional 28 é outra pessoa)
//   • e nomes de executor não aparecem em /profissionais nas primeiras páginas
// Ou seja, o executor vive num espaço de id próprio. O único lugar em que o nome
// do executor aparece de forma confiável é o próprio atendimento — então os
// médicos são extraídos de lá, e o filtro casa por NOME.

import { Router } from "express";
import { requireSupabaseAuth } from "../middleware/auth.js";
import { configNetris, fetchAtendimentosCacheado, NETRIS_FILIAL } from "../lib/netris.js";

const router = Router();

function texto(obj: Record<string, unknown>, ...chaves: string[]): string {
  for (const k of chaves) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function unwrap(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const k of ["aaData", "content", "data", "items", "result"]) {
      if (Array.isArray(obj[k])) return obj[k] as Record<string, unknown>[];
    }
  }
  return [];
}

const PAGINA = 100;
const MAX_PAGINAS = 20;

async function listarTudo(caminho: string): Promise<Record<string, unknown>[]> {
  const cfg = await configNetris();
  if (!cfg.ativo || !cfg.baseUrl || !cfg.token) throw new Error("NetRis não configurado");

  const todos: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGINAS; page++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let lote: Record<string, unknown>[];
    try {
      const r = await fetch(`${cfg.baseUrl}${caminho}?limit=${PAGINA}&page=${page}`, {
        headers: { "Content-Type": "application/json", Authorization: cfg.token },
        signal: controller.signal,
      });
      if (!r.ok) throw new Error(`NetRis ${r.status} em ${caminho}`);
      lote = unwrap(await r.json());
    } finally {
      clearTimeout(timer);
    }
    todos.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return todos;
}

function isoDiasAtras(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

// Médicos executores dos últimos 90 dias — ver a nota no topo.
async function medicosDosAtendimentos(): Promise<Array<{ valor: string; rotulo: string }>> {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const ats = await fetchAtendimentosCacheado(isoDiasAtras(90), hoje, NETRIS_FILIAL);
  const nomes = new Set<string>();
  for (const a of ats as Record<string, unknown>[]) {
    const nome = texto(a, "nomeMedicoExecutor");
    if (nome) nomes.add(nome);
  }
  return [...nomes].map(n => ({ valor: n, rotulo: n }));
}

// Catálogo muda pouco: 10 min de cache evita bater no NetRis a cada abertura.
const CACHE_MS = 600_000;
let cache: { at: number; dados: unknown } | null = null;

router.get("/", requireSupabaseAuth, async (_req, res) => {
  if (cache && Date.now() - cache.at < CACHE_MS) return res.json(cache.dados);

  try {
    const [procedimentos, modalidades, salas, convenios, medicos] = await Promise.all([
      listarTudo("/netris/api/procedimentos").catch(() => []),
      listarTudo("/netris/api/modalidades").catch(() => []),
      listarTudo("/netris/api/salas").catch(() => []),
      listarTudo("/netris/api/convenios").catch(() => []),
      medicosDosAtendimentos().catch(() => []),
    ]);

    const dedup = (l: Array<{ valor: string; rotulo: string }>) => {
      const m = new Map<string, { valor: string; rotulo: string }>();
      for (const o of l) if (o.valor && o.rotulo && !m.has(o.valor)) m.set(o.valor, o);
      return [...m.values()];
    };

    const dados = {
      // Campos confirmados na API real: procedimentos/modalidades usam
      // snake_case (nome, descricao); salas usam camelCase (nome).
      exames: dedup(procedimentos.map(p => {
        const n = texto(p, "nome", "descricao");
        return { valor: n, rotulo: n };
      })),
      modalidades: dedup(modalidades.map(m => ({
        valor: String(m.id_modalidade ?? ""),
        rotulo: texto(m, "descricao", "nome"),
      }))),
      salas: dedup(salas.map(s => {
        const n = texto(s, "nome", "nomeSala");
        return { valor: n, rotulo: n };
      })),
      convenios: dedup(convenios.map(c => {
        const n = texto(c, "nome", "razao_social");
        return { valor: n, rotulo: n };
      })),
      medicos: dedup(medicos),
    };

    cache = { at: Date.now(), dados };
    res.json(dados);
  } catch (err: any) {
    console.error("[netris-catalogo]", err?.message);
    res.status(502).json({ error: "Erro ao consultar o catálogo do NetRis", detail: err?.message });
  }
});

export default router;
