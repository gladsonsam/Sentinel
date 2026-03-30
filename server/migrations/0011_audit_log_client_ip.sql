-- Client IP for dashboard audit rows (proxy-aware via X-Forwarded-For on HTTP handlers).
-- `actor` continues to identify the operator; use DASHBOARD_OPERATOR_NAME for a stable label until multi-user auth.

ALTER TABLE audit_log
    ADD COLUMN IF NOT EXISTS client_ip TEXT;
