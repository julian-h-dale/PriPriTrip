-- Chat idempotency key (review.md 3D-5). Additive: adds two nullable columns
-- and one unique constraint. No data is touched.
--   psql postgresql://postgres:postgres@localhost:5433/pripritrip -f sql/2026-07-11_chat_idempotency.sql
--
-- `./dev.sh --clean` produces the same schema from scratch.

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS request_id VARCHAR;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_payload VARCHAR;

-- The claim. A concurrent duplicate send blocks on this index until the first
-- transaction ends, then fails — which is what stops the LLM pipeline running
-- twice. Existing rows have request_id NULL, and Postgres treats NULLs as
-- distinct, so they do not collide.
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS uq_chat_messages_user_request;
ALTER TABLE chat_messages
    ADD CONSTRAINT uq_chat_messages_user_request UNIQUE (user_id, request_id, is_bot);
