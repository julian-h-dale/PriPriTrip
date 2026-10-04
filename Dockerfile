# ==============================================================================
# Unified single-container image: React UI + FastAPI API behind one nginx.
#
# Stage 1 compiles the UI with Node and is thrown away. The final image carries
# only the Python runtime, the compiled static assets, and nginx as the single
# ingress on :8080. See deploy/README.md for the deployment workflow.
# ==============================================================================

# ------------------------------------------------------------------------------
# STAGE 1: Frontend build
# ------------------------------------------------------------------------------
FROM node:lts-alpine AS frontend-builder
WORKDIR /app/ui

# Install deps first to maximise layer caching.
COPY ui/package*.json ./
RUN npm ci

COPY ui/ ./
RUN npm run build

# ------------------------------------------------------------------------------
# STAGE 2: Runtime (Python + nginx)
# ------------------------------------------------------------------------------
FROM python:3.12-bookworm
WORKDIR /app

# nginx as the single reverse proxy / static file server.
RUN apt-get update && apt-get install -y --no-install-recommends nginx \
    && rm -rf /var/lib/apt/lists/*

# Python deps (cached unless requirements change).
COPY api/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# API source, and its Alembic migrations (deploy/start.sh runs them).
COPY api/app ./app
COPY api/alembic.ini ./alembic.ini
COPY api/migrations ./migrations

# Compiled UI assets from stage 1.
COPY --from=frontend-builder /app/ui/dist /var/www/html
# Point the SPA at the same-origin /api base (overwrites the dev default).
COPY deploy/runtime-config.js /var/www/html/runtime-config.js

# nginx config + process entrypoint.
COPY deploy/nginx.conf /etc/nginx/sites-available/default
COPY deploy/start.sh ./start.sh
RUN chmod +x ./start.sh

# Single public ingress port.
EXPOSE 8080
CMD ["./start.sh"]
