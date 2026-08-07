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
  // ── Seleção (valores escolhidos a partir do que o NetRis devolve) ──────────
  /** nomeProcedimento exatos. */
  exames: string[];
  /**
   * NOME do médico executor, exato. Não é id: confirmado na API real que o
   * `idMedicoExecutor` do atendimento não corresponde a `id_medico` nem a
   * `id_profissional` do catálogo — o executor tem espaço de id próprio, e o
   * nome é o único identificador confiável entre os dois lados.
   */
  medicos: string[];
  /** nomeSala exatos. */
  salas: string[];
  /** nomeConvenio exatos. */
  convenios: string[];

  // ── Legado: termos digitados (mantidos para não quebrar o que já existe) ──
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
  /** idSituacao que ENTRAM. Vazio = todas. */
  situacoes: number[];
  /** Legado: idSituacao descartados. Só vale quando `situacoes` está vazia. */
  situacoes_excluir: number[];
}

export const FILTRO_VAZIO: FiltroNetris = {
  exames: [],
  medicos: [],
  salas: [],
  convenios: [],
  termos_exame: [],
  modalidades: [],
  termos_medico: [],
  termos_sala: [],
  termos_convenio: [],
  situacoes: [],
  situacoes_excluir: [],
};

export function normalizarFiltro(bruto: unknown): FiltroNetris {
  const f = (bruto ?? {}) as Partial<FiltroNetris>;
  const listaTexto = (v: unknown) =>
    Array.isArray(v) ? v.map(String).map(s => s.trim()).filter(Boolean) : [];
  const listaNum = (v: unknown) =>
    Array.isArray(v) ? v.map(Number).filter(n => Number.isFinite(n)) : [];

  return {
    exames:            listaTexto(f.exames),
    medicos:           listaTexto(f.medicos),
    salas:             listaTexto(f.salas),
    convenios:         listaTexto(f.convenios),
    termos_exame:      listaTexto(f.termos_exame),
    modalidades:       listaNum(f.modalidades),
    termos_medico:     listaTexto(f.termos_medico),
    termos_sala:       listaTexto(f.termos_sala),
    termos_convenio:   listaTexto(f.termos_convenio),
    situacoes:         listaNum(f.situacoes),
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

/** Valor selecionado casa por igualdade (normalizada), não por pedaço. */
function estaNaSelecao(selecionados: string[], valor: string | undefined): boolean {
  if (selecionados.length === 0) return false;
  const v = normalizar(valor ?? "");
  return selecionados.some(s => normalizar(s) === v);
}

export function atendimentoCasa(a: Atendimento, filtro: FiltroNetris): boolean {
  // Lista do que entra tem prioridade; sem ela, vale a lista legada do que sai.
  if (filtro.situacoes.length > 0) {
    if (!filtro.situacoes.includes(a.situacaoId)) return false;
  } else if (filtro.situacoes_excluir.includes(a.situacaoId)) {
    return false;
  }

  // Exame, modalidade e o legado de termos são alternativas entre si: basta um
  // caminho reconhecer o atendimento.
  const temCriterioExame =
    filtro.exames.length > 0 || filtro.modalidades.length > 0 || filtro.termos_exame.length > 0;
  if (temCriterioExame) {
    const porSelecao    = estaNaSelecao(filtro.exames, a.exame);
    const porModalidade = a.modalidadeId != null && filtro.modalidades.includes(a.modalidadeId);
    const porTermo      = algumTermoCasa(filtro.termos_exame, a.exame ?? "");
    if (!porSelecao && !porModalidade && !porTermo) return false;
  }

  // Médico: id selecionado OU termo legado. Lista vazia = qualquer médico.
  if (filtro.medicos.length > 0 || filtro.termos_medico.length > 0) {
    const porId    = estaNaSelecao(filtro.medicos, a.medico);
    const porTermo = algumTermoCasa(filtro.termos_medico, a.medico ?? "");
    if (!porId && !porTermo) return false;
  }

  if (filtro.salas.length > 0 || filtro.termos_sala.length > 0) {
    if (!estaNaSelecao(filtro.salas, a.sala) && !algumTermoCasa(filtro.termos_sala, a.sala ?? "")) return false;
  }

  if (filtro.convenios.length > 0 || filtro.termos_convenio.length > 0) {
    if (!estaNaSelecao(filtro.convenios, a.convenio) && !algumTermoCasa(filtro.termos_convenio, a.convenio ?? "")) return false;
  }

  return true;
}

/** Termos digitados que sobraram de antes da configuração por seleção. */
export function termosLegado(f: FiltroNetris): string[] {
  return [...f.termos_exame, ...f.termos_medico, ...f.termos_sala, ...f.termos_convenio];
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
  return f.exames.length === 0
    && f.medicos.length === 0
    && f.salas.length === 0
    && f.convenios.length === 0
    && f.modalidades.length === 0
    && termosLegado(f).length === 0;
}

/** Resumo legível do filtro, para a interface explicar o que vai buscar. */
export function descreverFiltro(f: FiltroNetris): string {
  const partes: string[] = [];
  if (f.exames.length)      partes.push(`${f.exames.length} exame(s)`);
  if (f.modalidades.length) partes.push(`${f.modalidades.length} modalidade(s)`);
  if (f.medicos.length)     partes.push(`${f.medicos.length} médico(s)`);
  if (f.salas.length)       partes.push(`${f.salas.length} sala(s)`);
  if (f.convenios.length)   partes.push(`${f.convenios.length} convênio(s)`);
  const legado = termosLegado(f);
  if (legado.length)        partes.push(`${legado.length} termo(s) digitado(s) antigos`);
  if (partes.length === 0) return "Sem filtro configurado — traz todos os atendimentos do período.";
  return `Traz: ${partes.join(" · ")}.`;
}
