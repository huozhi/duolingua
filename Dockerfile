# Was das? — German translator, self-contained.
#
# The image ships both halves: the compiled dictionary (~10MB, committed to the
# repo) and the three OPUS-MT models (~330MB, downloaded during the build). The
# result translates with no outbound network at all — `docker run --network none`
# is a supported way to use it, and the verification step for this file.
#
# Debian rather than Alpine: onnxruntime-node's native binding links against
# glibc.

# ── deps ──────────────────────────────────────────────────────────────────────
FROM node:24-slim AS deps
WORKDIR /app

RUN npm install --global pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# pnpm-workspace.yaml allows onnxruntime-node's install script, which downloads
# the native ONNX Runtime libraries. Without it the server falls back to
# WebAssembly at best, and fails outright at worst.
RUN pnpm install --frozen-lockfile

# ── build ─────────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app

COPY . .
# Produces .next/standalone, including the traced native ONNX libraries for this
# platform (see outputFileTracingIncludes in next.config.ts).
RUN pnpm build

# ── models ────────────────────────────────────────────────────────────────────
# Separate stage so that changing application code does not re-download 330MB.
FROM deps AS models
WORKDIR /app

COPY package.json ./
COPY scripts ./scripts
COPY src ./src
ENV MODEL_CACHE_DIR=/models
RUN node scripts/fetch-models.ts

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    MODEL_CACHE_DIR=/models \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The standalone bundle carries its own pruned node_modules, but `.next/static`
# must be copied explicitly — standalone does not include it.
#
# `data/dict` is read from disk by /api/analyze and by the single-word lookup in
# translation. It is not web-served, so it lives outside `public/` (which no longer
# exists) and Next's file tracing has no reason to find it.
#
# Ownership is set during the copy rather than with a later `chown -R`: that would
# rewrite every file into a second layer and near-double the image.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/data/dict ./data/dict
COPY --from=models --chown=node:node /models /models

# Nothing here needs to write outside /tmp.
USER node

EXPOSE 3000

# Cheap by design — reports readiness without loading a model.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
