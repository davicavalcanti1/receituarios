import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import medicoCadastroRoutes from "./routes/medico-cadastro.js";

const app = express();

// Assinatura vem como PNG base64 no body — o limit default (100kb) não basta.
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/public/medico", medicoCadastroRoutes);

// Em produção (container único) o Express também serve o build do Vite.
// Em dev quem serve o front é o Vite (:5173) com proxy /api pra cá.
if (process.env.NODE_ENV === "production") {
  const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist");
  app.use(express.static(distDir));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
    res.sendFile(path.join(distDir, "index.html"));
  });
}

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`[receituarios-api] http://localhost:${PORT}`);
});
