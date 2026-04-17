-- Fix constraints for scheduled scripts if they were missed in previous migrations
ALTER TABLE scheduled_script_schedules ALTER COLUMN day_of_week DROP NOT NULL;

-- Also ensure columns from 51 exist just in case 51 was partially applied or skipped
ALTER TABLE scheduled_script_schedules ADD COLUMN IF NOT EXISTS frequency TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE scheduled_script_schedules ADD COLUMN IF NOT EXISTS fire_minute INTEGER NOT NULL DEFAULT 0;

ALTER TABLE scheduled_script_executions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'fired';
ALTER TABLE scheduled_script_executions ADD COLUMN IF NOT EXISTS expected_fire_time TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE scheduled_script_executions ADD COLUMN IF NOT EXISTS output TEXT;

DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_script_executions_unique_fire_time') THEN
        ALTER TABLE scheduled_script_executions ADD CONSTRAINT scheduled_script_executions_unique_fire_time UNIQUE(script_id, agent_id, expected_fire_time);
    END IF;
END $$;
