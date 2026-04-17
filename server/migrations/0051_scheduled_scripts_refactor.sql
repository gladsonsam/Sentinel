-- Alter scheduled_script_schedules to support specific fire_minute and frequency
ALTER TABLE scheduled_script_schedules DROP COLUMN IF EXISTS start_minute;
ALTER TABLE scheduled_script_schedules DROP COLUMN IF EXISTS end_minute;

ALTER TABLE scheduled_script_schedules ADD COLUMN IF NOT EXISTS frequency TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE scheduled_script_schedules ADD COLUMN IF NOT EXISTS fire_minute INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scheduled_script_schedules ALTER COLUMN day_of_week DROP NOT NULL;

-- Alter scheduled_script_executions to support logging outputs and status
ALTER TABLE scheduled_script_executions DROP COLUMN IF EXISTS window_date;
ALTER TABLE scheduled_script_executions DROP COLUMN IF EXISTS window_start_minute;

ALTER TABLE scheduled_script_executions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'fired';
ALTER TABLE scheduled_script_executions ADD COLUMN IF NOT EXISTS expected_fire_time TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE scheduled_script_executions ADD COLUMN IF NOT EXISTS output TEXT;

-- Prevent double-firing in the same minute
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_script_executions_unique_fire_time') THEN
        ALTER TABLE scheduled_script_executions ADD CONSTRAINT scheduled_script_executions_unique_fire_time UNIQUE(script_id, agent_id, expected_fire_time);
    END IF;
END $$;
