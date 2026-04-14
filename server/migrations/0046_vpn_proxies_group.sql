-- Create a visible "VPN & proxies" group and move the relevant UT1 keys
-- out of the hidden Infrastructure group so they appear in analytics.

INSERT INTO url_custom_categories (key, label_en, description_en, display_order, hidden)
VALUES ('vpn_proxies', 'VPN & proxies', 'VPN services, anonymous proxies and residential proxy networks', 130, false)
ON CONFLICT (key) DO NOTHING;

-- Move the keys (delete from infra if present, then insert into new group)
DELETE FROM url_custom_category_members
WHERE ut1_key IN ('vpn', 'residential-proxies', 'residential_proxies');

INSERT INTO url_custom_category_members (custom_category_id, ut1_key)
SELECT c.id, m.ut1_key
FROM (VALUES
    ('vpn_proxies', 'vpn'),
    ('vpn_proxies', 'residential-proxies'),
    ('vpn_proxies', 'residential_proxies')
) AS m(group_key, ut1_key)
JOIN url_custom_categories c ON c.key = m.group_key
WHERE EXISTS (SELECT 1 FROM url_categories u WHERE u.key = m.ut1_key)
ON CONFLICT (custom_category_id, ut1_key) DO NOTHING;
