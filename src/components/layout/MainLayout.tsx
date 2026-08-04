// Shell próprio do produto — substitui o MainLayout do sistema de origem
// (que arrastava Sidebar/TopNav/BottomNav do Imago). Mantém a MESMA interface
// de props, então as páginas copiadas não precisaram mudar.

import React from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, ScrollText } from "lucide-react";
import { PageHeader } from "./PageHeader";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/shared/contexts/AuthContext";

interface MainLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  headerActions?: React.ReactNode;
}

export function MainLayout({ children, title, subtitle, eyebrow, headerActions }: MainLayoutProps) {
  const { profile, signOut, user } = useAuth();
  const navigate = useNavigate();

  const content = title ? (
    <div className="space-y-6">
      <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} actions={headerActions} />
      {children}
    </div>
  ) : (
    children
  );

  return (
    <div className="min-h-screen bg-background font-sans antialiased flex flex-col">
      <header className="h-14 shrink-0 border-b border-border bg-card flex items-center justify-between px-4 md:px-8">
        <button
          onClick={() => navigate("/receituarios")}
          className="flex items-center gap-2 font-extrabold text-foreground tracking-tight"
        >
          <span className="h-8 w-8 rounded-lg bg-primary text-primary-foreground grid place-items-center">
            <ScrollText className="h-4 w-4" />
          </span>
          Receituários
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground hidden sm:block">
            {profile?.full_name ?? user?.email}
          </span>
          <Button variant="ghost" size="sm" onClick={signOut} className="gap-1.5 text-muted-foreground">
            <LogOut className="h-4 w-4" /> Sair
          </Button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto px-4 py-6 md:px-10 md:py-8">
        <div className="mx-auto max-w-6xl">{content}</div>
      </main>
    </div>
  );
}
