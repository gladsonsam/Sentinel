-- Custom category layer on top of UT1 categories.
-- Lets admins group multiple UT1 keys into a smaller set of custom categories.

CREATE TABLE IF NOT EXISTS url_custom_categories (
    id BIGSERIAL PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    label_en TEXT NOT NULL,
    description_en TEXT NOT NULL DEFAULT '',
    display_order INT NOT NULL DEFAULT 0,
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS url_custom_category_members (
    custom_category_id BIGINT NOT NULL REFERENCES url_custom_categories(id) ON DELETE CASCADE,
    ut1_key TEXT NOT NULL,
    PRIMARY KEY (custom_category_id, ut1_key)
);

CREATE INDEX IF NOT EXISTS idx_url_custom_category_members_ut1_key
    ON url_custom_category_members (ut1_key);

