// Configuração de runtime, vinda de GET /api/config.
//
// Fase 5: quais integrações estão ligadas é decisão de AMBIENTE, não de build.
// Antes, saber do NetRis dependia de VITE_* embutida no bundle — ligar ou
// desligar exigia rebuildar a imagem. Agora é env var + restart do server.

import { useEffect, useState } from "react";

export interface AppConfig {
  integracoes: { netris: boolean };
}

// Sem integração nenhuma: é o comportamento seguro se /api/config falhar — o
// núcleo (importação manual) funciona, só as integrações somem.
const PADRAO: AppConfig = { integracoes: { netris: false } };

let cache: Promise<AppConfig> | null = null;

export function carregarConfig(): Promise<AppConfig> {
  if (!cache) {
    cache = fetch("/api/config")
      .then(r => (r.ok ? r.json() : PADRAO))
      .then((c: AppConfig) => ({ integracoes: { ...PADRAO.integracoes, ...c?.integracoes } }))
      .catch(() => PADRAO);
  }
  return cache;
}

export function useConfig(): { config: AppConfig; carregando: boolean } {
  const [config, setConfig] = useState<AppConfig>(PADRAO);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    carregarConfig().then(c => {
      if (!vivo) return;
      setConfig(c);
      setCarregando(false);
    });
    return () => { vivo = false; };
  }, []);

  return { config, carregando };
}
