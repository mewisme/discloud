-- +goose Up

CREATE TABLE audit_events (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    actor_user_id uuid REFERENCES users(id),
    action text NOT NULL CHECK (btrim(action) <> ''),
    resource_type text,
    resource_id uuid,
    request_id text,
    ip_address inet,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_actor_time_idx ON audit_events (actor_user_id, created_at DESC);
CREATE INDEX audit_events_resource_idx ON audit_events (resource_type, resource_id, created_at DESC);
CREATE INDEX audit_events_time_idx ON audit_events (created_at DESC);