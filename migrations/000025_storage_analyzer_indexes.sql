-- +goose Up

CREATE INDEX nodes_owner_parent_idx ON nodes (owner_user_id, parent_id);
