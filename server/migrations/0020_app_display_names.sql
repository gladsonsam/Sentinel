-- Add friendly app display names derived from executable metadata.
-- Stored alongside raw executable basenames so the UI can show both.

ALTER TABLE window_events
    ADD COLUMN IF NOT EXISTS app_display TEXT NOT NULL DEFAULT '';

ALTER TABLE key_sessions
    ADD COLUMN IF NOT EXISTS app_display TEXT NOT NULL DEFAULT '';

ALTER TABLE window_top_stats
    ADD COLUMN IF NOT EXISTS app_display TEXT NOT NULL DEFAULT '';

