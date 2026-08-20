-- +goose Up

CREATE TABLE user_config (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_config (
    key text PRIMARY KEY
        CHECK (char_length(key) BETWEEN 1 AND 128)
        CHECK (key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
    value jsonb NOT NULL,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);