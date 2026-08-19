-- +goose Up

CREATE TABLE chunks (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),

    discord_channel_id text NOT NULL CHECK (btrim(discord_channel_id) <> ''),
    discord_message_id text NOT NULL CHECK (btrim(discord_message_id) <> ''),
    discord_attachment_id text NOT NULL CHECK (btrim(discord_attachment_id) <> ''),

    status text NOT NULL DEFAULT 'uncommitted'
        CHECK (status IN ('uncommitted', 'ready')),

    created_at timestamptz NOT NULL DEFAULT now(),
    committed_at timestamptz,

    CHECK (
        (status = 'uncommitted' AND committed_at IS NULL)
        OR
        (status = 'ready' AND committed_at IS NOT NULL)
    ),

    UNIQUE (sha256, size_bytes),
    UNIQUE (discord_channel_id, discord_message_id)
);

CREATE INDEX chunks_uncommitted_created_idx
    ON chunks (created_at)
    WHERE status = 'uncommitted';