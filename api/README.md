# PriPriTrip API

FastAPI backend for the PriPriTrip honeymoon trip planner.

## Stack

| Layer | Tech |
|---|---|
| Runtime | Python 3.12 |
| Framework | FastAPI ≥ 0.111 |
| ORM | SQLAlchemy ≥ 2.0 |
| Database | PostgreSQL 16 (Docker locally, Azure Flexible Server in prod) |
| Auth | HMAC-signed bearer token (password-in, token-out) |

---

## Local setup (first time)

### 1. Create a virtual environment

```bash
cd api/
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Create your `.env` file

```bash
cp .env.example .env
# Edit .env if you want to change defaults (APP_PASSWORD, TOKEN_SECRET, etc.)
```

The defaults work out of the box for local development.

---

## Running locally

### Quick start (recommended)

`dev.sh` wipes the Postgres volume, recreates the schema from the SQLAlchemy models, and starts the API with hot-reload.

```bash
chmod +x dev.sh   # once
./dev.sh
```

The API is available at **http://localhost:8000**.  
Interactive docs: **http://localhost:8000/docs**

#### Options

```bash
./dev.sh             # full wipe → create schema → start
./dev.sh --no-wipe   # keep existing data, create any missing tables, then start
```

> Schema is created via `init_db.py` which calls `Base.metadata.create_all()`. No migration files needed — just edit `app/models.py` and re-run `./dev.sh`.

---

## Seeding data

After the DB is up, seed it with the full honeymoon trip by calling the import endpoint.

Using the REST Client extension in VS Code, run the `POST /trip/import` request in `api.rest` — it reads from `data/trip.json` (10 days, 66 points).

Or with curl:

```bash
# 1. Get a token
TOKEN=$(curl -s -X POST http://localhost:8000/auth \
  -H "Content-Type: application/json" \
  -d '{"password":"honeymoon"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 2. Import trip data
curl -s -X POST http://localhost:8000/trip/import \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d @../data/trip.json | python3 -m json.tool
```

---

## Project layout

```
api/
├── app/
│   ├── auth.py           # Token creation & verification
│   ├── database.py       # SQLAlchemy engine & session factory
│   ├── enums.py          # PointType, LocationRole, TravelMode, StayType
│   ├── main.py           # FastAPI app factory
│   ├── models.py         # ORM models (SQLAlchemy) — edit this to change schema
│   ├── schemas.py        # Request / response schemas (Pydantic v2)
│   └── routers/
│       ├── trip.py         # GET /trip, POST /trip
│       ├── trip_days.py    # CRUD for /trip/days
│       ├── trip_points.py  # CRUD for /trip/points
│       └── trip_import.py  # POST /trip/import (bulk replace)
├── tests/
├── api.rest              # REST Client requests (VS Code)
├── dev.sh                # Local wipe-and-run script
├── docker-compose.yml
├── Dockerfile
├── init_db.py            # Creates schema via Base.metadata.create_all()
├── main.py               # uvicorn entry point (imports app from app/main.py)
└── requirements.txt
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/pripritrip` | PostgreSQL connection string |
| `APP_PASSWORD` | `honeymoon` | Password required to obtain a bearer token |
| `TOKEN_SECRET` | `dev-secret-change-me` | Secret used to sign bearer tokens |
| `MAPS_API_KEY` | _(empty)_ | Google Maps API key returned to the frontend after auth |

---

## Running tests

Tests use an in-memory SQLite database and do not require the Docker stack.

```bash
source .venv/bin/activate
python -m pytest tests/ -q
```
