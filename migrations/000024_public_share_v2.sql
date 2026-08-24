-- +goose Up
ALTER TABLE public_shares
    ADD COLUMN expires_at timestamptz,
    ADD COLUMN password_hash text,
    ADD COLUMN allow_download boolean NOT NULL DEFAULT true,
    ADD COLUMN max_views bigint CHECK (max_views IS NULL OR max_views > 0),
    ADD COLUMN view_count bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0),
    ADD COLUMN max_downloads bigint CHECK (max_downloads IS NULL OR max_downloads > 0),
    ADD COLUMN download_count bigint NOT NULL DEFAULT 0 CHECK (download_count >= 0);

CREATE TABLE public_share_sessions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    share_id uuid NOT NULL REFERENCES public_shares(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    CHECK (expires_at > created_at)
);

CREATE INDEX public_share_sessions_share_expiry_idx ON public_share_sessions(share_id, expires_at);
