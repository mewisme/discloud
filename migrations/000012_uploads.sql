-- +goose Up

CREATE TABLE files (
    node_id uuid PRIMARY KEY REFERENCES nodes(id),

    size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
    chunk_size_bytes integer NOT NULL CHECK (chunk_size_bytes > 0),

    sha256 bytea NULL
        CHECK (sha256 IS NULL OR octet_length(sha256) = 32),

    mime_type text NOT NULL DEFAULT 'application/octet-stream',
    extension text NULL,
    category text NOT NULL DEFAULT 'binary'
        CHECK (category IN (
            'image',
            'video',
            'audio',
            'document',
            'text',
            'archive',
            'application',
            'binary',
            'other'
        )),

    width integer NULL CHECK (width IS NULL OR width > 0),
    height integer NULL CHECK (height IS NULL OR height > 0),
    duration_ms bigint NULL CHECK (duration_ms IS NULL OR duration_ms >= 0),
    bitrate_bps bigint NULL CHECK (bitrate_bps IS NULL OR bitrate_bps >= 0),
    codec text NULL,

    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata_status text NOT NULL DEFAULT 'pending'
        CHECK (metadata_status IN ('pending', 'ready', 'failed', 'skipped')),
    metadata_error text NULL,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX files_mime_idx ON files (mime_type);
CREATE INDEX files_category_idx ON files (category);
CREATE INDEX files_size_idx ON files (size_bytes);
CREATE INDEX files_sha_idx ON files (sha256) WHERE sha256 IS NOT NULL;

CREATE TABLE file_chunks (
    file_id uuid NOT NULL REFERENCES files(node_id),
    part_index integer NOT NULL CHECK (part_index >= 0),
    chunk_id uuid NOT NULL REFERENCES chunks(id),
    part_size_bytes integer NOT NULL CHECK (part_size_bytes > 0),

    PRIMARY KEY (file_id, part_index)
);

CREATE INDEX file_chunks_chunk_idx ON file_chunks (chunk_id);

CREATE TABLE upload_sessions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),

    actor_user_id uuid NOT NULL REFERENCES users(id),
    owner_user_id uuid NOT NULL REFERENCES users(id),
    parent_folder_id uuid NOT NULL REFERENCES nodes(id),

    name text NOT NULL,
    name_key text NOT NULL,

    size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
    chunk_size_bytes integer NOT NULL CHECK (chunk_size_bytes > 0),
    expected_parts integer NOT NULL CHECK (expected_parts >= 0),

    mime_type_hint text NULL,
    file_sha256 bytea NULL
        CHECK (file_sha256 IS NULL OR octet_length(file_sha256) = 32),

    reserved_bytes bigint NOT NULL CHECK (reserved_bytes >= 0),

    status text NOT NULL DEFAULT 'open'
        CHECK (status IN (
            'open',
            'completing',
            'completed',
            'cancelled',
            'expired',
            'failed'
        )),

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    completed_at timestamptz NULL,
    closed_at timestamptz NULL,

    committed_file_id uuid NULL REFERENCES files(node_id)
);

CREATE INDEX upload_sessions_owner_open_idx
    ON upload_sessions (owner_user_id, expires_at)
    WHERE status IN ('open', 'completing');

CREATE INDEX upload_sessions_expiry_idx
    ON upload_sessions (expires_at)
    WHERE status = 'open';

CREATE TABLE upload_parts (
    upload_id uuid NOT NULL REFERENCES upload_sessions(id),
    part_index integer NOT NULL CHECK (part_index >= 0),
    chunk_id uuid NOT NULL REFERENCES chunks(id),
    part_size_bytes integer NOT NULL CHECK (part_size_bytes > 0),
    sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (upload_id, part_index)
);

CREATE INDEX upload_parts_chunk_idx ON upload_parts (chunk_id);

CREATE TABLE chunk_upload_attempts (
    id uuid PRIMARY KEY DEFAULT uuidv7(),

    upload_session_id uuid NOT NULL REFERENCES upload_sessions(id),
    part_number integer NOT NULL CHECK (part_number >= 0),
    attempt_number smallint NOT NULL
        CHECK (attempt_number BETWEEN 1 AND 5),

    discord_bot_user_id text NOT NULL
        CHECK (btrim(discord_bot_user_id) <> ''),

    status text NOT NULL
        CHECK (status IN ('started', 'succeeded', 'failed')),

    error_class text NULL,
    error_message text NULL,

    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz NULL,

    UNIQUE (
        upload_session_id,
        part_number,
        attempt_number
    ),

    UNIQUE (
        upload_session_id,
        part_number,
        discord_bot_user_id
    )
);

CREATE INDEX chunk_upload_attempts_part_idx
    ON chunk_upload_attempts (
        upload_session_id,
        part_number,
        attempt_number
    );