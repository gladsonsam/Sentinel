-- Default agent auto-update policy: off. Dashboard / WS `update_now` still applies upgrades.

UPDATE agent_auto_update SET enabled = false WHERE id = 1;
