-- Additive index migration for review.md 1C-3 (no Alembic yet).
-- Safe to run against an existing database: creates only missing indexes,
-- no table or data changes. `./dev.sh --clean` achieves the same from scratch.
--   psql postgresql://postgres:postgres@localhost:5433/pripritrip -f sql/2026-07-11_add_indexes.sql

CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email);
CREATE INDEX IF NOT EXISTS ix_trips_user_active ON trips (user_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS ix_trips_user_id ON trips (user_id);
CREATE INDEX IF NOT EXISTS ix_ai_documents_content_hash ON ai_documents (content_hash);
CREATE INDEX IF NOT EXISTS ix_ai_documents_trip_id ON ai_documents (trip_id);
CREATE INDEX IF NOT EXISTS ix_ai_documents_user_id ON ai_documents (user_id);
CREATE INDEX IF NOT EXISTS ix_chat_messages_trip_id ON chat_messages (trip_id);
CREATE INDEX IF NOT EXISTS ix_chat_messages_trip_workflow ON chat_messages (trip_id, user_id, workflow_name, created_at);
CREATE INDEX IF NOT EXISTS ix_chat_messages_user_id ON chat_messages (user_id);
CREATE INDEX IF NOT EXISTS ix_stay_details_trip_active ON stay_details (trip_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS ix_stay_details_trip_id ON stay_details (trip_id);
CREATE INDEX IF NOT EXISTS ix_travel_details_trip_active ON travel_details (trip_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS ix_travel_details_trip_id ON travel_details (trip_id);
CREATE INDEX IF NOT EXISTS ix_trip_days_trip_active ON trip_days (trip_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS ix_trip_days_trip_id ON trip_days (trip_id);
CREATE INDEX IF NOT EXISTS ix_trip_points_day_active ON trip_points (day_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS ix_trip_points_day_id ON trip_points (day_id);
CREATE INDEX IF NOT EXISTS ix_trip_points_stay_detail_id ON trip_points (stay_detail_id);
CREATE INDEX IF NOT EXISTS ix_trip_points_travel_detail_id ON trip_points (travel_detail_id);
CREATE INDEX IF NOT EXISTS ix_trip_points_trip_active ON trip_points (trip_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS ix_trip_points_trip_id ON trip_points (trip_id);
CREATE INDEX IF NOT EXISTS ix_locations_point_id ON locations (point_id);
CREATE INDEX IF NOT EXISTS ix_locations_stay_detail_id ON locations (stay_detail_id);
CREATE INDEX IF NOT EXISTS ix_locations_travel_detail_id ON locations (travel_detail_id);
