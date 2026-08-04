// ─────────────────────────────────────────────────────────────────────────────
// PageHeader — cabeçalho canônico de página do design system
//
// Padrão: eyebrow uppercase tracking-widest em azul primário + título
// extrabold + subtítulo muted + slot de ações à direita. Toda página interna
// usa ESTE componente — não inventar headers locais.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";

interface PageHeaderProps {
  /** Categoria/contexto em caixa alta — ex: "Recepção", "Operacional" */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Botões/controles alinhados à direita */
  actions?: React.ReactNode;
}

export function PageHeader({ eyebrow, title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary mb-1">
            {eyebrow}
          </p>
        )}
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}
