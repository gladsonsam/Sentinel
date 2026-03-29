-- Audit log for operator/dashboard actions.
-- Stores security-relevant and operational actions (control commands, settings changes, etc).

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor TEXT NOT NULL DEFAULT 'dashboard',
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok',
    detail JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_log_ts
    ON audit_log (ts DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_agent_ts
    ON audit_log (agent_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_action_ts
    ON audit_log (action, ts DESC);
