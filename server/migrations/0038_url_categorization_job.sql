-- Persisted job status for URL categorization list downloads/imports.
-- This allows showing progress in the dashboard and surviving page refreshes.

CREATE TABLE IF NOT EXISTS url_categorization_job (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    state TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('idle','downloading','importing','ready','error')),
    started_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    bytes_total BIGINT,
    bytes_done BIGINT NOT NULL DEFAULT 0,
    message TEXT
);

INSERT INTO url_categorization_job (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING;

