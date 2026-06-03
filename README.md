# PriPriTrip

A Progressive Web App for tracking a single vacation trip as an expand/collapse timeline. A React + Vite frontend talks to a FastAPI backend backed by PostgreSQL. Trip data is stored relationally — a `trips` header table and a `trip_items` table — giving individual items their own lifecycle including soft deletes.

---

## Architecture

```
Browser (React + Vite PWA)
        │  HTTPS / JSON
        ▼
  FastAPI (Python)           ← Docker container / Azure Container Apps
        │  SQLAlchemy ORM
        ▼
  PostgreSQL                 ← Azure Database for PostgreSQL / local Docker
```

Terraform manages all Azure infrastructure. The frontend is deployed as an Azure Static Web App; the API runs as a containerised service.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Python | 3.11+ | API backend + tests |
| Node.js | 20+ | Frontend dev server + build |
| Docker / Docker Compose | latest | Local PostgreSQL + API container |
| Terraform | ≥ 1.9 | Infrastructure provisioning |
| Azure CLI | latest | Auth for Terraform + deployment |

---

## Local Development

### 1. Start the database

```bash
cd api
docker compose up db -d
```

This starts a Postgres 16 container on port `5432` with database `pripritrip`.

### 2. Run database migrations

```bash
cd api
pip install -r requirements.txt
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pripritrip \
  alembic upgrade head
```

### 3. Start the API

```bash
cd api
APP_PASSWORD=honeymoon \
TOKEN_SECRET=dev-secret-change-me \
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pripritrip \
  uvicorn main:app --reload --port 8000
```

The interactive docs are available at `http://localhost:8000/docs`.

### 4. Start the frontend

```bash
cd ui
npm install
npm run dev
```

The app opens at `http://localhost:5173`.

### Environment Variables

#### API

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | `postgresql://postgres:postgres@localhost:5432/pripritrip` | PostgreSQL connection string |
| `APP_PASSWORD` | Yes | `honeymoon` | Password for `POST /auth` |
| `TOKEN_SECRET` | Yes | `dev-secret-change-me` | HMAC-SHA256 salt for bearer tokens |
| `MAPS_API_KEY` | No | `` | Google Maps API key returned to the client on auth |

---

## API Reference

All endpoints except `/health` and `/auth` require a `Bearer` token obtained from `POST /auth`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Liveness check |
| `POST` | `/auth` | No | Exchange password for bearer token |
| `GET` | `/trip` | Yes | Get trip header + all active items (assembled view) |
| `POST` | `/trip` | Yes | Create or update the trip header |
| `GET` | `/trip/items` | Yes | List all active (non-deleted) trip items |
| `GET` | `/trip/items/deleted` | Yes | List soft-deleted items |
| `POST` | `/trip/items` | Yes | Create a new trip item |
| `PUT` | `/trip/items/{item_id}` | Yes | Full replace of a trip item |
| `PATCH` | `/trip/items/{item_id}` | Yes | Partial update of a trip item |
| `DELETE` | `/trip/items/{item_id}` | Yes | Soft-delete a trip item |
| `POST` | `/trip/items/{item_id}/restore` | Yes | Restore a soft-deleted item |

---

## Running Tests

### API

```bash
cd api
pip install -r requirements.txt pytest httpx
pytest tests/ -v
```

### Frontend

```bash
cd ui
npm run test
```

---

## Database Migrations

Migrations are managed with [Alembic](https://alembic.sqlalchemy.org/).

```bash
# Apply all pending migrations
alembic upgrade head

# Roll back one migration
alembic downgrade -1

# Generate a new migration (auto-detect from ORM models)
alembic revision --autogenerate -m "describe your change"
```

Run all Alembic commands from the `api/` directory.

---

## Deployment

Infrastructure is defined in `infrastructure/` using Terraform.

```bash
cd infrastructure
terraform init
terraform apply -var-file=env/prod.tfvars
```

Key resources provisioned:
- **Azure Static Web App** — hosts the React frontend
- **Azure Container Apps** — runs the FastAPI container
- **Azure Database for PostgreSQL Flexible Server** — managed Postgres

After infrastructure is up, push the API container image to the Azure Container Registry and trigger a new revision on the Container App. The Static Web App is deployed automatically via a GitHub Actions workflow on push to `main`.

| `environment` | Environment suffix (e.g. `prod`). |
| `location` | Azure region. Default: `centralus` |
| `app_password` | Deployed app password. Default: `honeymoon` — **change for production** |
| `token_secret` | Random secret for HMAC token signing |
| `maps_api_key` | Google Maps API key (optional) |

`prod.tfvars` is gitignored. A template is at `infrastructure/env/prod.tfvars`.

---

## Project Structure

```
PriPriTrip/
├── function/                  # Python Azure Functions backend
│   ├── function_app.py        # All HTTP trigger handlers
│   ├── host.json              # Functions v2 host config
│   ├── local.settings.json    # Local dev env vars (gitignored)
│   ├── requirements.txt       # Python dependencies
│   └── tests/
│       ├── conftest.py
│       ├── test_auth.py       # Auth handler + token helper tests
│       └── test_trip.py       # Blob read/write + trip handler tests
├── infrastructure/            # Terraform IaC
│   ├── main.tf                # Provider, remote state, resource group
│   ├── variables.tf
│   ├── outputs.tf
│   ├── storage.tf             # Storage account + blob containers
│   ├── function.tf            # App Service Plan + Function App + RBAC
│   ├── swa.tf                 # Static Web App
│   └── env/
│       └── prod.tfvars        # Environment values (gitignored)
├── ui/                        # React frontend (Phase 2+)
├── new_app.md                 # App design spec
├── trip_model_spec.md         # Trip JSON data model spec
└── README.md
```

---

## API

All endpoints are Azure Functions HTTP triggers. Base URL locally: `http://localhost:7071/api`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth` | No | Verify password, return session token + Maps API key |
| `GET` | `/api/trip` | Yes | Return trip JSON with SAS URLs resolved for documents |
| `PUT` | `/api/trip` | Yes | Overwrite trip JSON in blob storage |

**Auth flow:**
- `POST /api/auth` with `{ "password": "honeymoon" }` → returns `{ "token": "<hmac>", "mapsApiKey": "..." }`
- All subsequent requests: `Authorization: Bearer <token>`
- `POST /api/auth?logout=1` — client discards token (server is stateless, no revocation needed)

---

## Section 1 — Local Development (First-Time Setup)

Run the backend locally against Azurite. No Azure account needed.

### Step 1 — Install tools

```bash
# Azure Functions Core Tools v4
npm install -g azure-functions-core-tools@4 --unsafe-perm true

# Azurite (local blob emulator)
npm install -g azurite
```

### Step 2 — Create the Python virtual environment

```bash
cd function
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Step 3 — Start Azurite

Open a separate terminal and leave it running:

```bash
azurite --silent --skipApiVersionCheck
```

> The `--skipApiVersionCheck` flag is required when using a recent Azure CLI (2026+) against an older Azurite install. Alternatively, upgrade Azurite: `npm install -g azurite@latest`

### Step 4 — Create blob containers in Azurite

Run once. Azurite must be running first.

```bash
CONN="UseDevelopmentStorage=true"
az storage container create --name trip      --connection-string "$CONN"
az storage container create --name documents --connection-string "$CONN"
```

### Step 5 — Seed an initial `trip.json`

The function returns a 500 on `GET /api/trip` if no blob exists yet.

```bash
az storage blob upload \
  --container-name trip \
  --name trip.json \
  --file data/trip.json \
  --connection-string "UseDevelopmentStorage=true" \
  --overwrite
```

The sample trip (`data/trip.json`) is the Switzerland and Croatia Honeymoon fixture from `trip_model_spec.md`.

### Step 6 — Start the function

`local.settings.json` is already configured for Azurite with default dev secrets. No changes needed to run locally.

```bash
# from the function/ directory, with .venv active
func start
```

Function is available at `http://localhost:7071/api`.

### Step 7 — Smoke test the running function

```bash
# 1. Auth — get a token
curl -s -X POST http://localhost:7071/api/auth \
  -H "Content-Type: application/json" \
  -d '{"password":"honeymoon"}' | jq .

# Copy the token value from the response, then:

TOKEN="<paste token here>"

# 2. Read trip
curl -s http://localhost:7071/api/trip \
  -H "Authorization: Bearer $TOKEN" | jq .

# 3. Write trip (round-trip the same document)
curl -s -X PUT http://localhost:7071/api/trip \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @<path-to-your-trip.json>
```

---

## Running the UI Locally (Phase 4+)

The UI dev server and the function must run simultaneously. Vite proxies all `/api` requests to the function — no environment variables are needed for local dev.

### Step 1 — Install UI dependencies (first time only)

```bash
cd ui
npm ci
```

### Step 2 — Start both servers

Terminal 1 — function backend (Azurite must already be running per Section 1):

```bash
cd function
source .venv/bin/activate
func start
```

Terminal 2 — Vite dev server:

```bash
cd ui
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Log in with the password from `local.settings.json` (default: `honeymoon`). The trip is loaded live from Azurite on every page load. The **Save** button in the app bar writes the current trip JSON back to blob storage.

> **Note — PWA / service worker in dev:** The service worker is only active in production builds (`npm run build && npm run preview`). In `npm run dev` mode the app still uses IndexedDB for offline caching, but the service worker precaching of the app shell is not active. To test the full PWA install flow locally, run `npm run build && npm run preview`.

---

## Section 2 — Running Tests

No live Azure or Azurite connection required — all tests use mocks.

```bash
cd function
source .venv/bin/activate   # if not already active
pytest tests/ -v
```

Expected output: **31 passed**.

---

## Section 3 — Deployment

### Prerequisites

- Azure CLI installed and logged in: `az login`
- Terraform >= 1.9 installed
- The shared Terraform state backend already exists (see note below)

### 3a — One-time Azure setup (manual, do once)

These resources are not managed by Terraform and must exist before `terraform init` will work.

**Terraform remote state backend** (shared with PriPriNote — skip if it already exists):

```bash
# Only run this if the terraform-infrastructure resource group does not exist yet
az group create --name terraform-infrastructure --location centralus
az storage account create \
  --name priprinotetfstate \
  --resource-group terraform-infrastructure \
  --sku Standard_LRS \
  --allow-blob-public-access false
az storage container create \
  --name tfstate \
  --account-name priprinotetfstate \
  --auth-mode login
```

### 3b — Configure Terraform variables

Copy the template and fill in real values:

```bash
cp infrastructure/env/prod.tfvars infrastructure/env/prod.tfvars.local
# Edit prod.tfvars.local — never commit this file
```

Required values to fill in:

| Variable | Where to get it |
|----------|----------------|
| `subscription_id` | `az account show --query id -o tsv` |
| `token_secret` | Generate: `openssl rand -hex 32` |
| `maps_api_key` | Google Cloud Console → Maps JavaScript API |
| `app_password` | Choose a strong password (replaces `honeymoon` in prod) |

### 3c — Provision infrastructure with Terraform

```bash
cd infrastructure

# Authenticate Terraform to Azure
az login
az account set --subscription "<your-subscription-id>"

# Init (downloads provider, connects to remote state)
terraform init

# Preview changes
terraform plan -var-file=env/prod.tfvars

# Apply
terraform apply -var-file=env/prod.tfvars
```

Note the outputs — you'll need them for deployment:

```bash
terraform output function_app_url   # → VITE_API_URL for the frontend
terraform output swa_url            # → live frontend URL
terraform output storage_account_name
```

### 3d — Deploy the function

The function app is deployed by pushing code to `main` (the `deploy-function.yml` workflow handles it automatically). To deploy manually from your local machine:

```bash
# Ensure you are logged in to Azure CLI
az login
az account set --subscription "<your-subscription-id>"

cd function
source .venv/bin/activate

# Deploy — Kudu/Oryx on Azure installs dependencies during deployment
func azure functionapp publish func-pripritrip-prod
```

> The `SCM_DO_BUILD_DURING_DEPLOYMENT=true` app setting (set by Terraform) tells Azure to run `pip install` on the server side, so the local `--target .python_packages/...` step is not required when using `func azure functionapp publish`.

After the command completes, verify by hitting the auth endpoint:

```bash
curl -s -X POST https://func-pripritrip-prod.azurewebsites.net/api/auth \
  -H "Content-Type: application/json" \
  -d '{"password":"<your-app-password>"}' | jq .
```

### 3e — Deploy the frontend (Phase 2+)

```bash
# Get the SWA deployment token from Azure
SWA_TOKEN=$(az staticwebapp secrets list \
  --name swa-pripritrip-prod \
  --resource-group rsg-pripritrip-prod \
  --query "properties.apiKey" -o tsv)

cd ui
npm ci
VITE_API_URL=$(cd ../infrastructure && terraform output -raw function_app_url) npm run build
npx @azure/static-web-apps-cli deploy dist --deployment-token "$SWA_TOKEN"
```

### 3f — Post-deploy: seed `trip.json` in production

The storage containers are created by Terraform but the initial blob must be uploaded manually:

```bash
az storage blob upload \
  --account-name stpripritripprod \
  --container-name trip \
  --name trip.json \
  --file <your-trip.json> \
  --auth-mode login
```

### 3g — Smoke test the deployed function

```bash
FUNC_URL="https://func-pripritrip-prod.azurewebsites.net/api"

# Auth
curl -s -X POST "$FUNC_URL/auth" \
  -H "Content-Type: application/json" \
  -d '{"password":"<your-app-password>"}' | jq .

TOKEN="<paste token>"

# Read trip
curl -s "$FUNC_URL/trip" \
  -H "Authorization: Bearer $TOKEN" | jq 'keys'
```

---

## Infrastructure Reference

### What Terraform manages

| Resource | Name |
|----------|------|
| Resource Group | `rsg-pripritrip-prod` |
| Storage Account | `stpripritripprod` |
| Blob Container — trip data | `trip` |
| Blob Container — documents | `documents` |
| App Service Plan (Consumption) | `asp-pripritrip-prod` |
| Function App (Linux, Python 3.11) | `func-pripritrip-prod` |
| Static Web App (Free tier) | `swa-pripritrip-prod` |
| RBAC — Storage Blob Data Contributor | function managed identity → storage |
| RBAC — Storage Blob Delegator | function managed identity → storage |

### What is NOT managed by Terraform

| Item | How to manage |
|------|---------------|
| Terraform remote state backend | Manual `az` commands (Section 3a above) |
| Initial `trip.json` blob | Manual upload (Section 3f above) |
| Document files in `documents` container | Upload manually via Azure Portal or `az storage blob upload` |
| GitHub Actions secrets | Set in repo Settings → Secrets and variables → Actions (see Section 4 below) |

---

## Section 4 — CI/CD (GitHub Actions)

Two workflows live in `.github/workflows/`.

| Workflow | File | Trigger |
|----------|------|---------|
| Deploy Static Web App | `deploy-swa.yml` | Push to `main` touching `ui/**`, or manually |
| Upload trip.json | `upload-trip-json.yml` | Push to `main` touching `data/trip.json`, or manually |

### Required secrets

Set these in **repo Settings → Secrets and variables → Actions**.

| Secret | Used by | How to get it |
|--------|---------|---------------|
| `SWA_DEPLOYMENT_TOKEN` | `deploy-swa.yml` | `az staticwebapp secrets list --name swa-pripritrip-prod --resource-group rsg-pripritrip-prod --query "properties.apiKey" -o tsv` |
| `VITE_API_URL` | `deploy-swa.yml` | `https://func-pripritrip-prod.azurewebsites.net/api` (or `terraform output -raw function_app_url`) |
| `AZURE_CLIENT_ID` | `upload-trip-json.yml` | Client ID of the Entra app registration used for federated OIDC |
| `AZURE_TENANT_ID` | `upload-trip-json.yml` | `az account show --query tenantId -o tsv` |
| `AZURE_SUBSCRIPTION_ID` | `upload-trip-json.yml` | `az account show --query id -o tsv` |
| `AZURE_STORAGE_ACCOUNT_NAME` | `upload-trip-json.yml` | `stpripritripprod` (or `terraform output -raw storage_account_name`) |

### RBAC — grant the OIDC identity access to blob storage

The federated app registration needs Storage Blob Data Contributor on the storage account so `upload-trip-json.yml` can write blobs without a connection string.

```bash
# Get the service principal object ID for the app registration
OBJECT_ID=$(az ad sp show --id "<AZURE_CLIENT_ID>" --query id -o tsv)

STORAGE_ID=$(az storage account show \
  --name stpripritripprod \
  --resource-group rsg-pripritrip-prod \
  --query id -o tsv)

az role assignment create \
  --assignee-object-id "$OBJECT_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Contributor" \
  --scope "$STORAGE_ID"
```

### Adding this repository to the federated Entra app

GitHub OIDC works by GitHub minting a short-lived JWT for the running workflow and Azure validating it against a federated credential record on the app registration. You need one credential record per repo + entity (branch, environment, tag, or PR).

**Steps in the Azure Portal:**

1. Open **Microsoft Entra ID** → **App registrations** → find and click the existing shared app.
2. In the left nav click **Certificates & secrets**, then the **Federated credentials** tab.
3. Click **+ Add credential**.
4. Under *Federated credential scenario* select **GitHub Actions deploying Azure resources**.
5. Fill in the fields:

   | Field | Value |
   |-------|-------|
   | Organization | Your GitHub org or username (e.g. `juliangregg`) |
   | Repository | `PriPriTrip` |
   | Entity type | `Branch` |
   | GitHub branch name | `main` |
   | Name | Any unique label, e.g. `PriPriTrip-main` |

6. Click **Add**.

The credential is active immediately — no restart needed. If you want `workflow_dispatch` runs from non-`main` branches to also authenticate, add a second credential for that branch, or switch the entity type to **Environment** and use GitHub Environments for tighter control.

> **Why one record per repo?** The OIDC subject claim includes the repository name (`repo:org/PriPriTrip:ref:refs/heads/main`). Azure rejects tokens whose subject doesn't match any credential on the app registration, so each repo needs its own entry even when sharing the same app registration.

---

## Build Phases

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Function backend (auth, trip read/write, blob, tests) | ✅ Done |
| 2 | UI POC — Vite + React + MUI timeline with fixture data | ✅ Done |
| 3 | Auth integration — LoginPage, Axios interceptor, 401 redirect | ✅ Done |
| 4 | Read/write from blob — wire API calls, Save button | ✅ Done |
| 5 | PWA / offline support — service worker, IndexedDB cache | ✅ Done |
| 6 | Input forms — GroupForm, LegForm | ✅ Done |
| 7 | Documents page — SAS URL links | Not started |
| 8 | Maps — native Google Maps deep-links from location rows | ✅ Done |
