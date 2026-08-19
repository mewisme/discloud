-- +goose Up

CREATE INDEX nodes_name_trgm_idx
    ON nodes USING gin (name gin_trgm_ops);

CREATE INDEX nodes_favorite_active_idx
    ON nodes (owner_user_id, name_key, id)
    WHERE deleted_at IS NULL AND is_favorite;

CREATE INDEX nodes_created_idx
    ON nodes (created_at, id);

CREATE INDEX nodes_updated_idx
    ON nodes (updated_at, id);