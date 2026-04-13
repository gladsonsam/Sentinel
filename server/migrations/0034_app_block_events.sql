CREATE TABLE app_block_events (
    id          BIGSERIAL PRIMARY KEY,
    agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    rule_id     BIGINT REFERENCES app_block_rules(id) ON DELETE SET NULL,
    rule_name   TEXT,
    exe_name    TEXT NOT NULL,
    killed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX app_block_events_agent_id  ON app_block_events (agent_id);
CREATE INDEX app_block_events_rule_id   ON app_block_events (rule_id);
CREATE INDEX app_block_events_killed_at ON app_block_events (killed_at DESC);
