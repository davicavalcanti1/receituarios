import express from "express";
import medicoCadastroRoutes from "./routes/medico-cadastro.js";

const app = express();

// Assinatura vem como PNG base64 no body — o limit default (100kb) não basta.
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/public/medico", medicoCadastroRoutes);

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`[receituarios-api] http://localhost:${PORT}`);
});
