-- Add per-event user attribution for shared PCs / guest accounts.
-- Nullable: older agents won't send it; lock screen may be empty.

ALTER TABLE window_events
  ADD COLUMN IF NOT EXISTS user_name TEXT;

ALTER TABLE key_sessions
  ADD COLUMN IF NOT EXISTS user_name TEXT;

ALTER TABLE url_visits
  ADD COLUMN IF NOT EXISTS user_name TEXT;

ALTER TABLE activity_log
  ADD COLUMN IF NOT EXISTS user_name TEXT;

ALTER TABLE url_sessions
  ADD COLUMN IF NOT EXISTS user_name TEXT;

-- Helpful for per-user queries/filtering (optional but cheap).
CREATE INDEX IF NOT EXISTS idx_window_events_agent_user_ts
  ON window_events (agent_id, user_name, ts DESC);

CREATE INDEX IF NOT EXISTS idx_url_visits_agent_user_ts
  ON url_visits (agent_id, user_name, ts DESC);

CREATE INDEX IF NOT EXISTS idx_activity_log_agent_user_ts
  ON activity_log (agent_id, user_name, ts DESC);

