-- +goose Up

INSERT INTO jobs (type, payload)
SELECT
    'file.thumbnail',
    jsonb_build_object('fileId', thumbnail.file_id::text)
FROM file_thumbnails thumbnail
JOIN files file ON file.node_id = thumbnail.file_id
WHERE thumbnail.variant = 'grid'
  AND thumbnail.status = 'pending'
  AND file.metadata_status = 'ready'
  AND file.category IN ('image', 'video')
  AND NOT EXISTS (
      SELECT 1
      FROM jobs job
      WHERE job.type = 'file.thumbnail'
        AND job.payload->>'fileId' = thumbnail.file_id::text
        AND job.status IN ('queued', 'running')
  );