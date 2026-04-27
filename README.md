# PriPriTrip

A Progressive Web App for tracking a single vacation trip as an expand/collapse timeline. Built with React + Vite on the frontend and a Python Azure Functions backend. All trip data lives in a single JSON blob in Azure Blob Storage — no database required.

---

## Prerequisites

### Tools

| Tool | Version | Purpose |
|------|---------|---------|
| Python | 3.11+ | Function backend + tests |
| Node.js | 20+ | Frontend (Phase 2+) |
| Azure Functions Core Tools | v4 | Local function host (`func start`) |
| Azurite | latest | Local Azure Blob Storage emulator |
| Terraform | >= 1.9 | Infrastructure provisioning |
| Azure CLI | latest | Auth for Terraform + deployment |

Install Azurite globally or run it via Docker:
```bash
# npm
npm install -g azurite

# Docker
docker run -p 10000:10000 mcr.microsoft.com/azure-storage/azurite
```

### Environment Variables

#### Function (local dev) — `function/local.settings.json`

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_PASSWORD` | Yes | Password checked on `POST /api/auth`. Default: `honeymoon` |
| `TOKEN_SECRET` | Yes | HMAC-SHA256 salt for session tokens. Use any random string locally. |
| `MAPS_API_KEY` | No | Google Maps API key. Returned to client on auth. Empty string disables maps. |
| `AZURE_STORAGE_CONNECTION_STRING` | Yes (local) | Set to `UseDevelopmentStorage=true` for Azurite |
| `STORAGE_ACCOUNT` | Yes (prod) | Azure Storage account name. Not needed when using a connection string. |
| `STORAGE_TRIP_CONTAINER` | No | Blob container name for trip data. Default: `trip` |
| `STORAGE_DOCS_CONTAINER` | No | Blob container name for documents. Default: `documents` |

`local.settings.json` is gitignored. A template is checked in at `function/local.settings.json` with safe defaults for Azurite — **do not commit real secrets**.

#### Infrastructure (Terraform) — `infrastructure/env/prod.tfvars`

| Variable | Description |
|----------|-------------|
| `subscription_id` | Azure subscription ID |
| `app_name` | Resource naming prefix. Default: `pripritrip` |
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

```bash
cd function
pip install -r requirements.txt --target .python_packages/lib/site-packages
func azure functionapp publish func-pripritrip-prod
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
| GitHub Actions secrets | Set in repo Settings → Secrets: `AZURE_STATIC_WEB_APPS_API_TOKEN`, `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` |

---

## Build Phases

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Function backend (auth, trip read/write, blob, tests) | ✅ Done |
| 2 | UI POC — Vite + React + MUI timeline with fixture data | ✅ Done |
| 3 | Auth integration — LoginPage, Axios interceptor, 401 redirect | ✅ Done |
| 4 | Read/write from blob — wire API calls, Save button | ✅ Done |
| 5 | PWA / offline support — service worker, IndexedDB cache | ✅ Done |
| 6 | Input forms — GroupForm, LegForm | Not started |
| 7 | Documents page — SAS URL links | Not started |
| 8 | Maps — Google Maps embed, location pins | Not started |
