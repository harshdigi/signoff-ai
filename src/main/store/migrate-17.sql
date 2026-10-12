-- v17: a decision can be open for product: you need the product team's answer first.
-- product_note: what you need from them (you write it); product_at: when it was marked. NULL: not waiting on product.
ALTER TABLE decisions ADD COLUMN product_note TEXT;
ALTER TABLE decisions ADD COLUMN product_at TEXT;
PRAGMA user_version = 17;
