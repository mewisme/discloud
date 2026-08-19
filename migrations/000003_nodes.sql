-- +goose Up

CREATE TABLE nodes (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('file', 'folder')),
    owner_user_id uuid NOT NULL REFERENCES users(id),
    parent_id uuid REFERENCES nodes(id),
    name text NOT NULL,
    name_key text NOT NULL,
    is_root boolean NOT NULL DEFAULT false,
    is_favorite boolean NOT NULL DEFAULT false,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    deleted_by uuid REFERENCES users(id),
    CHECK (is_root OR parent_id IS NOT NULL),
    CHECK (NOT is_root OR (kind = 'folder' AND parent_id IS NULL)),
    CHECK (NOT is_root OR (deleted_at IS NULL AND deleted_by IS NULL))
);

CREATE UNIQUE INDEX nodes_user_root_uq ON nodes (owner_user_id) WHERE is_root;
CREATE INDEX nodes_parent_active_idx ON nodes (parent_id) WHERE deleted_at IS NULL;
CREATE INDEX nodes_owner_idx ON nodes (owner_user_id);
CREATE INDEX nodes_deleted_idx ON nodes (deleted_at) WHERE deleted_at IS NOT NULL;