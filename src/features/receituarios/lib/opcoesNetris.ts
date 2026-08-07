// Opções de configuração extraídas do NetRis real.
//
// Existe para que configurar um receituário seja ESCOLHER, nunca digitar: antes,
// um "ANASTESIA" com erro de grafia fazia o filtro não trazer ninguém, em
// silêncio. Também elimina as listas fixas de modalidade e situação que estavam
// no código da tela — agora vêm do que a clínica de fato usa.

import { buscarAtendimentos } from "@/services/netris/atendimentos";
import type { Atendimento } from "@/services/netris/types";

export interface Opcao {
  /** O que é gravado no filtro. */
  valor: string;
  /** O que aparece na tela. */
  rotulo: string;
  /** Quantos atendimentos do período têm este valor — ajuda a escolher. */
  ocorrencias: number;
}

export interface OpcoesNetris {
  exames: Opcao[];
  medicos: Opcao[];
  salas: Opcao[];
  convenios: Opcao[];
  modalidades: Opcao[];
  situacoes: Opcao[];
  totalAtendimentos: number;
  periodo: { de: string; ate: string };
  /** Os atendimentos crus, para a tela contar ao vivo sem novo request. */
  atendimentos: Atendimento[];
}

function contar(): Map<string, { rotulo: string; n: number }> {
  return new Map();
}

function registrar(
  mapa: Map<string, { rotulo: string; n: number }>,
  valor: string | number | undefined | null,
  rotulo: string | undefined | null,
) {
  if (valor == null || valor === "" || valor === 0) return;
  const chave = String(valor);
  const atual = mapa.get(chave);
  if (atual) atual.n += 1;
  else mapa.set(chave, { rotulo: (rotulo ?? chave).toString().trim() || chave, n: 1 });
}

function paraLista(mapa: Map<string, { rotulo: string; n: number }>): Opcao[] {
  return [...mapa.entries()]
    .map(([valor, { rotulo, n }]) => ({ valor, rotulo, ocorrencias: n }))
    // Mais frequentes primeiro: o que a clínica mais faz aparece no topo.
    .sort((a, b) => b.ocorrencias - a.ocorrencias || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

function isoDiasAtras(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

function hoje(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/**
 * Varre os atendimentos de um período e devolve os valores distintos de cada
 * campo. O período importa: 7 dias pode não conter um exame raro, 90 dias traz
 * mais opções mas demora mais (o backend quebra em blocos semanais).
 */
export async function carregarOpcoesNetris(dias = 30): Promise<OpcoesNetris> {
  const de = isoDiasAtras(dias);
  const ate = hoje();
  const ats = await buscarAtendimentos({ dataInicial: de, dataFinal: ate });

  const exames = contar(), medicos = contar(), salas = contar();
  const convenios = contar(), modalidades = contar(), situacoes = contar();

  for (const a of ats) {
    registrar(exames, a.exame, a.exame);
    // Médico é gravado por ID (estável); o nome é só o rótulo.
    registrar(medicos, a.medicoId ?? a.medico, a.medico);
    registrar(salas, a.sala, a.sala);
    registrar(convenios, a.convenio, a.convenio);
    registrar(modalidades, a.modalidadeId, a.modalidade);
    registrar(situacoes, a.situacaoId, a.situacao);
  }

  return {
    exames:      paraLista(exames),
    medicos:     paraLista(medicos),
    salas:       paraLista(salas),
    convenios:   paraLista(convenios),
    modalidades: paraLista(modalidades),
    situacoes:   paraLista(situacoes),
    totalAtendimentos: ats.length,
    atendimentos: ats,
    periodo: { de, ate },
  };
}
