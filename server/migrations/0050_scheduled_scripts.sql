CREATE TABLE scheduled_scripts (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    shell TEXT NOT NULL,
    script TEXT NOT NULL,
    timeout_secs INTEGER NOT NULL DEFAULT 120,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE scheduled_script_scopes (
    script_id BIGINT NOT NULL REFERENCES scheduled_scripts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    group_id UUID,
    agent_id UUID
);

CREATE INDEX idx_scheduled_script_scopes_script_id ON scheduled_script_scopes(script_id);

CREATE TABLE scheduled_script_schedules (
    script_id BIGINT NOT NULL REFERENCES scheduled_scripts(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL,
    start_minute INTEGER NOT NULL,
    end_minute INTEGER NOT NULL
);

CREATE INDEX idx_scheduled_script_schedules_script_id ON scheduled_script_schedules(script_id);

CREATE TABLE scheduled_script_executions (
    script_id BIGINT NOT NULL REFERENCES scheduled_scripts(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL,
    window_date DATE NOT NULL,
    window_start_minute INTEGER NOT NULL,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(script_id, agent_id, window_date, window_start_minute)
);

CREATE INDEX idx_scheduled_script_executions_agent ON scheduled_script_executions(agent_id);
