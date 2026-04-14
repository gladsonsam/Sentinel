-- Enforce many-to-one rollup: one UT1 key can belong to at most one custom category.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_url_custom_category_members_ut1_key
    ON url_custom_category_members (ut1_key);

