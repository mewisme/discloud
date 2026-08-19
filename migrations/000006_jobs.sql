-- +goose Up

CREATE TABLE jobs (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    type text NOT NULL CHECK (btrim(type) <> ''),
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'dead')),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    priority integer NOT NULL DEFAULT 0,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
    run_at timestamptz NOT NULL DEFAULT now(),
    locked_at timestamptz,
    locked_by text,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CHECK ((locked_at IS NULL) = (locked_by IS NULL))
);

CREATE INDEX jobs_claim_idx
    ON jobs (priority DESC, run_at, created_at)
    WHERE status = 'queued';