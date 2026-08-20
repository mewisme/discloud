-- +goose Up

WITH thumbnail AS (
    INSERT INTO file_thumbnails (file_id, variant, status)
    SELECT node_id, 'grid', 'pending'
    FROM files
    WHERE metadata_status = 'ready'
      AND category IN ('image', 'video')
    ON CONFLICT (file_id, variant) DO NOTHING
    RETURNING file_id
)
INSERT INTO jobs (type, payload)
SELECT 'file.thumbnail', jsonb_build_object('fileId', file_id::text)
FROM thumbnail;
