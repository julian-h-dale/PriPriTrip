# PriPriTrip

PriPriTrip is a trip-planning application with a React + Vite frontend and a FastAPI backend backed by PostgreSQL.

## Architecture

```text
UI (React + Vite PWA)
        |
        | HTTP/JSON
        v
API (FastAPI + SQLAlchemy async)
        |
        | SQL
        v
PostgreSQL 16
```

## Repository Layout

```text
PriPriTrip/
├── api/                 # FastAPI backend
├── ui/                  # React frontend
├── infrastructure/      # Terraform
├── data/                # Fixtures and helper scripts
├── docs/                # Project docs/assets
└── README.md
```

## Prerequisites

| Tool | Version |
|---|---|
| Python | 3.12+ |
| Node.js | 20+ |
| Docker / Docker Compose | recent |

## Quickstart (Full Stack)

### 1. Start backend

```bash
cd api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
./dev.sh --clean
```

Backend URLs:
- API: http://localhost:8000
- Swagger: http://localhost:8000/docs

### 2. Start frontend

```bash
cd ui
npm install
npm run dev
```

Frontend URL:
- http://localhost:5173

## Authentication

The backend uses JWT bearer auth via fastapi-users.

For local development, `./dev.sh --clean` seeds a superuser:
- email: julian.h.dale@gmail.com
- password: honeymoon

## AI Workflows

PriPriTrip includes AI-assisted chat and import flows:
- New trip staged workflow (welcome -> travel -> stay)
- Action-oriented trip CRUD chat workflow
- AI itinerary/document extraction and enrichment endpoints

Prompt configuration is centralized in:
- `api/pripritrip_system_prompt.md`

Prompt composition/parsing is implemented in:
- `api/app/services/prompt_composer.py`

## AI Trace Logging

Structured AI traces are written to:
- `api/ai.log`

Example:

```bash
cd api
tail -f ai.log
```

Note: the command is `tail`, not `tails`.

## Tests

### Backend

```bash
cd api
source .venv/bin/activate
pytest -q
```

### Frontend

```bash
cd ui
npm run build
```

## Documentation

Service-specific details are in:
- `api/README.md` for backend endpoints, env vars, AI logging, and prompt system

## Deployment

Infrastructure is managed with Terraform in `infrastructure/`.

```bash
cd infrastructure
terraform init
terraform plan
terraform apply
```

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
