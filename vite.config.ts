import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Backend Express (cadastro do médico; futuramente proxy NetRis)
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
