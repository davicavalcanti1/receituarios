// Os VALORES continuam em inglês, iguais aos do banco (ver Fase 1): trocá-los
// exigiria migrar 46 lotes e reescrever os mapas de label das telas sem ganho
// nenhum.

export const STATUS_LOTE = [
  "draft",
  "imported",
  "review_pending",
  "signature_pending",
  "partially_signed",
  "completed",
  "cancelled",
] as const;

export const STATUS_ITEM = [
  "draft",
  "validated",
  "review_pending",
  "signature_pending",
  "signed",
  "rejected",
  "cancelled",
] as const;

export type StatusLote  = (typeof STATUS_LOTE)[number];
export type StatusItem  = (typeof STATUS_ITEM)[number];

export interface Lote {
  id: string;
  titulo: string;
  tipo: string;
  status: StatusLote;
  total_itens: number;
  itens_assinados: number;
  medico_id: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface LoteItem {
  id: string;
  sequencia: number;
  status: StatusItem;
  paciente_nome: string;
  data_exame: string | null;
  procedimento: string | null;
  setor: string | null;
  medico_nome: string | null;
  payload: Record<string, unknown>;
}
