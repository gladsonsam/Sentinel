-- Seed human-readable English labels for all known UT1 keys, and
-- create sensible default custom groups with pre-assigned members.
-- Admins can rename/move/add anything via the UI afterward.

-- ─── 1. Labels ────────────────────────────────────────────────────────────────
-- Uses ON CONFLICT … DO UPDATE so re-running is safe.
INSERT INTO url_category_labels (key, label_en, description_en, updated_at)
VALUES
    ('adult',                   'Adult content',           'Pornographic and erotic content', NOW()),
    ('agressif',                'Aggressive content',      'Hate speech, threats and aggressive content', NOW()),
    ('ai',                      'AI tools',                'Artificial intelligence services', NOW()),
    ('arjel',                   'Gambling (certified)',    'French regulated gambling sites (ARJEL)', NOW()),
    ('associations_religieuses','Religious organizations', 'Religious and faith-based websites', NOW()),
    ('astrology',               'Astrology',               'Horoscopes and astrology sites', NOW()),
    ('audio-video',             'Streaming media',         'Audio and video streaming platforms', NOW()),
    ('bank',                    'Banking',                 'Online banking and financial institutions', NOW()),
    ('bitcoin',                 'Cryptocurrency',          'Bitcoin and other cryptocurrency sites', NOW()),
    ('blog',                    'Blogs',                   'Personal and professional blogs', NOW()),
    ('celebrity',               'Celebrity news',          'Celebrity and entertainment gossip', NOW()),
    ('chat',                    'Chat & messaging',        'Real-time chat and instant messaging', NOW()),
    ('child',                   'Child safety',            'Content blocked for child safety', NOW()),
    ('cleaning',                'Cleaning services',       'Domestic and cleaning services', NOW()),
    ('cooking',                 'Cooking & food',          'Recipes, cooking, and food websites', NOW()),
    ('cryptojacking',           'Cryptojacking',           'Sites that hijack CPU for crypto mining', NOW()),
    ('dangerous_material',      'Dangerous content',       'Illegal weapons and hazardous material', NOW()),
    ('dating',                  'Dating',                  'Online dating and relationship sites', NOW()),
    ('ddos',                    'DDoS tools',              'Distributed denial-of-service attack tools', NOW()),
    ('dialer',                  'Dialers',                 'Malicious dialer software', NOW()),
    ('doh',                     'DNS over HTTPS',          'DoH providers — can bypass DNS-level filtering', NOW()),
    ('download',                'File downloads',          'General file download portals', NOW()),
    ('drogue',                  'Drugs',                   'Drug-related content and sales', NOW()),
    ('dynamic-dns',             'Dynamic DNS',             'Dynamic DNS services (commonly abused by malware)', NOW()),
    ('educational_games',       'Educational games',       'Games with an educational purpose', NOW()),
    ('examen_pix',              'PIX Exam',                'French national digital skills exam (PIX)', NOW()),
    ('exceptions_liste_bu',     'Education exceptions',    'UT1 exception list for the education whitelist', NOW()),
    ('fakenews',                'Fake news',               'Misinformation and disinformation sites', NOW()),
    ('filehosting',             'File hosting',            'Cloud file hosting and sharing', NOW()),
    ('financial',               'Finance',                 'Financial news, markets and tools', NOW()),
    ('forums',                  'Forums',                  'Online discussion forums and communities', NOW()),
    ('gambling',                'Gambling',                'Casino, betting and gambling games', NOW()),
    ('games',                   'Games',                   'Online and browser-based gaming', NOW()),
    ('hacking',                 'Hacking tools',           'Exploitation frameworks and hacking resources', NOW()),
    ('jobsearch',               'Job search',              'Job listings and recruitment platforms', NOW()),
    ('lingerie',                'Lingerie',                'Lingerie and intimate apparel', NOW()),
    ('liste_blanche',           'Whitelist',               'UT1 explicit allow-list', NOW()),
    ('liste_bu',                'Education (FR list)',     'French education library-oriented whitelist (UT1)', NOW()),
    ('malware',                 'Malware',                 'Malware delivery and command-and-control sites', NOW()),
    ('manga',                   'Manga & anime',           'Manga and anime reading/streaming', NOW()),
    ('marketingware',           'Adware / marketing',      'Adware and aggressive marketing software', NOW()),
    ('mixed_adult',             'Mixed adult content',     'Sites with a mix of adult and regular content', NOW()),
    ('mobile-phone',            'Mobile content',          'Mobile-specific content and ringtone sites', NOW()),
    ('phishing',                'Phishing',                'Credential-stealing and phishing sites', NOW()),
    ('press',                   'News & press',            'Newspapers, magazines and news media', NOW()),
    ('publicite',               'Advertising',             'Online advertising networks and trackers', NOW()),
    ('radio',                   'Radio & podcasts',        'Online radio stations and podcast platforms', NOW()),
    ('reaffected',              'Reassigned domains',      'Previously malicious domains now reassigned', NOW()),
    ('redirector',              'Redirectors',             'URL redirect and link forwarding services', NOW()),
    ('remote-control',          'Remote access',           'Remote desktop and control software', NOW()),
    ('residential-proxies',     'Residential proxies',     'Residential IP proxy services', NOW()),
    ('residential_proxies',     'Residential proxies',     'Residential IP proxy services', NOW()),
    ('sect',                    'Cults & sects',           'Sectarian, cult and extremist groups', NOW()),
    ('sexual_education',        'Sexual education',        'Sex education content', NOW()),
    ('shopping',                'Shopping',                'E-commerce and online retail', NOW()),
    ('shortener',               'URL shorteners',          'URL shortening and link-redirect services', NOW()),
    ('social_networks',         'Social media',            'Social networking platforms', NOW()),
    ('special',                 'Special (internal)',      'UT1 internal classification — see UT1 docs', NOW()),
    ('sports',                  'Sports',                  'Sports news, scores and streaming', NOW()),
    ('stalkerware',             'Stalkerware',             'Monitoring and stalkerware applications', NOW()),
    ('strict_redirector',       'Strict redirectors',      'Strict URL redirect chains', NOW()),
    ('strong_redirector',       'Strong redirectors',      'Strong/aggressive URL redirect chains', NOW()),
    ('translation',             'Translation',             'Language translation services', NOW()),
    ('tricheur',                'Cheating tools',          'Academic cheating and contract-cheating sites', NOW()),
    ('tricheur_pix',            'Exam cheating (PIX)',     'Cheating sites specific to the French PIX exam', NOW()),
    ('update',                  'Software updates',        'Software update and patch delivery networks', NOW()),
    ('vpn',                     'VPN services',            'Commercial VPN and anonymization services', NOW()),
    ('warez',                   'Piracy (warez)',           'Software piracy and illegal content', NOW()),
    ('webhosting',              'Web hosting',             'Shared web hosting providers', NOW()),
    ('webmail',                 'Webmail',                 'Browser-based email services', NOW())
ON CONFLICT (key) DO UPDATE
    SET label_en       = EXCLUDED.label_en,
        description_en = EXCLUDED.description_en,
        updated_at     = EXCLUDED.updated_at;

-- ─── 2. Custom groups ─────────────────────────────────────────────────────────
INSERT INTO url_custom_categories (key, label_en, description_en, display_order, hidden)
VALUES
    ('adult',         'Adult',             'Pornography, erotica and related content',             10,  false),
    ('security',      'Security threats',  'Malware, phishing, hacking and attack infrastructure', 20,  false),
    ('gambling',      'Gambling',          'Casino, betting and certified gambling sites',          30,  false),
    ('illegal',       'Illegal content',   'Drugs, piracy, cheating, cults and child safety',      40,  false),
    ('social',        'Social & chat',     'Social media, messaging, dating and email',             50,  false),
    ('entertainment', 'Entertainment',     'Streaming, gaming, sports, manga and celebrity',        60,  false),
    ('news',          'News & blogs',      'News media, press, blogs and forums',                   70,  false),
    ('finance',       'Finance & banking', 'Banking, crypto and financial services',                80,  false),
    ('shopping',      'Shopping',          'E-commerce and online retail',                          90,  false),
    ('advertising',   'Advertising',       'Ad networks, adware and marketing trackers',            100, false),
    ('lifestyle',     'Lifestyle',         'Cooking, cleaning, jobs, astrology and religion',       110, false),
    ('education',     'Education',         'Educational resources, lists and AI tools',             120, false),
    ('infra',         'Infrastructure',    'DNS, hosting, proxies, redirectors and VPNs',           200, true)
ON CONFLICT (key) DO NOTHING;

-- ─── 3. Assign UT1 keys to groups ─────────────────────────────────────────────
-- Each UT1 key can only belong to ONE custom group (enforced by unique index on ut1_key).
INSERT INTO url_custom_category_members (custom_category_id, ut1_key)
SELECT c.id, m.ut1_key
FROM (VALUES
    -- Adult
    ('adult',         'adult'),
    ('adult',         'mixed_adult'),
    ('adult',         'lingerie'),
    ('adult',         'sexual_education'),
    -- Security threats
    ('security',      'malware'),
    ('security',      'phishing'),
    ('security',      'cryptojacking'),
    ('security',      'hacking'),
    ('security',      'ddos'),
    ('security',      'stalkerware'),
    ('security',      'dangerous_material'),
    ('security',      'dialer'),
    ('security',      'reaffected'),
    ('security',      'residential-proxies'),
    ('security',      'residential_proxies'),
    -- Gambling
    ('gambling',      'gambling'),
    ('gambling',      'arjel'),
    -- Illegal
    ('illegal',       'drogue'),
    ('illegal',       'child'),
    ('illegal',       'sect'),
    ('illegal',       'agressif'),
    ('illegal',       'tricheur'),
    ('illegal',       'tricheur_pix'),
    ('illegal',       'warez'),
    ('illegal',       'fakenews'),
    -- Social & chat
    ('social',        'social_networks'),
    ('social',        'chat'),
    ('social',        'dating'),
    ('social',        'forums'),
    ('social',        'webmail'),
    -- Entertainment
    ('entertainment', 'audio-video'),
    ('entertainment', 'radio'),
    ('entertainment', 'manga'),
    ('entertainment', 'games'),
    ('entertainment', 'educational_games'),
    ('entertainment', 'sports'),
    ('entertainment', 'celebrity'),
    -- News & blogs
    ('news',          'press'),
    ('news',          'blog'),
    -- Finance & banking
    ('finance',       'bank'),
    ('finance',       'financial'),
    ('finance',       'bitcoin'),
    -- Shopping
    ('shopping',      'shopping'),
    -- Advertising
    ('advertising',   'publicite'),
    ('advertising',   'marketingware'),
    -- Lifestyle
    ('lifestyle',     'cooking'),
    ('lifestyle',     'cleaning'),
    ('lifestyle',     'astrology'),
    ('lifestyle',     'jobsearch'),
    ('lifestyle',     'associations_religieuses'),
    -- Education
    ('education',     'liste_bu'),
    ('education',     'examen_pix'),
    ('education',     'exceptions_liste_bu'),
    ('education',     'ai'),
    -- Infrastructure (hidden by default)
    ('infra',         'doh'),
    ('infra',         'dynamic-dns'),
    ('infra',         'redirector'),
    ('infra',         'strict_redirector'),
    ('infra',         'strong_redirector'),
    ('infra',         'shortener'),
    ('infra',         'filehosting'),
    ('infra',         'download'),
    ('infra',         'webhosting'),
    ('infra',         'vpn'),
    ('infra',         'remote-control'),
    ('infra',         'mobile-phone'),
    ('infra',         'translation'),
    ('infra',         'update'),
    ('infra',         'liste_blanche'),
    ('infra',         'special')
) AS m(group_key, ut1_key)
JOIN url_custom_categories c ON c.key = m.group_key
WHERE EXISTS (SELECT 1 FROM url_categories u WHERE u.key = m.ut1_key)
ON CONFLICT (custom_category_id, ut1_key) DO NOTHING;
