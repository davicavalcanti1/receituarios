// Geração do PDF de receituário — 2 receitas por página (paisagem A4),
// lado a lado: imprime a folha e corta no meio. Reproduz o modelo Word legado
// "RECEITUÁRIO INTERNO DE CONTROLE ESPECIAL" (Anestesia Dr. Felix / Longactil),
// conferido nos PDFs gerados pelo processo atual.

import jsPDF from "jspdf";
import imagoLogo from "@/assets/imago-logo.png";
import type { LinhaLote } from "./parseLote";
import { hojeBRT } from "@/lib/dataBRT";
import { supabase } from "@/integrations/supabase/client";

/** Código do template (receituarios.templates.codigo). */
export type TipoReceita = string;

interface Assinatura { nome: string; cargo: string; crm: string; }

/**
 * Fase 6: o template vem do banco (receituarios.templates), não mais de uma
 * constante. Antes, nome/cargo/CRM do Dr. Félix e do Dr. Igor e a lista de
 * medicações estavam fixos aqui — dados de UM cliente dentro do produto, o que
 * obrigaria outra clínica a forkar o código.
 */
export interface Template {
  codigo: string;
  nome: string;
  descricao?: string | null;
  titulo: string;
  setorFixo?: string | null;      // Longactil: setor é texto fixo
  derivarSetor?: boolean;         // Anestesia: deriva do exame/sala
  itens: string[];                // medicações com checkbox; "" = linha em branco
  comOutro?: boolean;             // acrescenta a linha "OUTRO:____"
  assinatura?: Assinatura | null; // bloco impresso sob a linha, no PDF sem assinatura digital
  mostrarMedico?: boolean;        // imprime o campo "MÉDICO:"
}

function daLinhaDoBanco(row: any): Template {
  return {
    codigo:        row.codigo,
    nome:          row.nome,
    descricao:     row.descricao,
    titulo:        row.titulo,
    setorFixo:     row.setor_fixo,
    derivarSetor:  row.derivar_setor,
    itens:         Array.isArray(row.itens) ? row.itens : [],
    comOutro:      row.com_outro,
    mostrarMedico: row.mostrar_medico,
    assinatura:    row.assinatura ?? null,
  };
}

const cacheTemplates = new Map<string, Template>();

export async function listarTemplates(): Promise<Template[]> {
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .eq("ativo", true)
    .order("ordem");
  if (error) throw error;
  const templates = (data ?? []).map(daLinhaDoBanco);
  for (const t of templates) cacheTemplates.set(t.codigo, t);
  return templates;
}

export async function carregarTemplate(codigo: string): Promise<Template> {
  const emCache = cacheTemplates.get(codigo);
  if (emCache) return emCache;

  const { data, error } = await supabase
    .from("templates").select("*").eq("codigo", codigo).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Template "${codigo}" não encontrado`);

  const tpl = daLinhaDoBanco(data);
  cacheTemplates.set(codigo, tpl);
  return tpl;
}

function derivarSetor(linha: LinhaLote): string {
  if (linha.setor) return linha.setor;
  const t = `${linha.sala} ${linha.procedimento}`.toUpperCase();
  if (t.includes("RESSON")) return "RESSONÂNCIA";
  if (t.includes("TOMO"))   return "TOMOGRAFIA";
  if (t.includes("MAMO"))   return "MAMOGRAFIA";
  if (t.includes("DENSITO")) return "DENSITOMETRIA";
  if (t.includes("ULTRA") || t.includes("USG")) return "ULTRASSONOGRAFIA";
  return "";
}

function dataHifen(d: string): string {
  return d.replace(/\//g, "-"); // modelo usa dd-MM-yyyy
}

function carregarLogo(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = imagoLogo;
  });
}

// Desenha uma receita dentro da coluna que começa em x0 e tem largura colW.
function desenharReceita(
  doc: jsPDF, x0: number, colW: number,
  linha: LinhaLote, tpl: Template, logo: HTMLImageElement | null,
) {
  const padX = 12;
  const left = x0 + padX;
  const right = x0 + colW - padX;
  const cx = x0 + colW / 2;
  let y = 16;

  // Logo IMAGO centralizado na coluna
  if (logo && logo.naturalWidth > 0) {
    const lw = 44;
    const lh = (logo.naturalHeight / logo.naturalWidth) * lw;
    doc.addImage(logo, "PNG", cx - lw / 2, y, lw, lh);
    y += lh + 6;
  } else {
    y += 6;
  }

  // Título
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(tpl.titulo, cx, y, { align: "center" });
  y += 9;

  // NOME / DATA / SETOR (label bold + valor, com wrap pro setor longo)
  const campo = (label: string, valor: string) => {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(label, left, y);
    const lw = doc.getTextWidth(label + " ");
    doc.setFont("helvetica", "normal");
    const maxW = right - (left + lw);
    const wrapped = doc.splitTextToSize(valor || "", Math.max(20, maxW)) as string[];
    doc.text(wrapped, left + lw, y);
    y += 7 * Math.max(1, wrapped.length);
  };
  campo("NOME DO PACIENTE:", linha.paciente);
  campo("DATA:", dataHifen(linha.data_exame));
  campo("SETOR:", tpl.setorFixo ?? (tpl.derivarSetor ? derivarSetor(linha) : ""));
  if (tpl.mostrarMedico) campo("MÉDICO:", linha.medico ?? "");
  y += 3;

  // Itens (checkbox + medicação)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const sufixo = "Apresentação/Quantidade:_________ /_________";
  for (const item of tpl.itens) {
    const nome = item || "______________";
    doc.text(`[    ] ${nome}: ${sufixo}`, left, y);
    y += 8;
  }
  if (tpl.comOutro) {
    doc.text("[    ] OUTRO:_______________. Apresentação/Quantidade:_____ /_______", left, y);
    y += 8;
  }

  // Assinatura
  const assY = 168;
  doc.setDrawColor(80);
  doc.line(cx - 42, assY, cx + 42, assY);
  if (tpl.assinatura) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(tpl.assinatura.nome, cx, assY + 5, { align: "center" });
    doc.text(tpl.assinatura.cargo, cx, assY + 10, { align: "center" });
    doc.text(tpl.assinatura.crm, cx, assY + 15, { align: "center" });
  }
}

export async function gerarPdfLote(
  tipo: TipoReceita, linhas: LinhaLote[],
): Promise<{ receitas: number; paginas: number }> {
  const validas = linhas.filter(l => l.erros.length === 0);
  if (validas.length === 0) return { receitas: 0, paginas: 0 };

  const [tpl, logo] = await Promise.all([carregarTemplate(tipo), carregarLogo()]);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }); // 297 x 210
  const W = doc.internal.pageSize.getWidth();
  const colW = W / 2;

  validas.forEach((linha, i) => {
    const ladoDireito = i % 2 === 1;
    if (i > 0 && !ladoDireito) doc.addPage();
    const x0 = ladoDireito ? colW : 0;
    desenharReceita(doc, x0, colW, linha, tpl, logo);
  });

  const hoje = hojeBRT();
  doc.save(`receituario_${tipo}_${hoje}.pdf`);
  return { receitas: validas.length, paginas: Math.ceil(validas.length / 2) };
}

// ── Versão com assinatura digital embeddada ───────────────────────────────────
// Usada pelo portal do médico após ele confirmar a assinatura.
// Insere o PNG da assinatura EM CIMA da linha horizontal, centralizado.
// Retorna o Blob do PDF (sem forçar download — o caller decide).

export async function gerarPdfLoteAssinado(
  tipo: TipoReceita,
  linhas: LinhaLote[],
  signaturePng: string,
  medico: { nome: string; crm: string; especialidade?: string },
): Promise<{ blob: Blob; receitas: number }> {
  const validas = linhas.filter((l: LinhaLote) => !l.erros || l.erros.length === 0);
  if (validas.length === 0) throw new Error("Nenhuma receita válida no lote");

  const [tplBase, logo] = await Promise.all([carregarTemplate(tipo), carregarLogo()]);
  // Quem assina é o médico atribuído, então o bloco fixo do template não é
  // impresso. Antes ele era desenhado e depois coberto por um retângulo branco
  // — hack que só existia porque o médico era hardcoded no template.
  const tpl: Template = { ...tplBase, assinatura: null };

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W   = doc.internal.pageSize.getWidth();
  const colW = W / 2;

  // Pré-carrega a imagem da assinatura
  const sigImg = await new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload  = () => res(img);
    img.onerror = rej;
    img.src = signaturePng;
  });

  const assY = 168; // Y da linha de assinatura (mesmo de desenharReceita)

  validas.forEach((linha: LinhaLote, i: number) => {
    const ladoDireito = i % 2 === 1;
    if (i > 0 && !ladoDireito) doc.addPage();
    const x0 = ladoDireito ? colW : 0;
    const cx = x0 + colW / 2;

    desenharReceita(doc, x0, colW, linha, tpl, logo);

    // Embed da assinatura: PNG proporcional, centralizado, acima da linha
    const sigMaxW = 60; // mm
    const sigMaxH = 18; // mm — cabe entre o conteúdo e a linha (assY - margemSuperior)
    const ratio = sigImg.naturalWidth / sigImg.naturalHeight;
    let sigW = sigMaxW, sigH = sigMaxW / ratio;
    if (sigH > sigMaxH) { sigH = sigMaxH; sigW = sigMaxH * ratio; }
    const sigX = cx - sigW / 2;
    const sigYTop = assY - sigH - 1; // 1mm acima da linha

    doc.addImage(signaturePng, "PNG", sigX, sigYTop, sigW, sigH);

    // Nome completo, especialidade e CRM — todos em maiúsculo
    doc.setTextColor(0, 0, 0);
    let yText = assY + 5;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(medico.nome.toUpperCase(), cx, yText, { align: "center" });
    yText += 4.5;

    if (medico.especialidade) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(medico.especialidade.toUpperCase(), cx, yText, { align: "center" });
      yText += 4;
    }

    if (medico.crm) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(medico.crm.toUpperCase(), cx, yText, { align: "center" });
    }
  });

  const blob = doc.output("blob");
  return { blob, receitas: validas.length };
}
