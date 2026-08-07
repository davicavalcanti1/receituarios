// Templates de receituário — carga, gravação e tipos.
//
// Saiu de dentro de gerarPdf.ts: com o filtro do NetRis e o médico padrão
// entrando aqui, o template deixou de ser assunto só do PDF.

import { supabase } from "@/integrations/supabase/client";
import {
  normalizarFiltro, normalizarRegrasSetor, FILTRO_VAZIO,
  type FiltroNetris, type RegraSetor,
} from "./filtroNetris";

export interface Assinatura { nome: string; cargo: string; crm: string }

export interface Template {
  id?: string;
  codigo: string;
  nome: string;
  descricao?: string | null;
  titulo: string;
  setorFixo?: string | null;      // Longactil: setor é texto fixo
  derivarSetor?: boolean;         // Anestesia: deriva do exame/sala
  /** Regras de derivação do setor; vence a primeira que casar. */
  setorRegras: RegraSetor[];
  itens: string[];                // medicações com checkbox; "" = linha em branco
  comOutro?: boolean;             // acrescenta a linha "OUTRO:____"
  assinatura?: Assinatura | null; // bloco impresso no PDF SEM assinatura digital
  mostrarMedico?: boolean;        // imprime o campo "MÉDICO:"
  ativo?: boolean;
  ordem?: number;
  /** Quais atendimentos do NetRis este receituário traz. */
  filtroNetris: FiltroNetris;
  /** Médico já pré-selecionado ao criar um lote deste tipo. */
  medicoPadraoId?: string | null;
}

export const TITULO_PADRAO = "RECEITUÁRIO INTERNO DE CONTROLE ESPECIAL";

export function daLinhaDoBanco(row: any): Template {
  return {
    id:             row.id,
    codigo:         row.codigo,
    nome:           row.nome,
    descricao:      row.descricao,
    titulo:         row.titulo ?? TITULO_PADRAO,
    setorFixo:      row.setor_fixo,
    derivarSetor:   row.derivar_setor,
    itens:          Array.isArray(row.itens) ? row.itens : [],
    comOutro:       row.com_outro,
    mostrarMedico:  row.mostrar_medico,
    assinatura:     row.assinatura ?? null,
    ativo:          row.ativo,
    ordem:          row.ordem,
    filtroNetris:   normalizarFiltro(row.filtro_netris),
    setorRegras:    normalizarRegrasSetor(row.setor_regras),
    medicoPadraoId: row.medico_padrao_id ?? null,
  };
}

export function paraOBanco(t: Template, tenantId: string) {
  return {
    tenant_id:        tenantId,
    codigo:           t.codigo,
    nome:             t.nome,
    descricao:        t.descricao ?? null,
    titulo:           t.titulo || TITULO_PADRAO,
    setor_fixo:       t.setorFixo || null,
    derivar_setor:    !!t.derivarSetor,
    itens:            t.itens,
    com_outro:        !!t.comOutro,
    mostrar_medico:   !!t.mostrarMedico,
    assinatura:       t.assinatura ?? null,
    ativo:            t.ativo !== false,
    ordem:            t.ordem ?? 0,
    filtro_netris:    t.filtroNetris ?? FILTRO_VAZIO,
    setor_regras:     t.setorRegras ?? [],
    medico_padrao_id: t.medicoPadraoId || null,
  };
}

const cache = new Map<string, Template>();

export function limparCacheTemplates() {
  cache.clear();
}

export async function listarTemplates(incluirInativos = false): Promise<Template[]> {
  let q = supabase.from("templates").select("*").order("ordem");
  if (!incluirInativos) q = q.eq("ativo", true);
  const { data, error } = await q;
  if (error) throw error;
  const templates = (data ?? []).map(daLinhaDoBanco);
  for (const t of templates) cache.set(t.codigo, t);
  return templates;
}

export async function carregarTemplate(codigo: string): Promise<Template> {
  const emCache = cache.get(codigo);
  if (emCache) return emCache;

  const { data, error } = await supabase
    .from("templates").select("*").eq("codigo", codigo).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Template "${codigo}" não encontrado`);

  const tpl = daLinhaDoBanco(data);
  cache.set(codigo, tpl);
  return tpl;
}

export async function salvarTemplate(t: Template, tenantId: string): Promise<void> {
  const payload = paraOBanco(t, tenantId);
  const { error } = t.id
    ? await supabase.from("templates").update(payload).eq("id", t.id)
    : await supabase.from("templates").insert(payload);
  if (error) throw error;
  limparCacheTemplates();
}

export function templateNovo(): Template {
  return {
    codigo: "",
    nome: "",
    descricao: "",
    titulo: TITULO_PADRAO,
    setorFixo: "",
    derivarSetor: true,
    itens: [""],
    comOutro: false,
    mostrarMedico: false,
    assinatura: null,
    ativo: true,
    ordem: 0,
    filtroNetris: { ...FILTRO_VAZIO, situacoes_excluir: [1, 5] },
    setorRegras: [],
    medicoPadraoId: null,
  };
}
