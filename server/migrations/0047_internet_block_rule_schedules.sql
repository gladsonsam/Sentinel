-- Curfew schedules for internet block rules.
-- If a rule has zero schedules, it is treated as "always active" (backwards-compatible).

CREATE TABLE internet_block_rule_schedules (
    id           BIGSERIAL PRIMARY KEY,
    rule_id      BIGINT NOT NULL REFERENCES internet_block_rules(id) ON DELETE CASCADE,
    day_of_week  INT NOT NULL,
    start_minute INT NOT NULL,
    end_minute   INT NOT NULL,
    CHECK (day_of_week >= 0 AND day_of_week <= 6),
    CHECK (start_minute >= 0 AND start_minute <= 1439),
    CHECK (end_minute >= 0 AND end_minute <= 1439),
    CHECK (start_minute < end_minute)
);

CREATE INDEX internet_block_rule_schedules_rule_id ON internet_block_rule_schedules(rule_id);
