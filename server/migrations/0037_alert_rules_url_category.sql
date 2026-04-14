-- Allow alert rules to target URL categories produced by URL categorization.

ALTER TABLE alert_rules
    DROP CONSTRAINT IF EXISTS alert_rules_channel_check;

ALTER TABLE alert_rules
    ADD CONSTRAINT alert_rules_channel_check
    CHECK (channel IN ('url', 'keys', 'url_category'));

