// Configurações → Integração
//
// Tira NETRIS_BASE_URL / NETRIS_TOKEN / NETRIS_FILIAL_ID das variáveis de
// ambiente: trocar o token exigia mexer no EasyPanel e reiniciar o container.
//
// O token nunca chega aqui. A tela sabe apenas SE existe um guardado; para
// trocá-lo, digita-se um novo. Ler e gravar passa pelo servidor, que é quem
// tem service_role — a tabela `integracoes` é invisível para o navegador.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, PlugZap, ShieldCheck, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface EstadoNetris {
  ativo: boolean;
  baseUrl: string;
  filialId: string;
  atualizadoEm: string | null;
  temTokenGuardado: boolean;
  origemEmUso: "banco" | "env" | "nenhuma";
}

async function comAuth(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
}

export default function IntegracaoNetris() {
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [estado, setEstado] = useState<EstadoNetris | null>(null);
  const [novoToken, setNovoToken] = useState("");
  const [teste, setTeste] = useState<{ ok: boolean; detalhe?: string; status?: number } | null>(null);

  async function carregar() {
    setCarregando(true);
    try {
      const r = await fetch("/api/config/netris", { headers: await comAuth() });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Erro ${r.status}`);
      setEstado(await r.json());
    } catch (e: any) {
      toast.error("Erro ao carregar a integração", { description: e?.message });
    } finally { setCarregando(false); }
  }

  useEffect(() => { carregar(); }, []);

  async function salvar() {
    if (!estado) return;
    setSalvando(true);
    try {
      const r = await fetch("/api/config/netris", {
        method: "PUT",
        headers: await comAuth(),
        body: JSON.stringify({
          ativo: estado.ativo,
          baseUrl: estado.baseUrl,
          filialId: estado.filialId,
          ...(novoToken ? { token: novoToken } : {}),
        }),
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error ?? `Erro ${r.status}`);
      toast.success("Integração salva");
      setNovoToken("");
      await carregar();
    } catch (e: any) {
      toast.error("Erro ao salvar", { description: e?.message });
    } finally { setSalvando(false); }
  }

  async function testar() {
    if (!estado) return;
    setTestando(true);
    setTeste(null);
    try {
      const r = await fetch("/api/config/netris/testar", {
        method: "POST",
        headers: await comAuth(),
        body: JSON.stringify({
          baseUrl: estado.baseUrl,
          filialId: estado.filialId,
          ...(novoToken ? { token: novoToken } : {}),
        }),
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error ?? `Erro ${r.status}`);
      setTeste(corpo);
    } catch (e: any) {
      toast.error("Erro ao testar", { description: e?.message });
    } finally { setTestando(false); }
  }

  if (carregando) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (!estado) return null;

  const usandoEnv = estado.origemEmUso === "env";

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <PlugZap className="h-4 w-4 text-primary" /> NetRis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            De onde vêm os pacientes na aba “Buscar por data”. Sem esta integração o
            módulo funciona normalmente por importação manual.
          </p>

          {usandoEnv && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                A conexão em uso ainda vem das <strong>variáveis de ambiente</strong> do
                servidor. Ao salvar aqui, esta configuração passa a valer no lugar delas.
              </p>
            </div>
          )}

          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            <button
              type="button"
              onClick={() => setEstado({ ...estado, ativo: !estado.ativo })}
              className={cn(
                "h-6 w-11 rounded-full transition-colors relative shrink-0",
                estado.ativo ? "bg-primary" : "bg-muted-foreground/30",
              )}
              aria-label="Ativar integração"
            >
              <span className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                estado.ativo ? "left-[22px]" : "left-0.5",
              )} />
            </button>
            <div>
              <p className="text-sm font-medium">{estado.ativo ? "Integração ativa" : "Integração desligada"}</p>
              <p className="text-xs text-muted-foreground">
                {estado.ativo
                  ? "A aba “Buscar por data” aparece no novo lote."
                  : "Só importação manual (colar planilha ou .csv)."}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium">URL base</label>
              <Input
                value={estado.baseUrl}
                onChange={e => setEstado({ ...estado, baseUrl: e.target.value })}
                placeholder="https://ris.suaclinica.com.br/api-gateway"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Token</label>
              <Input
                type="password"
                value={novoToken}
                onChange={e => setNovoToken(e.target.value)}
                placeholder={estado.temTokenGuardado ? "•••••••• (guardado)" : "cole o token aqui"}
              />
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <ShieldCheck className="h-3 w-3 shrink-0" />
                {estado.temTokenGuardado
                  ? "Há um token guardado. Deixe em branco para mantê-lo."
                  : "Nenhum token guardado ainda."}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Filial</label>
              <Input
                value={estado.filialId}
                onChange={e => setEstado({ ...estado, filialId: e.target.value })}
                placeholder="1"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={salvar} disabled={salvando} className="gap-2">
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </Button>
            <Button variant="outline" onClick={testar} disabled={testando} className="gap-2">
              {testando ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
              Testar conexão
            </Button>
            {estado.atualizadoEm && (
              <span className="text-xs text-muted-foreground ml-auto">
                Atualizado em {new Date(estado.atualizadoEm).toLocaleString("pt-BR")}
              </span>
            )}
          </div>

          {teste && (
            <div className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2",
              teste.ok
                ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20"
                : "border-red-200 bg-red-50 dark:bg-red-950/20",
            )}>
              {teste.ok
                ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                : <XCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />}
              <div className="text-xs">
                <p className={teste.ok ? "text-emerald-800 dark:text-emerald-300" : "text-red-800 dark:text-red-300"}>
                  {teste.ok ? "Conexão OK — o NetRis respondeu." : `Falhou${teste.status ? ` (HTTP ${teste.status})` : ""}.`}
                </p>
                {teste.detalhe && <p className="text-muted-foreground mt-0.5 break-all">{teste.detalhe}</p>}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            <strong>Quais</strong> pacientes cada receituário traz do NetRis é configurado
            em cada receituário, na aba ao lado — a Anestesia puxa uma coisa, o Longactil outra.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
