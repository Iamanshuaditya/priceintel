ALTER TABLE competitor_listings
  ADD COLUMN IF NOT EXISTS expected_currency char(3),
  ADD COLUMN IF NOT EXISTS market_country char(2),
  ADD COLUMN IF NOT EXISTS locale text;

UPDATE competitor_listings l
SET expected_currency = p.currency
FROM products p
WHERE p.id = l.product_id
  AND p.workspace_id = l.workspace_id
  AND l.expected_currency IS NULL;

ALTER TABLE competitor_listings ALTER COLUMN expected_currency SET NOT NULL;

ALTER TABLE competitor_listings DROP CONSTRAINT IF EXISTS competitor_listings_expected_currency_check;
ALTER TABLE competitor_listings ADD CONSTRAINT competitor_listings_expected_currency_check
  CHECK (expected_currency ~ '^[A-Z]{3}$');

ALTER TABLE competitor_listings DROP CONSTRAINT IF EXISTS competitor_listings_market_country_check;
ALTER TABLE competitor_listings ADD CONSTRAINT competitor_listings_market_country_check
  CHECK (market_country IS NULL OR market_country ~ '^[A-Z]{2}$');

ALTER TABLE competitor_listings DROP CONSTRAINT IF EXISTS competitor_listings_locale_check;
ALTER TABLE competitor_listings ADD CONSTRAINT competitor_listings_locale_check
  CHECK (locale IS NULL OR (length(locale) BETWEEN 2 AND 35 AND locale ~ '^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$'));
