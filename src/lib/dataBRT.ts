// ─────────────────────────────────────────────────────────────────────────────
// Data de referência em BRT (America/Sao_Paulo)
//
// O app inteiro usa "hoje" como chave de data (data_ref, data_atendimento).
// Histórico de bugs de virada de dia vinha de três padrões misturados:
//   - format(new Date(), "yyyy-MM-dd")  → timezone do DISPOSITIVO
//   - new Date().toISOString().slice()  → UTC (já é amanhã às 21h BRT)
//   - Intl.DateTimeFormat en-CA + SP    → correto
// Este util é o único jeito sancionado de obter a data de hoje.
// ─────────────────────────────────────────────────────────────────────────────

/** Data de hoje (ou da Date passada) no formato YYYY-MM-DD em BRT. */
export function hojeBRT(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date);
}
