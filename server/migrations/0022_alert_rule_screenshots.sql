-- Optional: attach a screenshot to each alert-rule trigger.

ALTER TABLE alert_rules
    ADD COLUMN IF NOT EXISTS take_screenshot BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS alert_rule_event_screenshots (
    event_id   BIGINT PRIMARY KEY REFERENCES alert_rule_events(id) ON DELETE CASCADE,
    jpeg       BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_event_screenshots_created
    ON alert_rule_event_screenshots (created_at DESC);

