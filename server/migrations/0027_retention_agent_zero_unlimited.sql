-- Allow 0 on per-agent overrides = explicit unlimited (still prunes nothing for that stream).
-- NULL on retention_agent still means "inherit global default".

ALTER TABLE retention_agent DROP CONSTRAINT IF EXISTS retention_agent_keylog_days_check;
ALTER TABLE retention_agent DROP CONSTRAINT IF EXISTS retention_agent_window_days_check;
ALTER TABLE retention_agent DROP CONSTRAINT IF EXISTS retention_agent_url_days_check;

ALTER TABLE retention_agent ADD CONSTRAINT retention_agent_keylog_days_check
  CHECK (keylog_days IS NULL OR (keylog_days >= 0 AND keylog_days <= 36500));
ALTER TABLE retention_agent ADD CONSTRAINT retention_agent_window_days_check
  CHECK (window_days IS NULL OR (window_days >= 0 AND window_days <= 36500));
ALTER TABLE retention_agent ADD CONSTRAINT retention_agent_url_days_check
  CHECK (url_days IS NULL OR (url_days >= 0 AND url_days <= 36500));
