// Filtro configurável de atendimentos do NetRis.
//
// Substitui as regras que viviam hardcoded em NovoLoteReceituario.tsx
// (ehAnestesia / ehEegIgorGondim / SITUACOES_EXCLUIR): trocar o médico de um
// receituário ou incluir outro exame exigia editar código e fazer deploy.
//
// Função pura de propósito — recebe lista e configuração, devolve lista. É o
// trecho com mais regra de negócio do módulo e o mais fácil de testar.

import type { Atendimento } from "@/services/netris/types";

export interface FiltroNetris {
  /** Casa no nome do procedimento. Ex.: ["ANESTESIA"] */
  termos_exame: string[];
  /** idModalidade do NetRis. Ex.: [3] para Anestesia */
  modalidades: number[];
  /** Casa no nome do médico executor. Ex.: ["IGOR GONDIM"] */
  termos_medico: string[];
  /** Casa no nome da sala. Ex.: ["SALA 2"] */
  termos_sala: string[];
  /** Casa no nome do convênio. Ex.: ["UNIMED"] */
  termos_convenio: string[];
  /** idSituacao descartados. Ex.: [1, 5] = MARCADO e CANCELADO */
  situacoes_excluir: number[];
}

export const FILTRO_VAZIO: FiltroNetris = {
  termos_exame: [],
  modalidades: [],
  termos_medico: [],
  termos_sala: [],
  termos_convenio: [],
  situacoes_excluir: [],
};

export function normalizarFiltro(bruto: unknown): FiltroNetris {
  const f = (bruto ?? {}) as Partial<FiltroNetris>;
  const listaTexto = (v: unknown) =>
    Array.isArray(v) ? v.map(String).map(s => s.trim()).filter(Boolean) : [];
  const listaNum = (v: unknown) =>
    Array.isArray(v) ? v.map(Number).filter(n => Number.isFinite(n)) : [];

  return {
    termos_exame:      listaTexto(f.termos_exame),
    modalidades:       listaNum(f.modalidades),
    termos_medico:     listaTexto(f.termos_medico),
    termos_sala:       listaTexto(f.termos_sala),
    termos_convenio:   listaTexto(f.termos_convenio),
    situacoes_excluir: listaNum(f.situacoes_excluir),
  };
}

/** Maiúsculas, sem acento, espaços colapsados — para comparar nome de gente. */
function normalizar(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Um termo casa quando TODAS as suas palavras aparecem no alvo.
 * É o que faz "IGOR GONDIM" casar com "IGOR SILVEIRA DE CASTRO GONDIM" —
 * sem precisar expor regex na interface de configuração.
 */
function termoCasa(termo: string, alvo: string): boolean {
  const palavras = normalizar(termo).split(" ").filter(Boolean);
  if (palavras.length === 0) return false;
  return palavras.every(p => alvo.includes(p));
}

/** Qualquer um dos termos casa (OR entre termos, AND entre palavras do termo). */
function algumTermoCasa(termos: string[], alvo: string): boolean {
  const a = normalizar(alvo);
  return termos.some(t => termoCasa(t, a));
}

export function atendimentoCasa(a: Atendimento, filtro: FiltroNetris): boolean {
  if (filtro.situacoes_excluir.includes(a.situacaoId)) return false;

  // Exame e modalidade são alternativas entre si: "é anestesia" tanto pelo nome
  // do procedimento quanto pela modalidade do NetRis.
  const temCriterioExame = filtro.termos_exame.length > 0 || filtro.modalidades.length > 0;
  if (temCriterioExame) {
    const porNome       = algumTermoCasa(filtro.termos_exame, a.exame ?? "");
    const porModalidade = a.modalidadeId != null && filtro.modalidades.includes(a.modalidadeId);
    if (!porNome && !porModalidade) return false;
  }

  // Médico, sala e convênio restringem o que passou acima. Lista vazia = sem
  // restrição naquele campo.
  if (filtro.termos_medico.length > 0 && !algumTermoCasa(filtro.termos_medico, a.medico ?? "")) return false;
  if (filtro.termos_sala.length > 0 && !algumTermoCasa(filtro.termos_sala, a.sala ?? "")) return false;
  if (filtro.termos_convenio.length > 0 && !algumTermoCasa(filtro.termos_convenio, a.convenio ?? "")) return false;

  return true;
}

// ── Setor derivado ───────────────────────────────────────────────────────────
// Saiu de derivarSetor() no gerarPdf.ts, onde o mapa "RESSON"→RESSONÂNCIA etc.
// estava fixo no código. Vence a primeira regra que casar.

export interface RegraSetor { termos: string[]; setor: string }

export function normalizarRegrasSetor(bruto: unknown): RegraSetor[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .map((r: any) => ({
      termos: Array.isArray(r?.termos) ? r.termos.map(String).filter(Boolean) : [],
      setor:  String(r?.setor ?? ""),
    }))
    .filter(r => r.termos.length > 0 && r.setor);
}

export function derivarSetorPorRegras(alvo: string, regras: RegraSetor[]): string {
  const a = normalizar(alvo);
  for (const r of regras) {
    if (r.termos.some(t => termoCasa(t, a))) return r.setor;
  }
  return "";
}

export function aplicarFiltro(lista: Atendimento[], filtro: FiltroNetris): Atendimento[] {
  return lista.filter(a => atendimentoCasa(a, filtro));
}

/** Um filtro sem nenhum critério deixaria passar o dia inteiro — a interface avisa. */
export function filtroVazio(f: FiltroNetris): boolean {
  return f.termos_exame.length === 0
    && f.modalidades.length === 0
    && f.termos_medico.length === 0
    && f.termos_sala.length === 0
    && f.termos_convenio.length === 0;
}

/** Resumo legível do filtro, para a interface explicar o que vai buscar. */
export function descreverFiltro(f: FiltroNetris): string {
  const partes: string[] = [];
  if (f.termos_exame.length)    partes.push(`exame com ${f.termos_exame.join(" ou ")}`);
  if (f.modalidades.length)     partes.push(`${f.modalidades.length} modalidade(s)`);
  if (f.termos_medico.length)   partes.push(`médico ${f.termos_medico.join(" ou ")}`);
  if (f.termos_sala.length)     partes.push(`sala ${f.termos_sala.join(" ou ")}`);
  if (f.termos_convenio.length) partes.push(`convênio ${f.termos_convenio.join(" ou ")}`);
  if (partes.length === 0) return "Sem filtro configurado — traz todos os atendimentos do período.";
  return `Traz: ${partes.join(" · ")}.`;
}
