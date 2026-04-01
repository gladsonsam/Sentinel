-- OIDC identities for dashboard users (Authentik, etc.).
-- Maps an external identity (issuer+subject) to a local dashboard user_id.

CREATE TABLE IF NOT EXISTS dashboard_identities (
    id BIGSERIAL PRIMARY KEY,
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
    preferred_username TEXT,
    email TEXT,
    name TEXT,
    last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (issuer, subject)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_identities_user
    ON dashboard_identities (user_id);

