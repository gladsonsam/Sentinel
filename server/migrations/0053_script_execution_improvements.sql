-- Migration 0053: Mark manual triggers, add script execution retention config, improve indexing

-- 1. Add is_manual flag so manual triggers are distinguishable from scheduled fires
ALTER TABLE scheduled_script_executions
    ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT false;

-- 2. Add created_at timestamp for retention pruning
ALTER TABLE scheduled_script_executions
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 3. Add index on created_at for efficient retention pruning
CREATE INDEX IF NOT EXISTS idx_sse_created_at
    ON scheduled_script_executions (created_at DESC);

-- 4. Add index on script_id + expected_fire_time for efficient "last run" queries
CREATE INDEX IF NOT EXISTS idx_sse_script_fire
    ON scheduled_script_executions (script_id, expected_fire_time DESC);

-- 5. Add index on agent_id + expected_fire_time for agent history queries  
CREATE INDEX IF NOT EXISTS idx_sse_agent_fire
    ON scheduled_script_executions (agent_id, expected_fire_time DESC);
