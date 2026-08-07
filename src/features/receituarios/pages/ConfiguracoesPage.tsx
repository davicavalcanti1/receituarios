// /configuracoes — área única de configuração (só admin)
//
// Antes a configuração dos receituários morava solta em /templates e a conexão
// do NetRis não tinha tela nenhuma (era variável de ambiente). As duas coisas
// ficam aqui, em abas:
//
//   Integração   — conexão com o NetRis (URL, token, filial)
//   Receituários — templates: medicações, assinatura, médico e o filtro de cada um

import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { PlugZap, ScrollText } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";
import { useAuth } from "@/shared/contexts/AuthContext";
import IntegracaoNetris from "./IntegracaoNetris";
import { ConfiguracaoReceituarios } from "./TemplatesPage";

const ABAS = [
  { id: "integracao",   label: "Integração",   icone: PlugZap },
  { id: "receituarios", label: "Receituários", icone: ScrollText },
] as const;
type AbaId = (typeof ABAS)[number]["id"];

export default function ConfiguracoesPage() {
  const { papel } = useAuth();
  // Aba na URL para o link poder apontar direto (?aba=receituarios).
  const [params, setParams] = useSearchParams();
  const inicial = (params.get("aba") as AbaId) ?? "integracao";
  const [aba, setAba] = useState<AbaId>(ABAS.some(a => a.id === inicial) ? inicial : "integracao");

  if (papel !== "admin") return <Navigate to="/receituarios" replace />;

  function trocar(id: AbaId) {
    setAba(id);
    setParams({ aba: id }, { replace: true });
  }

  return (
    <MainLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          eyebrow="Administração"
          title="Configurações"
          subtitle="Integração com o sistema da clínica e os receituários emitidos"
        />

        <div className="flex gap-1 border-b border-border">
          {ABAS.map(({ id, label, icone: Icone }) => (
            <button
              key={id}
              onClick={() => trocar(id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px",
                aba === id
                  ? "border-primary text-primary font-semibold"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icone className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        {aba === "integracao" ? <IntegracaoNetris /> : <ConfiguracaoReceituarios />}
      </div>
    </MainLayout>
  );
}
