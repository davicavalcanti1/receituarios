// ─────────────────────────────────────────────────────────────────────────────
// NetRis Types — campos confirmados via API real (14/04/2026)
// ─────────────────────────────────────────────────────────────────────────────

export interface Atendimento {
  id: string;                  // idAtendimentoProcedimento
  nomePaciente: string;
  cpf?: string;
  telefone?: string;           // telefoneCelularPaciente
  dataNascimento?: string;     // ISO (convertido de epoch ms)
  sexo?: string;               // sexoPaciente ("M"/"F")
  nomeMae?: string;
  idPaciente?: string;
  exame: string;               // nomeProcedimento
  modalidade?: string;         // descricaoModalidade
  modalidadeId?: number;       // idModalidade
  medico?: string;             // nomeMedicoExecutor
  medicoId?: string;
  sala?: string;               // nomeSala
  horario?: string;            // "HH:mm" (convertido de ms desde meia-noite)
  dataHora?: string;           // ISO (convertido de epoch ms)
  situacaoId: number;          // idSituacao
  situacao?: string;           // nomeSituacao
  filialId?: string;
  convenio?: string;           // nomeConvenio
  valorProcedimento?: number;
  raw?: Record<string, unknown>;
}

export interface Paciente {
  id: string;
  nome: string;
  cpf?: string;
  telefone?: string;       // celular (campo legado — mantido pra compat com listings)
  telefoneFixo?: string;   // residencial — obrigatório no validador do PUT NetRis
  dataNascimento?: string;
  sexo?: string;
  email?: string;
  nomeMae?: string;
  pesoKg?: string;         // string pra preservar entrada do usuário ("70" ou "70,5")
  alturaCm?: string;
}

export interface Modalidade {
  id: number;
  nome: string;
  chave?: string;
}

export interface BuscarAtendimentosParams {
  dataInicial?: string;   // YYYY-MM-DD (convertido para DD/MM/YYYY internamente)
  dataFinal?: string;
  filialId?: string;
  situacaoId?: number | number[];    // filtrado NO CLIENTE
  modalidadeId?: number;             // filtrado NO CLIENTE
  pacienteNome?: string;             // filtrado NO CLIENTE
  cpf?: string;                      // filtrado NO CLIENTE
}

export interface SyncResult {
  tableName: string;
  inseridos: number;
  deletados: number;
  historico: number;
  erros: string[];
  timestamp: Date;
}

export interface TotemPaciente {
  id: string;
  nome: string;
  exame: string;
  horario: string | null;
  situacao: string;
  chegouEm: string | null;
  // Prioridade vinda do nosso queue_entries (enriquecido em buscarFilaTotem
  // via match por nome). Pode ser undefined se o paciente entrou direto pela
  // recepção (CHEGOU marcado manual no NetRis sem passar pelo totem público).
  tipoAtendimento?: string;
}

// Só as 3 prioridades reais do catálogo NetRis (ver checkin-public.ts e
// netris.ts no server). PCD/Gestante/Autista/Crianca foram removidos em 18/mai
// porque o NetRis não tem ID cadastrado pra elas — o backend mapeava tudo pra
// Idoso silenciosamente.
export type TotemPrioridadeTipo = "normal" | "idoso" | "ostomizadas";

export interface TotemCheckinParams {
  pacienteId: string | number;
  prioridade: TotemPrioridadeTipo;
  /**
   * UUID de totem_locations. Quando ausente, o server usa os defaults do env
   * (NETRIS_TOTEM_*). Multi-totem: cada localidade tem seu próprio UUID.
   */
  locationId?: string;
  /**
   * Nome a mostrar na chamada do painel NetRis. Server manda esse valor no
   * campo `senha` do POST /totem/registro/salvar e o painel exibe "N-NOME"
   * em vez do antigo "N-123". Sanitizado server-side.
   */
  nomePaciente?: string;
}

export type GrupoBusca =
  | "faltas" | "a_confirmar" | "confirmado" | "chegou"
  | "encaminhado" | "realizado" | "cancelado" | "todos";

export const GRUPO_SITUACOES: Record<GrupoBusca, number[]> = {
  faltas:       [2, 26],
  a_confirmar:  [2],
  confirmado:   [3],
  chegou:       [3, 13],
  encaminhado:  [13],
  realizado:    [18],
  cancelado:    [5],
  todos:        [],
};

export const GRUPO_LABELS: Record<GrupoBusca, string> = {
  faltas:       "Faltas (A confirmar + A cancelar)",
  a_confirmar:  "A Confirmar",
  confirmado:   "Confirmado",
  chegou:       "Chegou / Encaminhado",
  encaminhado:  "Encaminhado para Exame",
  realizado:    "Exame Realizado",
  cancelado:    "Cancelado",
  todos:        "Todos",
};
