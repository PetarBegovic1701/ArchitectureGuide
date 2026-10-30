CREATE SCHEMA IF NOT EXISTS catalog;

CREATE TABLE catalog.products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  price_cents integer NOT NULL
);
