-- Agent groups (many agents; used to attach alert rules at group scope).
CREATE TABLE IF NOT EXISTS agent_groups (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL UNIQUE,
    description TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_group_members (
    group_id UUID NOT NULL REFERENCES agent_groups(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_group_members_agent
    ON agent_group_members (agent_id);

-- Alert rule definitions (pattern + channel). Targets are separate rows (scopes).
CREATE TABLE IF NOT EXISTS alert_rules (
    id                BIGSERIAL PRIMARY KEY,
    name              TEXT        NOT NULL DEFAULT '',
    channel           TEXT        NOT NULL CHECK (channel IN ('url', 'keys')),
    pattern           TEXT        NOT NULL,
    match_mode        TEXT        NOT NULL DEFAULT 'substring' CHECK (match_mode IN ('substring', 'regex')),
    case_insensitive  BOOLEAN     NOT NULL DEFAULT TRUE,
    cooldown_secs     INT         NOT NULL DEFAULT 300 CHECK (cooldown_secs >= 0),
    enabled           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled_channel
    ON alert_rules (enabled, channel);

-- Where a rule applies: all agents, one group, or one agent (any combination via multiple rows).
CREATE TABLE IF NOT EXISTS alert_rule_scopes (
    id         BIGSERIAL PRIMARY KEY,
    rule_id    BIGINT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    scope_kind TEXT   NOT NULL CHECK (scope_kind IN ('all', 'group', 'agent')),
    group_id   UUID   REFERENCES agent_groups(id) ON DELETE CASCADE,
    agent_id   UUID   REFERENCES agents(id) ON DELETE CASCADE,
    CHECK (
        (scope_kind = 'all' AND group_id IS NULL AND agent_id IS NULL)
        OR (scope_kind = 'group' AND group_id IS NOT NULL AND agent_id IS NULL)
        OR (scope_kind = 'agent' AND agent_id IS NOT NULL AND group_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_scopes_rule ON alert_rule_scopes (rule_id);
CREATE INDEX IF NOT EXISTS idx_alert_rule_scopes_group ON alert_rule_scopes (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alert_rule_scopes_agent ON alert_rule_scopes (agent_id) WHERE agent_id IS NOT NULL;
