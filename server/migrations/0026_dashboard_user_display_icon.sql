-- Optional short label shown as the user's avatar (emoji or initials fallback in the UI).

ALTER TABLE dashboard_users
    ADD COLUMN IF NOT EXISTS display_icon TEXT NULL;

COMMENT ON COLUMN dashboard_users.display_icon IS 'Optional avatar glyph (e.g. emoji), max 32 UTF-8 bytes; UI falls back to initials when null.';
