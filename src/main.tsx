import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/shared/contexts/AuthContext";
import Login from "@/pages/Login";
import CadastroMedico from "@/pages/CadastroMedico";
import SemAcesso from "@/pages/SemAcesso";
import ReceituariosPage from "@/features/receituarios/pages/ReceituariosPage";
import NovoLoteReceituario from "@/features/receituarios/pages/NovoLoteReceituario";
import MedicoPortalPage from "@/features/receituarios/pages/MedicoPortalPage";
import TemplatesPage from "@/features/receituarios/pages/TemplatesPage";
import "./index.css";

const queryClient = new QueryClient();

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, papel, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  // Estar autenticado não basta: o auth.users é compartilhado com o sistema da
  // Imago, então é preciso ter vínculo com ESTE módulo (staff ou médico).
  if (!papel) return <SemAcesso />;
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/cadastro/medico" element={<CadastroMedico />} />
            <Route path="/receituarios" element={<RequireAuth><ReceituariosPage /></RequireAuth>} />
            <Route path="/receituarios/novo" element={<RequireAuth><NovoLoteReceituario /></RequireAuth>} />
            <Route path="/receituarios/medico" element={<RequireAuth><MedicoPortalPage /></RequireAuth>} />
            <Route path="/templates" element={<RequireAuth><TemplatesPage /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/receituarios" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
