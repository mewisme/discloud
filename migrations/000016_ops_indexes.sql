-- +goose Up

CREATE INDEX jobs_diagnostics_idx
    ON jobs (status, updated_at DESC, id DESC);

CREATE INDEX upload_sessions_diagnostics_idx
    ON upload_sessions (status, updated_at DESC, id DESC);

CREATE INDEX chunk_upload_attempts_failed_idx
    ON chunk_upload_attempts (upload_session_id, started_at DESC)
    WHERE status = 'failed';