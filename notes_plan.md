# Memory Capture Feature — Plan

## What We're Building

A simple form to capture memories during the trip:

| Field    | Notes                                      |
|----------|--------------------------------------------|
| title    | Short label for the memory                 |
| date     | Date the memory happened                   |
| time     | Optional time                              |
| location | Free-text or linked to a trip.json location|
| notes    | Markdown-supported body text               |

---

## Storage Decision

### Option A — Azure Blob Storage (existing account)

Add a new `memories` container alongside `trip` and `documents`. Two sub-options:

#### A1 — Single JSON file (`memories.json`)
All notes stored as an array in one blob, same pattern as `trip.json`.

**Pros:**
- Zero new infrastructure — same storage account, same pattern as the trip file
- Fits exactly how the function app already works (read blob, mutate, write blob)
- No new Terraform, no new Azure resources, no cost increase
- Simple to back up or export — one file

**Cons:**
- Whole file gets rewritten on every save (fine at low volume, not great at scale)
- Concurrent writes could theoretically conflict (not a real concern with 2 users)
- No per-note querying — you always load everything

#### A2 — One JSON file per memory (`memories/<uuid>.json`)
Each memory is its own blob.

**Pros:**
- Cleaner per-note operations (delete/update one file without touching others)
- Easier to add attachments per note (photos, etc.) later

**Cons:**
- Listing notes requires listing all blobs in the container (one extra API call)
- Still no real querying
- More complex API surface for very little gain at 2-user scale

---

### Option B — Cosmos DB

**Pros:**
- Proper document DB with per-document operations
- Built-in indexing and querying if we ever want to filter/search memories
- Scales well if we ever expand

**Cons:**
- **Cost** — even the free tier (400 RU/s) adds complexity; the paid tier starts at ~$24/month for something we don't need
- New Terraform resources (Cosmos account, database, container)
- New SDK dependency in the function app (`azure-cosmos`)
- More moving parts for a two-person app that will have maybe 50–100 notes total
- Overkill — we're not querying across millions of documents

---

## Recommendation

**Option A1 — single `memories.json` blob.** It's the right call for a 2-user app:

- No new infrastructure or cost
- Identical pattern to what already works for `trip.json`
- The whole notes file will be tiny (50–100 notes, maybe 50KB max)
- If we ever outgrow it (unlikely), migrating to Cosmos later is straightforward

---

## Implementation Plan

### 1. Data Model — `memories.json`

```json
{
  "memories": [
    {
      "memoryId": "uuid",
      "title": "Sunset at Männlichen",
      "date": "2026-05-14",
      "time": "17:45",
      "location": "Männlichen, Switzerland",
      "notes": "Markdown-supported body text...",
      "createdAt": "2026-05-14T17:45:00+02:00",
      "updatedAt": "2026-05-14T17:45:00+02:00"
    }
  ]
}
```

### 2. Infrastructure (Terraform)

- Add `azurerm_storage_container "memories"` to `storage.tf`
- No other changes needed — same storage account, same role assignments already cover it

### 3. Backend (Azure Function)

New routes in `function_app.py`:

| Method | Route             | Action                        |
|--------|-------------------|-------------------------------|
| GET    | `/api/memories`   | Read and return `memories.json` |
| POST   | `/api/memories`   | Append a new memory           |
| PUT    | `/api/memories/{id}` | Update an existing memory  |
| DELETE | `/api/memories/{id}` | Delete a memory            |

Same auth pattern as the trip endpoints (Bearer token).

### 4. Frontend

- New Redux slice: `memoriesSlice.js`
- New page: `MemoriesPage.jsx` — list of memory cards
- New form: `MemoryForm.jsx` — create/edit dialog (same pattern as `LegForm`)
- Add route `/memories` in `App.jsx`
- Add nav link in whatever the current nav structure is

### 5. Schema

Add `memory.schema.json` alongside `trip.schema.json`.

---

## Decisions

1. **Photos** — `photos` array field included in the schema now; UI will not use it yet. Photos stored as blob names in the `documents` container (same as trip documents), resolved to SAS URLs on read.
2. **Link to itinerary** — Optional `linkedItemId` field on each memory. UI will display it if set but no special UI for linking yet.
3. **Sort order** — Reverse-chronological by `date`/`time`. No manual reordering.
