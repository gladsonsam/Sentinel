-- Domain blocklists and per-agent assignments for WFP-based blocking.

CREATE TABLE IF NOT EXISTS domain_blocklists (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT      NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS domain_blocklist_entries (
    id            BIGSERIAL PRIMARY KEY,
    blocklist_id  BIGINT      NOT NULL REFERENCES domain_blocklists(id) ON DELETE CASCADE,
    pattern       TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_blocklist_entries_blocklist
    ON domain_blocklist_entries (blocklist_id);

CREATE TABLE IF NOT EXISTS agent_blocklists (
    agent_id     UUID   NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    blocklist_id BIGINT NOT NULL REFERENCES domain_blocklists(id) ON DELETE CASCADE,
    PRIMARY KEY (agent_id, blocklist_id)
);

