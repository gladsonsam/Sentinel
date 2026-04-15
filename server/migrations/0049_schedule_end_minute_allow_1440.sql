-- Allow end_minute = 1440 (24:00) for overnight schedule splits created by the UI.
-- Do not edit earlier migrations after they ship; new installs get 0047/0048 with 1439,
-- then this migration relaxes the bound for existing and new databases.

DO $$
DECLARE
    con_name text;
BEGIN
    SELECT c.conname
    INTO con_name
    FROM pg_constraint c
    WHERE c.conrelid = 'public.internet_block_rule_schedules'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) NOT LIKE '%start_minute < end_minute%'
      AND pg_get_constraintdef(c.oid) LIKE '%end_minute%'
      AND pg_get_constraintdef(c.oid) LIKE '%<=%'
    LIMIT 1;

    IF con_name IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE public.internet_block_rule_schedules DROP CONSTRAINT %I',
            con_name
        );
    END IF;

    ALTER TABLE public.internet_block_rule_schedules ADD CONSTRAINT internet_block_rule_schedules_end_minute_bounds
        CHECK (end_minute >= 1 AND end_minute <= 1440);

    con_name := NULL;
    SELECT c.conname
    INTO con_name
    FROM pg_constraint c
    WHERE c.conrelid = 'public.app_block_rule_schedules'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) NOT LIKE '%start_minute < end_minute%'
      AND pg_get_constraintdef(c.oid) LIKE '%end_minute%'
      AND pg_get_constraintdef(c.oid) LIKE '%<=%'
    LIMIT 1;

    IF con_name IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE public.app_block_rule_schedules DROP CONSTRAINT %I',
            con_name
        );
    END IF;

    ALTER TABLE public.app_block_rule_schedules
        ADD CONSTRAINT app_block_rule_schedules_end_minute_bounds
        CHECK (end_minute >= 1 AND end_minute <= 1440);
END $$;
