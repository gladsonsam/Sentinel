-- Remove domain blocklists tables after disabling the feature.
--
-- This is destructive (drops any saved blocklist/policy data).
-- Keep this as a forward-only migration; the feature is currently removed.

DROP TABLE IF EXISTS agent_blocklists;
DROP TABLE IF EXISTS domain_blocklist_entries;
DROP TABLE IF EXISTS domain_blocklists;

