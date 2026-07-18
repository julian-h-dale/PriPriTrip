-- Trip snapshots — the "cheap insurance" restore point (enhance/import safety).
-- Additive: one new table, nothing existing is touched.
--   psql postgresql://postgres:postgres@localhost:5433/pripritrip -f sql/2026-07-18_trip_snapshots.sql
--
-- `./dev.sh --clean` produces the same schema from scratch (Base.metadata.create_all).

CREATE TABLE IF NOT EXISTS trip_snapshots (
    snapshot_id    UUID PRIMARY KEY,
    -- CASCADE: a snapshot is meaningless once the trip is HARD-deleted. A trip
    -- "delete" is only a soft-delete, so snapshots survive it and can restore it.
    trip_id        UUID NOT NULL REFERENCES trips(trip_id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    created_by     VARCHAR NOT NULL,
    reason         VARCHAR NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    payload        JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_trip_snapshots_trip_created
    ON trip_snapshots (trip_id, created_at);
