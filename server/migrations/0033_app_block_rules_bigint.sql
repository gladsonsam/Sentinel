-- Fix: upgrade app_block_rules.id and app_block_rule_scopes.id from INT4 (SERIAL)
-- to INT8 (BIGINT) to match the i64 Rust types used throughout the codebase.
ALTER TABLE app_block_rule_scopes ALTER COLUMN id TYPE BIGINT;
ALTER TABLE app_block_rule_scopes ALTER COLUMN rule_id TYPE BIGINT;
ALTER TABLE app_block_rules ALTER COLUMN id TYPE BIGINT;
