-- +goose Up
CREATE TABLE file_versions (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    file_id uuid NOT NULL REFERENCES files(node_id) ON DELETE CASCADE,
    revision bigint NOT NULL CHECK (revision > 0),
    name text NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
    chunk_size_bytes integer NOT NULL CHECK (chunk_size_bytes > 0),
    sha256 bytea NULL CHECK (sha256 IS NULL OR octet_length(sha256) = 32),
    mime_type text NOT NULL DEFAULT 'application/octet-stream',
    extension text NULL,
    category text NOT NULL DEFAULT 'binary' CHECK (category IN ('image', 'video', 'audio', 'document', 'text', 'archive', 'application', 'binary', 'other')),
    width integer NULL,
    height integer NULL,
    duration_ms bigint NULL,
    bitrate_bps bigint NULL,
    codec text NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata_status text NOT NULL DEFAULT 'pending' CHECK (metadata_status IN ('pending', 'ready', 'failed', 'skipped')),
    metadata_error text NULL,
    created_by uuid NOT NULL REFERENCES users(id),
    restored_from_version_id uuid NULL REFERENCES file_versions(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (file_id, revision)
);

CREATE INDEX file_versions_file_created_idx ON file_versions(file_id, created_at DESC, id DESC);

CREATE TABLE file_version_chunks (
    version_id uuid NOT NULL REFERENCES file_versions(id) ON DELETE CASCADE,
    part_index integer NOT NULL CHECK (part_index >= 0),
    chunk_id uuid NOT NULL REFERENCES chunks(id),
    part_size_bytes integer NOT NULL CHECK (part_size_bytes > 0),
    PRIMARY KEY (version_id, part_index)
);

CREATE INDEX file_version_chunks_chunk_idx ON file_version_chunks(chunk_id);

ALTER TABLE files ADD COLUMN current_version_id uuid NULL;
ALTER TABLE upload_sessions ADD COLUMN target_file_id uuid NULL REFERENCES files(node_id) ON DELETE SET NULL;

WITH seeded AS (
    INSERT INTO file_versions (
        file_id, revision, name, size_bytes, chunk_size_bytes, sha256, mime_type, extension, category,
        width, height, duration_ms, bitrate_bps, codec, metadata, metadata_status, metadata_error,
        created_by, created_at
    )
    SELECT
        f.node_id, 1, n.name, f.size_bytes, f.chunk_size_bytes, f.sha256, f.mime_type, f.extension, f.category,
        f.width, f.height, f.duration_ms, f.bitrate_bps, f.codec, f.metadata, f.metadata_status, f.metadata_error,
        n.created_by, f.created_at
    FROM files f
    JOIN nodes n ON n.id = f.node_id
    RETURNING id, file_id
)
UPDATE files f
SET current_version_id = seeded.id
FROM seeded
WHERE seeded.file_id = f.node_id;

INSERT INTO file_version_chunks (version_id, part_index, chunk_id, part_size_bytes)
SELECT v.id, fc.part_index, fc.chunk_id, fc.part_size_bytes
FROM file_versions v
JOIN file_chunks fc ON fc.file_id = v.file_id
WHERE v.revision = 1;

ALTER TABLE files ADD CONSTRAINT files_current_version_fk FOREIGN KEY (current_version_id) REFERENCES file_versions(id) ON DELETE SET NULL;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION sync_current_file_version_metadata() RETURNS trigger AS $$
BEGIN
    IF NEW.current_version_id IS NOT NULL THEN
        UPDATE file_versions
        SET name = (SELECT name FROM nodes WHERE id = NEW.node_id),
            size_bytes = NEW.size_bytes,
            chunk_size_bytes = NEW.chunk_size_bytes,
            sha256 = NEW.sha256,
            mime_type = NEW.mime_type,
            extension = NEW.extension,
            category = NEW.category,
            width = NEW.width,
            height = NEW.height,
            duration_ms = NEW.duration_ms,
            bitrate_bps = NEW.bitrate_bps,
            codec = NEW.codec,
            metadata = NEW.metadata,
            metadata_status = NEW.metadata_status,
            metadata_error = NEW.metadata_error
        WHERE id = NEW.current_version_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER files_sync_current_version_metadata
AFTER UPDATE OF current_version_id, size_bytes, chunk_size_bytes, sha256, mime_type, extension, category, width, height, duration_ms, bitrate_bps, codec, metadata, metadata_status, metadata_error
ON files FOR EACH ROW EXECUTE FUNCTION sync_current_file_version_metadata();
