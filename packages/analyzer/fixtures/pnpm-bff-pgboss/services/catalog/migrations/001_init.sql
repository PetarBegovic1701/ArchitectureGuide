CREATE SCHEMA catalog;
CREATE TABLE catalog.event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  starts_at timestamptz
);
CREATE TABLE catalog.seat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES catalog.event(id),
  label text NOT NULL
);
CREATE INDEX seat_event_idx ON catalog.seat (event_id);
