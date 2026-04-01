-- Ensure every agent has an icon (default: "monitor").

ALTER TABLE agents
    ALTER COLUMN icon SET DEFAULT 'monitor';

UPDATE agents
SET icon = 'monitor'
WHERE icon IS NULL OR icon = '';

