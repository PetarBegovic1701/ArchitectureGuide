-- RNP-002: billing migrates the schema that orders' migrations own as well.
ALTER TABLE invoice ADD COLUMN paid boolean NOT NULL DEFAULT false;

-- RNP-017: a foreign key without an index.
CREATE TABLE payment (
  id text PRIMARY KEY,
  invoice_id text NOT NULL REFERENCES invoice(id),
  amount integer NOT NULL
);
