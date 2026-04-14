-- URL categorization (UT1 blacklists): server-side enrichment for analytics + alert rules.
--
-- Designed to be self-host friendly:
-- - Feature is disabled by default (no downloads, no categorization work).
-- - When enabled, the server keeps exactly one active release's entries in DB.

-- Singleton settings row (global feature toggle + auto-update policy).
CREATE TABLE IF NOT EXISTS url_categorization_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    auto_update BOOLEAN NOT NULL DEFAULT TRUE,
    -- Configurable source URL. Default uses GitHub tarball (reliable HTTPS).
    source_url TEXT NOT NULL DEFAULT 'https://github.com/olbat/ut1-blacklists/archive/refs/heads/master.tar.gz',
    last_update_at TIMESTAMPTZ,
    last_update_error TEXT
);

INSERT INTO url_categorization_settings (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING;

-- Releases (metadata only). We keep rows for audit, but entries are stored only for the active release.
CREATE TABLE IF NOT EXISTS url_categorization_release (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Version is a free-form identifier (sha256, timestamp, ETag, ...).
    version TEXT NOT NULL DEFAULT '',
    sha256 TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_url_categorization_release_active
    ON url_categorization_release (active)
    WHERE active = true;

-- Categories (UT1 category keys like "adult", "gambling", ...).
CREATE TABLE IF NOT EXISTS url_categories (
    id BIGSERIAL PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    description TEXT NOT NULL DEFAULT ''
);

-- Domain entries (normalized lowercase / punycode). Stored only for the active release.
CREATE TABLE IF NOT EXISTS url_category_domain_entries (
    category_id BIGINT NOT NULL REFERENCES url_categories(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    PRIMARY KEY (category_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_url_category_domain_entries_domain
    ON url_category_domain_entries (domain);

-- URL prefix entries (normalized absolute URL prefix). Stored only for the active release.
CREATE TABLE IF NOT EXISTS url_category_url_entries (
    category_id BIGINT NOT NULL REFERENCES url_categories(id) ON DELETE CASCADE,
    url_prefix TEXT NOT NULL,
    PRIMARY KEY (category_id, url_prefix)
);

CREATE INDEX IF NOT EXISTS idx_url_category_url_entries_prefix
    ON url_category_url_entries (url_prefix);

-- Queue of URL visits to categorize (created on ingest).
CREATE TABLE IF NOT EXISTS url_categorization_queue (
    url_visit_id BIGINT PRIMARY KEY REFERENCES url_visits(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    ts TIMESTAMPTZ NOT NULL,
    url TEXT NOT NULL,
    hostname TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_url_categorization_queue_agent_ts
    ON url_categorization_queue (agent_id, ts DESC);

-- Per-visit categorization result (nullable category).
CREATE TABLE IF NOT EXISTS url_visit_category (
    url_visit_id BIGINT PRIMARY KEY REFERENCES url_visits(id) ON DELETE CASCADE,
    category_id BIGINT REFERENCES url_categories(id) ON DELETE SET NULL,
    categorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Long-lived aggregates per agent + category.
CREATE TABLE IF NOT EXISTS url_category_stats (
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    category_id BIGINT NOT NULL REFERENCES url_categories(id) ON DELETE CASCADE,
    visit_count BIGINT NOT NULL DEFAULT 0,
    last_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, category_id)
);

