// ─────────────────────────────────────────────────────────────────────────────
// /cadastro/medico?token=<invite_token>
//
// Fluxo de cadastro do médico via link de convite gerado pelo admin:
//   1. Valida o token pela RPC receituarios.validar_convite
//   2. Médico preenche nome, email, senha, CRM e especialidade
//   3. Médico desenha a assinatura no canvas (obrigatório)
//   4. O servidor cria a conta e a linha em receituarios.medicos
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, PenLine, RotateCcw, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { supabase } from "@/integrations/supabase/client";
import imagoLogo from "@/assets/imago-logo.png";

const schema = z.object({
  fullName:     z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  email:        z.string().email("Email inválido"),
  password:     z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
  crm:          z.string().min(3, "CRM inválido (ex: 7608-PB)"),
  especialidade:z.string().min(3, "Especialidade obrigatória"),
});
type FormData = z.infer<typeof schema>;

// ── Componente canvas de assinatura ──────────────────────────────────────────

function AssinaturaCanvas({ onSave, onClear, saved }: {
  onSave: (png: string) => void;
  onClear: () => void;
  saved: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  function getPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const src = "touches" in e ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * (canvas.width / rect.width),
      y: (src.clientY - rect.top)  * (canvas.height / rect.height),
    };
  }

  function start(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    drawing.current = true;
    const canvas = canvasRef.current!;
    lastPos.current = getPos(e, canvas);
  }

  function move(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    if (!drawing.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current!.x, lastPos.current!.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    lastPos.current = pos;
  }

  function end() { drawing.current = false; lastPos.current = null; }

  function clear() {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    onClear();
  }

  function save() {
    const canvas = canvasRef.current!;
    const png = canvas.toDataURL("image/png");
    // Verifica se tem algo desenhado (mais que fundo branco)
    const ctx = canvas.getContext("2d")!;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const hasContent = data.some((v, i) => i % 4 !== 3 && v < 250);
    if (!hasContent) { toast.error("Desenhe sua assinatura antes de salvar"); return; }
    onSave(png);
    toast.success("Assinatura salva!");
  }

  return (
    <div className="space-y-3">
      <div className={`relative rounded-lg border-2 transition-colors ${saved ? "border-emerald-500 bg-emerald-50/30" : "border-dashed border-slate-300 bg-slate-50"}`}>
        {saved && (
          <div className="absolute top-2 right-2 flex items-center gap-1 text-emerald-600 text-xs font-semibold">
            <CheckCircle2 className="h-3.5 w-3.5" /> Salva
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={600}
          height={160}
          className="w-full touch-none cursor-crosshair"
          style={{ height: "160px" }}
          onMouseDown={start}  onMouseMove={move}  onMouseUp={end}   onMouseLeave={end}
          onTouchStart={start} onTouchMove={move}  onTouchEnd={end}
        />
        <p className="text-[10px] text-slate-400 text-center pb-2">
          Desenhe sua assinatura acima
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={clear} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" /> Limpar
        </Button>
        <Button type="button" size="sm" onClick={save} className="gap-1.5">
          <PenLine className="h-3.5 w-3.5" /> Salvar assinatura
        </Button>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function CadastroMedico() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [clinica, setClinica] = useState<string | null>(null);
  const [signaturePng, setSignaturePng] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm<FormData>({ resolver: zodResolver(schema) });

  // Valida o token de convite ao carregar.
  // Fase 3: passou a usar a RPC validar_convite (SECURITY DEFINER) em vez de um
  // SELECT anônimo na tabela — a policy antiga deixava a lista de convites
  // vivos enumerável por quem tivesse a anon key.
  useEffect(() => {
    if (!token) { setValidating(false); return; }
    (async () => {
      const { data, error } = await supabase.rpc("validar_convite", { p_token: token });
      const resultado = Array.isArray(data) ? data[0] : data;
      if (!error && resultado?.valido && resultado?.tipo === "medico") {
        setTokenValid(true);
        setClinica(resultado.tenant_nome ?? null);
      }
      setValidating(false);
    })();
  }, [token]);

  const onSubmit = async (values: FormData) => {
    if (!signaturePng) { toast.error("Você precisa desenhar e salvar sua assinatura"); return; }

    setLoading(true);
    try {
      // Tudo via servidor (supabaseAdmin) — evita rejeição de RLS no cliente
      const res = await fetch("/api/public/medico/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          fullName:      values.fullName,
          email:         values.email,
          password:      values.password,
          crm:           values.crm,
          especialidade: values.especialidade,
          signaturePng,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Erro ${res.status}`);

      setDone(true);
    } catch (e: any) {
      toast.error("Erro ao criar conta", { description: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  };

  if (validating) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!token || !tokenValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
        <div className="max-w-sm text-center space-y-4">
          <img src={imagoLogo} alt="Imago" className="h-12 mx-auto" />
          <h1 className="text-xl font-bold text-foreground">Link inválido ou expirado</h1>
          <p className="text-sm text-muted-foreground">
            Este link de convite não é válido ou já foi utilizado. Solicite um novo link ao administrador.
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
        <div className="max-w-sm text-center space-y-4">
          <img src={imagoLogo} alt="Imago" className="h-12 mx-auto" />
          <CheckCircle2 className="h-14 w-14 text-emerald-500 mx-auto" />
          <h1 className="text-xl font-bold text-foreground">Cadastro concluído!</h1>
          <p className="text-sm text-muted-foreground">
            Sua conta e assinatura foram configuradas. Você já pode entrar no sistema.
          </p>
          <Button onClick={() => navigate("/login")} className="w-full">
            Acessar o sistema
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg bg-card rounded-xl border border-border shadow-lg p-8 space-y-6">

        {/* Header */}
        <div className="text-center space-y-1">
          <img src={imagoLogo} alt="Imago" className="h-10 mx-auto mb-4" />
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Receituários</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Cadastro de Médico</h1>
          <p className="text-sm text-muted-foreground">
            {clinica
              ? <>Você foi convidado para <strong>{clinica}</strong>. Configure sua conta e assinatura digital.</>
              : "Configure sua conta e assinatura digital para os receituários."}
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

            {/* Dados pessoais */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="fullName" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Nome completo</FormLabel>
                  <FormControl><Input placeholder="Dr. João Silva" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="crm" render={({ field }) => (
                <FormItem>
                  <FormLabel>CRM</FormLabel>
                  <FormControl><Input placeholder="7608-PB" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="especialidade" render={({ field }) => (
                <FormItem>
                  <FormLabel>Especialidade</FormLabel>
                  <FormControl><Input placeholder="Anestesiologista" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" placeholder="seu@email.com" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel>Senha</FormLabel>
                  <FormControl><Input type="password" placeholder="Mínimo 6 caracteres" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Assinatura */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <PenLine className="h-4 w-4 text-primary shrink-0" />
                <p className="text-sm font-semibold text-foreground">Assinatura digital</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Desenhe sua assinatura abaixo. Ela será aplicada automaticamente em todos os campos de assinatura dos receituários atribuídos a você.
              </p>
              <AssinaturaCanvas
                saved={!!signaturePng}
                onSave={setSignaturePng}
                onClear={() => setSignaturePng(null)}
              />
            </div>

            <Button type="submit" disabled={loading || !signaturePng} className="w-full gap-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? "Criando conta…" : "Concluir cadastro"}
            </Button>

          </form>
        </Form>

      </div>
    </div>
  );
}
