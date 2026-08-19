-- +goose Up

CREATE TABLE mfa_totp (
    user_id uuid PRIMARY KEY REFERENCES users(id),
    secret_ciphertext bytea NOT NULL,
    key_version integer NOT NULL DEFAULT 1 CHECK (key_version > 0),
    confirmed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mfa_enrollments (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id uuid NOT NULL UNIQUE REFERENCES users(id),
    secret_ciphertext bytea NOT NULL,
    key_version integer NOT NULL DEFAULT 1 CHECK (key_version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX mfa_enrollments_expiry_idx ON mfa_enrollments (expires_at);

CREATE TABLE mfa_recovery_codes (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id uuid NOT NULL REFERENCES users(id),
    code_hash bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    used_at timestamptz,
    UNIQUE (user_id, code_hash)
);

CREATE INDEX mfa_recovery_codes_unused_idx
    ON mfa_recovery_codes (user_id)
    WHERE used_at IS NULL;

CREATE TABLE login_challenges (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id uuid NOT NULL REFERENCES users(id),
    token_hash bytea NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz
);

CREATE INDEX login_challenges_expiry_idx
    ON login_challenges (expires_at)
    WHERE consumed_at IS NULL;