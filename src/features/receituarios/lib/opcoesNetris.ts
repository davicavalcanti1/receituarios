// Opções de configuração vindas do CATÁLOGO do NetRis.
//
// O NetRis expõe as listas prontas (/medicos, /procedimentos, /modalidades,
// /salas, /convenios), então é só listá-las — é o que o ExameQR faz. A versão
// anterior varria 30 dias de atendimentos e deduzia os valores distintos:
// demorava, dependia de ter havido movimento no período e só mostrava o que por
// acaso tinha acontecido.
//
// Situações são a exceção: não há endpoint de catálogo no NetRis. Os IDs abaixo
// foram confirmados contra a API real e já viviam em services/netris/client.ts.

import { supabase } from "@/integrations/supabase/client";
import { SITUACAO } from "@/services/netris/client";

export interface Opcao {
  /** O que é gravado no filtro. */
  valor: string;
  /** O que aparece na tela. */
  rotulo: string;
}

export interface OpcoesNetris {
  medicos: Opcao[];
  exames: Opcao[];
  modalidades: Opcao[];
  salas: Opcao[];
  convenios: Opcao[];
  situacoes: Opcao[];
}

// Sem endpoint de catálogo — lista fixa, com os nomes que o NetRis usa.
const SITUACOES: Opcao[] = [
  { valor: String(SITUACAO.MARCADO),                 rotulo: "Marcado" },
  { valor: String(SITUACAO.A_CONFIRMAR),             rotulo: "A confirmar" },
  { valor: String(SITUACAO.CONFIRMADO),              rotulo: "Confirmado" },
  { valor: String(SITUACAO.CANCELADO),               rotulo: "Cancelado" },
  { valor: String(SITUACAO.CHEGOU),                  rotulo: "Chegou" },
  { valor: String(SITUACAO.ATENDIMENTO),             rotulo: "Em atendimento" },
  { valor: String(SITUACAO.ENCAMINHADO_EXAME),       rotulo: "Encaminhado para exame" },
  { valor: String(SITUACAO.EM_SALA),                 rotulo: "Em sala" },
  { valor: String(SITUACAO.ANAMNESE),                rotulo: "Anamnese realizada" },
  { valor: String(SITUACAO.PACIENTE_PREPARADO),      rotulo: "Paciente preparado" },
  { valor: String(SITUACAO.PREPARADO_ENFERMAGEM),    rotulo: "Preparado enfermagem" },
  { valor: String(SITUACAO.ENCAMINHADO_RM_TC),       rotulo: "Encaminhado RM/TC" },
  { valor: String(SITUACAO.EXAME_REALIZADO),         rotulo: "Executado" },
  { valor: String(SITUACAO.LANCAR_MATERIAL),         rotulo: "Lançar material" },
  { valor: String(SITUACAO.A_CANCELAR),              rotulo: "A cancelar" },
  { valor: String(SITUACAO.GUIA_DEVOLVIDA_RECEPCAO), rotulo: "Guia devolvida à recepção" },
  { valor: String(SITUACAO.FINALIZADO),              rotulo: "Finalizado" },
  { valor: String(SITUACAO.FATURADO),                rotulo: "Faturado" },
];

export async function carregarOpcoesNetris(): Promise<OpcoesNetris> {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch("/api/netris/catalogo", {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  if (!r.ok) {
    const corpo = await r.json().catch(() => ({}));
    throw new Error(corpo?.detail ?? corpo?.error ?? `Erro ${r.status}`);
  }
  const cat = await r.json();

  const ordenar = (l: Opcao[]) =>
    [...l].sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));

  return {
    medicos:     ordenar(cat.medicos ?? []),
    exames:      ordenar(cat.exames ?? []),
    modalidades: ordenar(cat.modalidades ?? []),
    salas:       ordenar(cat.salas ?? []),
    convenios:   ordenar(cat.convenios ?? []),
    situacoes:   SITUACOES,
  };
}
