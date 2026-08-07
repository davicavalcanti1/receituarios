import { supabase } from "@/integrations/supabase/client";
import type { LinhaLote } from "@/features/receituarios/lib/parseLote";

function brParaIso(d: string): string | null {
  const m = (d ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export const receituariosService = {
  // Salva o lote (lote + itens). A LinhaLote completa fica em `payload` pra
  // permitir regenerar o mesmo PDF depois sem armazenar o arquivo.
  async criarLote(params: {
    tenantId: string; userId?: string | null; tipo: string; titulo: string;
    linhas: LinhaLote[]; medicoId?: string;
  }): Promise<{ id: string }> {
    const { tenantId, userId, tipo, titulo, linhas, medicoId } = params;
    const validas = linhas.filter(l => l.erros.length === 0);

    const { data: lote, error: loteErr } = await supabase
      .from("lotes")
      .insert({
        tenant_id:  tenantId,
        titulo,
        tipo,
        status:     medicoId ? "signature_pending" : "imported",
        origem:     "manual_import",
        total_itens: validas.length,
        criado_por: userId ?? null,
        medico_id:  medicoId ?? null,
        enviado_para_assinatura_em: medicoId ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (loteErr) throw loteErr;

    const itens = validas.map((l, idx) => ({
      tenant_id:     tenantId,
      lote_id:       lote.id,
      sequencia:     idx + 1,
      status:        "draft",
      paciente_nome: l.paciente,
      data_exame:    brParaIso(l.data_exame),
      procedimento:  l.procedimento || null,
      setor:         l.setor || null,
      medico_nome:   l.medico || null,
      payload:       l,
    }));
    if (itens.length) {
      const { error: itErr } = await supabase.from("lote_itens").insert(itens);
      if (itErr) throw itErr;
    }
    return { id: lote.id as string };
  },

  // Carrega as linhas de um lote salvo (a partir de `payload`) pra regerar o PDF.
  async getLinhasDoLote(loteId: string): Promise<{ tipo: string; linhas: LinhaLote[] }> {
    const { data: lote, error: lErr } = await supabase
      .from("lotes").select("tipo").eq("id", loteId).single();
    if (lErr) throw lErr;

    const { data: itens, error: iErr } = await supabase
      .from("lote_itens")
      .select("payload, sequencia")
      .eq("lote_id", loteId)
      .order("sequencia", { ascending: true });
    if (iErr) throw iErr;

    const linhas = (itens ?? []).map(it => it.payload as LinhaLote);
    return { tipo: lote.tipo as string, linhas };
  },
};
