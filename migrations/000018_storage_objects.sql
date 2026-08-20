-- +goose Up

CREATE TABLE storage_objects (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    kind text NOT NULL CHECK (kind IN ('avatar', 'thumbnail', 'other')),
    sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
    size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
    mime_type text NOT NULL CHECK (btrim(mime_type) <> ''),
    filename text NOT NULL CHECK (btrim(filename) <> ''),
    discord_channel_id text NOT NULL CHECK (btrim(discord_channel_id) <> ''),
    discord_message_id text NOT NULL CHECK (btrim(discord_message_id) <> ''),
    discord_attachment_id text NOT NULL CHECK (btrim(discord_attachment_id) <> ''),
    uploaded_by_bot_user_id text NOT NULL CHECK (btrim(uploaded_by_bot_user_id) <> ''),
    cached_cdn_url text,
    cached_cdn_url_expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((cached_cdn_url IS NULL) = (cached_cdn_url_expires_at IS NULL)),
    UNIQUE (discord_channel_id, discord_message_id)
);

CREATE INDEX storage_objects_created_idx ON storage_objects (created_at);

ALTER TABLE users
    ADD COLUMN avatar_object_id uuid REFERENCES storage_objects(id),
    ADD COLUMN avatar_revision bigint NOT NULL DEFAULT 0 CHECK (avatar_revision >= 0);

CREATE TABLE file_thumbnails (
    file_id uuid NOT NULL REFERENCES files(node_id) ON DELETE CASCADE,
    variant text NOT NULL DEFAULT 'grid' CHECK (variant = 'grid'),
    object_id uuid REFERENCES storage_objects(id),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'ready', 'failed', 'skipped')),
    width integer CHECK (width IS NULL OR width > 0),
    height integer CHECK (height IS NULL OR height > 0),
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (file_id, variant),
    CHECK (
        (status = 'ready' AND object_id IS NOT NULL)
        OR
        (status <> 'ready' AND object_id IS NULL)
    )
);

CREATE INDEX file_thumbnails_status_idx ON file_thumbnails (status, updated_at);