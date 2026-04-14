-- Human-friendly labels/descriptions for URL categories (UT1 keys).

CREATE TABLE IF NOT EXISTS url_category_labels (
    key TEXT PRIMARY KEY,
    label_en TEXT NOT NULL,
    description_en TEXT NOT NULL DEFAULT '',
    display_order INT NOT NULL DEFAULT 0,
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed a few common UT1 keys with more readable English labels.
INSERT INTO url_category_labels (key, label_en, description_en, display_order)
VALUES
    ('adult', 'Adult content', 'Erotic to pornography', 10),
    ('gambling', 'Gambling', 'Casino, betting, gambling games', 20),
    ('malware', 'Malware', 'Malware delivery sites', 30),
    ('phishing', 'Phishing', 'Phishing sites', 31),
    ('cryptojacking', 'Cryptojacking', 'Mining via hijacking', 40),
    ('drogue', 'Drugs', 'Drug-related content', 50),
    ('liste_bu', 'Education (FR list)', 'French education/library-oriented list (UT1)', 90),
    ('arjel', 'Gambling (certified)', 'French certified gambling sites list (ARJEL)', 91)
ON CONFLICT (key) DO NOTHING;

