# Travel Application (PriPriTrip)

## Backgrounnd

PriPriTrip is an app that makes keeping track of vacation plans easy.  It provides you with step by step details of your trip.  The data is presented to the user as an expand/collapse timeline view.  A Trip is represented as a set of groups and individual legs.  These are defined by the type and subtypes below. 

Goals:
- We are going to make this a Progressive web application.  
  - UI is mobile optimized. 
  - You should be able to download the trip and keep it cache locally (so you don't need internet for it to be useful).  Some feature might not work perfectly with out internet but the data should still be available.
  - Allow the user to sync to the data.

Anti-goals:
- For now we are only going to do one trip.  We don't have to worry about making the app handle multiple.  
- Don't make a sign up.  The entire app will be controlled with a simple password. Once user unlocks the app they are free to use it.  Password is going to be "honeymoon" 

## Tech Stack

### Frontend
- **React 18** — functional components and hooks
- **Vite** — build tool and dev server
- **MUI v6** — component library and theming
- **React Router DOM v6** — client-side routing
- **Redux Toolkit + React Redux** — state management
- **Axios** — HTTP client
- **Day.js** — date/time formatting
- **vite-plugin-pwa** — service worker and PWA manifest for offline/PWA support
- **Vitest + Testing Library** — unit testing
- **ESLint** — linting

### Backend (Serverless Function)
- **Python** — function language
- **Azure Functions (HTTP trigger)** — single function app, replaces ACA/FastAPI
- **Pydantic** — light JSON body validation
- **azure-storage-blob** SDK — read/write trip JSON; generate SAS URLs for documents
- **No JWT, no database, no Docker** — password is verified directly against a secret; token is a short-lived signed value (HMAC) or simply the raw password echoed back as a bearer token

### Auth
- Client POSTs `{ "password": "honeymoon" }` to `/auth`
- Function compares against `APP_PASSWORD` environment variable (set in Function App config, or hardcoded as a fallback)
- On success returns a session token (simple HMAC-SHA256 of password + a salt also in env/config) and any frontend secrets (Maps API key)
- No user accounts, no sign-up, no OAuth, no Key Vault

### Storage
- **`trip` blob container** — single blob `trip.json`; function reads and overwrites it on save
- **`documents` blob container** — read-only from the app; files uploaded manually to blob storage; function generates short-lived SAS URLs on demand so the UI can link to them
- Document `url` fields in the trip JSON are _not_ pre-signed; the function resolves them to SAS URLs when serving the trip document (or the UI requests them separately)

### Infrastructure (Terraform, mirrors PriPriNote `/infrastructure/application`)
- **Azure Static Web Apps (SWA)** — frontend hosting (Free tier)
- **Azure Functions** — serverless backend (Consumption plan, Python)
- **Azure Blob Storage** — trip data and documents
- **Terraform** — IaC
- Secrets (`APP_PASSWORD`, `TOKEN_SECRET`, `MAPS_API_KEY`) stored as Azure Function App environment variables; can be hardcoded during development

## Implementation Plan 

Follow infrastructure pattern from the `/application` folder in PriPriNote.

Find details on the data model here: ./trip_model_spec.md

Design principles:
- Fully encapsulated — auth, storage, and secrets handled server-side in the function
- Secrets needed by the frontend (Maps API key) returned on successful auth; never bundled in the frontend build
- Single Azure Function app — no microservices
- Server side is thin: read/write one JSON document with light Pydantic validation
- Documents are read-only from the app — files are managed manually in blob storage

### Endpoints (Azure Functions HTTP triggers)

| Method | Path | Auth required | Description |
|--------|------|---------------|-------------|
| POST | `/api/auth` | No | Check password, return session token + frontend secrets |
| GET | `/api/trip` | Yes | Return trip JSON document |
| PUT | `/api/trip` | Yes | Overwrite trip JSON document with request body |

- `POST /api/auth?logout=1` — client discards token (server is stateless; no server-side revocation needed)
- Auth token passed as `Authorization: Bearer <token>` header
- All endpoints return `application/json`

### Storage layout

- **`trip` container**: `trip.json` — the single trip document; overwritten on every save
- **`documents` container**: arbitrary files uploaded manually; function generates SAS URLs on GET /api/trip so the UI can display/link them directly

### UI Components

- `LoginPage` — password form; on success stores token in localStorage
- `HomePage` — root shell after login
  - `Timeline` — full trip timeline
    - `GroupCard` — collapsible group header (city / day grouping)
    - `LegCard` — individual itinerary item (flight, hotel, activity, etc.)
- `DocumentsPage` — read-only list of trip-level document links (SAS URLs)
- Forms (gated behind edit mode)
  - `GroupForm` — add/edit a group item
  - `LegForm` — add/edit a leg item

### Build phases

#### Phase 1 — Function backend
- Azure Function app with `/api/auth`, `GET /api/trip`, `PUT /api/trip`
- Blob storage containers (`trip`, `documents`)
- Local dev: Azurite emulator for blob, `local.settings.json` for secrets
- Unit tests for auth check, blob read/write, SAS URL generation

#### Phase 2 — UI POC (timeline view)
- Vite + React scaffold, MUI theme
- Hard-coded trip JSON fixture for development
- `Timeline` → `GroupCard` → `LegCard` expand/collapse
- Mobile-first layout

#### Phase 3 — Auth integration
- `LoginPage` + token stored in localStorage
- Axios interceptor attaches `Authorization` header
- Redirect to login on 401

#### Phase 4 — Read/write from blob
- Wire `GET /api/trip` on app load
- Discrete "Save" button → `PUT /api/trip`
- Optimistic local state; show sync status indicator

#### Phase 5 — PWA / offline support
- `vite-plugin-pwa` service worker
- Cache trip JSON in IndexedDB (e.g. via Workbox) so timeline works without network
- "Save" button disabled / queued when offline

#### Phase 6 — Input forms
- `GroupForm` and `LegForm` (add + edit)
- UI affordances to open forms from timeline (FAB or inline button)

#### Phase 7 — Documents page
- `DocumentsPage` rendering trip-level documents as links/cards
- SAS URLs resolved server-side on GET /api/trip

#### Phase 8 — Maps
- Google Maps embedded view (API key returned from `/api/auth`)
- Pins for locations on `leg` items

### Infrastructure

All infrastructure is managed with Terraform and deployed to **Azure**. There is no Key Vault — secrets are plain application settings on the Function App. The stack is intentionally minimal: a static frontend, a serverless Python backend, and a storage account.

#### Azure Resources

| Resource | Type | Purpose |
|----------|------|---------|
| Resource Group | `azurerm_resource_group` | Container for all app resources |
| Static Web App | `azurerm_static_web_app` | Hosts the React SPA (Free tier) |
| Storage Account | `azurerm_storage_account` | Holds blob containers for trip data and documents |
| Blob Container — `trip` | `azurerm_storage_container` | Stores `trip.json` (single blob, private access) |
| Blob Container — `documents` | `azurerm_storage_container` | Stores document files uploaded manually (private access) |
| App Service Plan | `azurerm_service_plan` | Consumption (serverless) plan for the Function App |
| Function App | `azurerm_linux_function_app` | Runs the Python HTTP trigger functions |

#### Terraform layout

```
infrastructure/
  main.tf           # Provider config, backend (azurerm remote state), resource group
  variables.tf      # subscription_id, app_name, environment, location, app_password, token_secret, maps_api_key, tags
  outputs.tf        # swa_url, function_app_url, storage_account_name
  storage.tf        # Storage account + trip + documents blob containers
  function.tf       # App Service Plan (Consumption) + Linux Function App + app_settings
  swa.tf            # Static Web App (Free tier)
  env/
    prod.tfvars     # Environment-specific variable values (gitignored for secrets)
```

#### Terraform backend

Remote state stored in Azure Blob Storage (bootstrap separately or use a local backend for early dev):

```hcl
terraform {
  backend "azurerm" {
    resource_group_name  = "terraform-infrastructure"
    storage_account_name = "<your-tf-state-storage-account>"
    container_name       = "tfstate"
    key                  = "priPriTrip.tfstate"
  }
}
```

#### Naming convention

Follow the pattern `<type>-<app_name>-<environment>`, e.g.:
- `rsg-pripritrip-prod`
- `swa-pripritrip-prod`
- `st<appname><env>` (storage accounts — no hyphens, max 24 chars)
- `func-pripritrip-prod`
- `asp-pripritrip-prod`

#### Function App configuration

The Function App is a **Linux Consumption plan** running **Python 3.11**.

Key `app_settings` passed via Terraform:
```
APP_PASSWORD       = "honeymoon"           # checked on POST /api/auth
TOKEN_SECRET       = "<random string>"     # HMAC salt for session token
MAPS_API_KEY       = "<google maps key>"   # returned to client on auth success
STORAGE_ACCOUNT    = "<storage account name>"
STORAGE_TRIP_CONTAINER    = "trip"
STORAGE_DOCS_CONTAINER    = "documents"
```

The Function App's managed identity (system-assigned) is granted **Storage Blob Data Contributor** on the storage account so the function can read/write blobs without connection strings.

Alternatively during development, `AZURE_STORAGE_CONNECTION_STRING` can be set directly as an app setting (or use Azurite locally).

#### CORS

The Function App must allow the SWA origin. Set `cors` block in `azurerm_linux_function_app`:
```hcl
cors {
  allowed_origins = ["https://<swa-default-host>.azurestaticapps.net"]
}
```
During development, add `http://localhost:3000` to the allowed origins.

#### Static Web App routing

The SWA needs a `staticwebapp.config.json` in the `public/` folder to route all paths to `index.html` for the React SPA:
```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/assets/*"]
  }
}
```

The SWA API proxy feature is **not** used — the frontend calls the Function App URL directly.

#### Local development

- **Frontend**: `npm run dev` in `ui/` — Vite dev server on port 3000; `VITE_API_URL` in `.env.local` points to local function or Azurite
- **Function**: `func start` in `function/` using Azure Functions Core Tools v4; `local.settings.json` holds env vars and uses Azurite connection string
- **Azurite**: `azurite --silent` or Docker `mcr.microsoft.com/azure-storage/azurite` for local blob emulation

#### CI/CD (GitHub Actions)

Two workflows:

**`deploy-ui.yml`** — triggered on push to `main`:
1. `npm ci && npm run build` in `ui/`
2. Deploy `dist/` to Azure Static Web App using `Azure/static-web-apps-deploy@v1` and the SWA deployment token (stored as a GitHub secret)

**`deploy-function.yml`** — triggered on push to `main`:
1. `pip install -r requirements.txt --target .python_packages/lib/site-packages`
2. Deploy to Azure Functions using `Azure/functions-action@v1` with a publish profile or OIDC credentials

#### Outputs

Terraform outputs needed by CI/CD and local dev:
- `swa_url` — the default hostname of the Static Web App
- `function_app_url` — the default hostname of the Function App (used as `VITE_API_URL`)
- `storage_account_name` — needed to pre-populate `local.settings.json`




