-- Real date/time columns, and the end of the duplicated wall-clock text
-- (review.md 1C-3). Two changes, both data-preserving:
--
--   1. Plain calendar dates stop being VARCHAR. The API wire format does not
--      change — Pydantic serializes a date as "2026-10-30", byte-identical to
--      what we sent before.
--
--   2. The redundant text copies go. Every one of them was written as
--      `rec.check_in = wall_clock_to_text(rec.check_in_local)` — the same fact
--      as the typed column beside it. The wall clock (*_local) and the
--      timezone (*_tzid) are KEPT; the API renders the text on the way out.
--
-- Run once against an existing database:
--   psql postgresql://postgres:postgres@localhost:5433/pripritrip -f sql/2026-07-12_date_columns.sql
--
-- `./dev.sh --clean` produces the same schema from scratch.

BEGIN;

-- ── 1. Calendar dates ────────────────────────────────────────────────────────
ALTER TABLE trips
    ALTER COLUMN start_date TYPE date USING start_date::date,
    ALTER COLUMN end_date   TYPE date USING end_date::date;

ALTER TABLE trip_days
    ALTER COLUMN date TYPE date USING date::date;

-- "When was this ticked done" is an instant, not a wall clock.
ALTER TABLE trip_points
    ALTER COLUMN completed_date_time TYPE timestamptz
    USING NULLIF(completed_date_time, '')::timestamptz;

-- ── 2. Drop the duplicated wall-clock text ───────────────────────────────────
-- Backfill first, in case any row has text but no typed value (older writes).
UPDATE stay_details
   SET check_in_local  = COALESCE(check_in_local,  NULLIF(check_in,  '')::timestamp),
       check_out_local = COALESCE(check_out_local, NULLIF(check_out, '')::timestamp);

UPDATE travel_details
   SET departure_local = COALESCE(departure_local, NULLIF(departure_date_time, '')::timestamp),
       arrival_local   = COALESCE(arrival_local,   NULLIF(arrival_date_time,   '')::timestamp);

UPDATE trip_points
   SET start_local = COALESCE(start_local, NULLIF(start_date_time, '')::timestamp),
       end_local   = COALESCE(end_local,   NULLIF(end_date_time,   '')::timestamp);

ALTER TABLE stay_details   DROP COLUMN IF EXISTS check_in,
                           DROP COLUMN IF EXISTS check_out;
ALTER TABLE travel_details DROP COLUMN IF EXISTS departure_date_time,
                           DROP COLUMN IF EXISTS arrival_date_time;
ALTER TABLE trip_points    DROP COLUMN IF EXISTS start_date_time,
                           DROP COLUMN IF EXISTS end_date_time;

COMMIT;
