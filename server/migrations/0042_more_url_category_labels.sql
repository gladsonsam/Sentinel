-- Additional label seeds + ensure title-case fallbacks can be overridden cleanly.

INSERT INTO url_category_labels (key, label_en, description_en, display_order)
VALUES
    ('examen_pix', 'PIX Exam', 'French students taking the PIX exam (UT1-specific).', 92),
    ('tricheur_pix', 'Exam cheating (PIX)', 'Cheating sites related to PIX exam (UT1-specific).', 93)
ON CONFLICT (key) DO NOTHING;

