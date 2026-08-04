// Parser de lote de pacientes para o módulo de Receituários.
// Aceita texto colado direto do Excel/NetRis (TSV) ou conteúdo de um .csv
// (vírgula ou ponto-e-vírgula). Reconhece colunas por nome (tolerante a
// acento/caixa/espaços) e normaliza para os campos canônicos.
//
// Detalhe do NetRis: ao colar a grade de atendimentos, UM paciente costuma
// vir quebrado em várias linhas físicas (a célula "Situação" cai numa linha
// isolada — ex.: "GUIA ENCAMINHADA AO FATURAMENTO"). Quando a primeira coluna
// é a Data, reconstruímos cada registro usando a data como âncora: tudo entre
// uma data e a próxima pertence ao mesmo paciente.

export const CAMPOS_LOTE = [
  "data_exame",
  "horario",
  "paciente",
  "procedimento",
  "situacao",
  "convenio",
  "sala",
  "medico",
  "setor",
] as const;

export type CampoLote = (typeof CAMPOS_LOTE)[number];

export interface LinhaLote {
  index: number; // 1-based, posição na importação
  data_exame: string;
  horario: string;
  paciente: string;
  procedimento: string;
  situacao: string;
  convenio: string;
  sala: string;
  medico: string;
  setor: string;
  erros: string[];
  raw: Record<string, string>;
}

export interface ResultadoParse {
  linhas: LinhaLote[];
  colunasReconhecidas: CampoLote[];
  cabecalhosIgnorados: string[];
  totalValidas: number;
  totalInvalidas: number;
}

// Campos sem os quais a linha não gera receita.
const OBRIGATORIOS: CampoLote[] = ["paciente", "procedimento"];

// Aliases aceitos por campo (já normalizados: minúsculo, sem acento, trim).
const ALIASES: Record<CampoLote, string[]> = {
  data_exame:   ["data_exame", "data do exame", "data exame", "dataexame", "data", "dt exame", "dt"],
  horario:      ["horario", "hora", "horario/duracao", "horario duracao", "hr"],
  paciente:     ["paciente", "nome", "nome paciente", "nome do paciente", "nome_paciente", "pac"],
  procedimento: ["procedimento", "exame", "exames", "proc", "procedimentos"],
  situacao:     ["situacao", "status"],
  convenio:     ["convenio", "plano", "plano de saude"],
  sala:         ["sala", "salas"],
  medico:       ["medico", "doutor", "dr", "medico responsavel", "medico solicitante"],
  setor:        ["setor", "setores"],
};

function vazios(): Record<CampoLote, string> {
  return {
    data_exame: "", horario: "", paciente: "", procedimento: "", situacao: "",
    convenio: "", sala: "", medico: "", setor: "",
  };
}

// Monta uma LinhaLote a partir de valores parciais, aplicando defaults,
// normalização de data e validação de obrigatórios. Usado tanto pelo parser
// de texto quanto pela importação direta do NetRis.
export function linhaDeValores(index: number, parciais: Partial<Record<CampoLote, string>>): LinhaLote {
  const valores = { ...vazios(), ...parciais };
  const erros: string[] = [];
  for (const campo of OBRIGATORIOS) {
    if (!valores[campo]) erros.push(`${campo} ausente`);
  }
  const dataNorm = normalizarData(valores.data_exame);
  if (dataNorm === null) erros.push("data inválida");
  else valores.data_exame = dataNorm;
  return { index, ...valores, erros, raw: { ...parciais } as Record<string, string> };
}

// Recalcula os totais de um conjunto de linhas (válidas vs com erro).
export function resumoLinhas(linhas: LinhaLote[]): { totalValidas: number; totalInvalidas: number } {
  const totalInvalidas = linhas.filter(l => l.erros.length > 0).length;
  return { totalValidas: linhas.length - totalInvalidas, totalInvalidas };
}

function normalizarChave(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // tira acentos (combining marks)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function detectarDelimitador(texto: string): string {
  const primeiraLinha = texto.split(/\r?\n/, 1)[0] ?? "";
  if (primeiraLinha.includes("\t")) return "\t";
  if (primeiraLinha.includes(";")) return ";";
  return ",";
}

// Split de uma linha respeitando aspas duplas (campos com o delimitador dentro).
function splitLinha(linha: string, delim: string): string[] {
  const out: string[] = [];
  let atual = "";
  let dentroAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentroAspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentroAspas = !dentroAspas;
    } else if (c === delim && !dentroAspas) {
      out.push(atual);
      atual = "";
    } else {
      atual += c;
    }
  }
  out.push(atual);
  return out.map(s => s.trim());
}

const RE_DATA = /^\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})/;
function pareceData(linha: string): boolean {
  return RE_DATA.test(linha);
}

// Normaliza data para dd/MM/yyyy. Devolve "" se vazia; null se não reconhecida.
function normalizarData(valor: string): string | null {
  const v = valor.trim();
  if (!v) return "";
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // ISO
  if (m) {
    const [, y, mo, d] = m;
    return `${d.padStart(2, "0")}/${mo.padStart(2, "0")}/${y}`;
  }
  m = v.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/); // dd/MM/yyyy etc.
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = `20${y}`;
    return `${d.padStart(2, "0")}/${mo.padStart(2, "0")}/${y}`;
  }
  return null;
}

export function parseLote(texto: string): ResultadoParse {
  const linhasTexto = texto.split(/\r?\n/).filter(l => l.trim().length > 0);

  if (linhasTexto.length === 0) {
    return { linhas: [], colunasReconhecidas: [], cabecalhosIgnorados: [], totalValidas: 0, totalInvalidas: 0 };
  }

  const delim = detectarDelimitador(texto);
  const cabecalhos = splitLinha(linhasTexto[0], delim);

  // Mapeia índice da coluna -> campo canônico
  const colMap = new Map<number, CampoLote>();
  const cabecalhosIgnorados: string[] = [];
  cabecalhos.forEach((cab, idx) => {
    const chave = normalizarChave(cab);
    const campo = CAMPOS_LOTE.find(c => ALIASES[c].includes(chave));
    if (campo && ![...colMap.values()].includes(campo)) colMap.set(idx, campo);
    else if (cab.trim()) cabecalhosIgnorados.push(cab.trim());
  });

  // Ordem dos campos conforme as colunas do cabeçalho (pro mapeamento posicional).
  const ordemColunas: (CampoLote | null)[] = cabecalhos.map((_, idx) => colMap.get(idx) ?? null);
  const colunasReconhecidas = ordemColunas.filter((c): c is CampoLote => c !== null);

  const corpo = linhasTexto.slice(1);
  const primeiraColEhData = colMap.get(0) === "data_exame";

  // Reconstrói os registros.
  // - Se a 1ª coluna é Data: agrupa as linhas físicas por âncora de data e
  //   achata as células não-vazias (lida com a Situação isolada e tabs sobrando).
  // - Senão: 1 linha física = 1 registro, preservando posições (CSV bem-comportado).
  const registros: string[][] = [];
  if (primeiraColEhData) {
    let buffer: string[] = [];
    const flush = () => { if (buffer.length) { registros.push(buffer); buffer = []; } };
    for (const linha of corpo) {
      if (pareceData(linha) && buffer.length) flush();
      for (const c of splitLinha(linha, delim)) {
        if (c) buffer.push(c);
      }
    }
    flush();
  } else {
    for (const linha of corpo) registros.push(splitLinha(linha, delim));
  }

  const linhas: LinhaLote[] = registros.map((cells, i) => {
    const valores = vazios();

    if (primeiraColEhData) {
      // Mapeamento posicional: a k-ésima célula corresponde à k-ésima coluna do
      // cabeçalho, pulando as colunas não reconhecidas.
      let col = 0;
      for (const cell of cells) {
        while (col < ordemColunas.length && ordemColunas[col] === null) col++;
        const campo = ordemColunas[col];
        if (campo) valores[campo] = cell;
        col++;
      }
    } else {
      colMap.forEach((campo, idx) => {
        valores[campo] = (cells[idx] ?? "").trim();
      });
    }

    return linhaDeValores(i + 1, valores);
  });

  return {
    linhas,
    colunasReconhecidas,
    cabecalhosIgnorados,
    ...resumoLinhas(linhas),
  };
}
