-- Optional per-agent icon (set by dashboard operator).
-- Stored on the agents row so it is available in the init payload / overview list.

ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS icon TEXT;

