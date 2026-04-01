-- Per-session CSRF secret for cookie-authenticated dashboard mutating requests.

ALTER TABLE dashboard_sessions ADD COLUMN IF NOT EXISTS csrf_token TEXT;

UPDATE dashboard_sessions
SET csrf_token = REPLACE(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
WHERE csrf_token IS NULL;

ALTER TABLE dashboard_sessions ALTER COLUMN csrf_token SET NOT NULL;
