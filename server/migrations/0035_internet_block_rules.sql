-- Internet blocking is now rule-based (same scope model as app_block_rules).
-- The existing per-agent internet_blocked column is migrated to agent-scoped rules.

CREATE TABLE internet_block_rules (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE internet_block_rule_scopes (
    id         BIGSERIAL PRIMARY KEY,
    rule_id    BIGINT NOT NULL REFERENCES internet_block_rules(id) ON DELETE CASCADE,
    scope_kind TEXT NOT NULL,
    group_id   UUID REFERENCES agent_groups(id) ON DELETE CASCADE,
    agent_id   UUID REFERENCES agents(id) ON DELETE CASCADE,
    CHECK (
        (scope_kind = 'all'   AND group_id IS NULL  AND agent_id IS NULL) OR
        (scope_kind = 'group' AND group_id IS NOT NULL AND agent_id IS NULL) OR
        (scope_kind = 'agent' AND agent_id IS NOT NULL AND group_id IS NULL)
    )
);

CREATE INDEX internet_block_rule_scopes_rule_id  ON internet_block_rule_scopes (rule_id);
CREATE INDEX internet_block_rule_scopes_agent_id ON internet_block_rule_scopes (agent_id);
CREATE INDEX internet_block_rule_scopes_group_id ON internet_block_rule_scopes (group_id);

-- Migrate existing per-agent blocks to agent-scoped rules.
DO $$
DECLARE
    rec RECORD;
    rid BIGINT;
BEGIN
    FOR rec IN SELECT id FROM agents WHERE internet_blocked = true LOOP
        INSERT INTO internet_block_rules (name) VALUES ('Migrated') RETURNING id INTO rid;
        INSERT INTO internet_block_rule_scopes (rule_id, scope_kind, agent_id)
        VALUES (rid, 'agent', rec.id);
    END LOOP;
END $$;
