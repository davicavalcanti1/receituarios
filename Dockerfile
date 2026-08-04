# ── Build do frontend ────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Vite precisa das VITE_* em build time — configurar como Build Args no EasyPanel
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_NETRIS_FILIAL_ID=1
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_NETRIS_FILIAL_ID=$VITE_NETRIS_FILIAL_ID

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild esbuild @swc/core
COPY . .
RUN npm run build

# ── Runtime: Express serve a API e o dist ────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY server/package.json server/package-lock.json ./server/
# npm rebuild esbuild: o --ignore-scripts pula o postinstall que valida o
# binário nativo que o tsx usa em runtime
RUN cd server && npm ci --ignore-scripts && npm rebuild esbuild
COPY server ./server
COPY --from=build /app/dist ./dist

# Env de runtime (configurar no EasyPanel): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
EXPOSE 3001
# WORKDIR no server: o Node resolve --import tsx/esm a partir do cwd, e o tsx
# vive em /app/server/node_modules (em /app não há node_modules)
WORKDIR /app/server
CMD ["node", "--import", "tsx/esm", "src/index.ts"]
