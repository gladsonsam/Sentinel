CREATE TABLE app_block_rules (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    exe_pattern TEXT NOT NULL,
    match_mode  TEXT NOT NULL DEFAULT 'contains',
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE app_block_rule_scopes (
    id         SERIAL PRIMARY KEY,
    rule_id    INTEGER NOT NULL REFERENCES app_block_rules(id) ON DELETE CASCADE,
    scope_kind TEXT NOT NULL,
    group_id   UUID REFERENCES agent_groups(id) ON DELETE CASCADE,
    agent_id   UUID REFERENCES agents(id) ON DELETE CASCADE,
    CHECK (
        (scope_kind = 'all'   AND group_id IS NULL  AND agent_id IS NULL) OR
        (scope_kind = 'group' AND group_id IS NOT NULL AND agent_id IS NULL) OR
        (scope_kind = 'agent' AND agent_id IS NOT NULL AND group_id IS NULL)
    )
);

CREATE INDEX app_block_rule_scopes_rule_id ON app_block_rule_scopes (rule_id);
CREATE INDEX app_block_rule_scopes_agent_id ON app_block_rule_scopes (agent_id);
CREATE INDEX app_block_rule_scopes_group_id ON app_block_rule_scopes (group_id);
