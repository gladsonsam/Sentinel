-- Admin overrides for URL categorization (persist across UT1 updates).
-- Overrides are matched before UT1 lists.

CREATE TABLE IF NOT EXISTS url_category_overrides_domain (
    id BIGSERIAL PRIMARY KEY,
    category_id BIGINT NOT NULL REFERENCES url_categories(id) ON DELETE CASCADE,
    domain TEXT NOT NULL, -- normalized lowercase/punycode
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (domain)
);

CREATE INDEX IF NOT EXISTS idx_url_category_overrides_domain_domain
    ON url_category_overrides_domain (domain);

CREATE TABLE IF NOT EXISTS url_category_overrides_url (
    id BIGSERIAL PRIMARY KEY,
    category_id BIGINT NOT NULL REFERENCES url_categories(id) ON DELETE CASCADE,
    url_prefix TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (url_prefix)
);

CREATE INDEX IF NOT EXISTS idx_url_category_overrides_url_prefix
    ON url_category_overrides_url (url_prefix);

