-- +goose Up

CREATE TABLE public_shares (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    public_id text NOT NULL UNIQUE,

    resource_type text NOT NULL
        CHECK (resource_type IN ('node', 'collection')),

    node_id uuid REFERENCES nodes(id),
    collection_id uuid REFERENCES collections(id),

    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),

    revoked_at timestamptz,
    revoked_by uuid REFERENCES users(id),

    CHECK (
        (resource_type = 'node' AND node_id IS NOT NULL AND collection_id IS NULL)
        OR
        (resource_type = 'collection' AND collection_id IS NOT NULL AND node_id IS NULL)
    )
);

CREATE UNIQUE INDEX public_shares_active_node_uq
    ON public_shares (node_id)
    WHERE node_id IS NOT NULL AND revoked_at IS NULL;

CREATE UNIQUE INDEX public_shares_active_collection_uq
    ON public_shares (collection_id)
    WHERE collection_id IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX public_shares_created_by_idx
    ON public_shares (created_by, created_at DESC);

-- +goose StatementBegin
CREATE FUNCTION discloud_revoke_node_shares_on_trash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
        WITH RECURSIVE subtree AS (
            SELECT NEW.id

            UNION ALL

            SELECT child.id
            FROM nodes child
            JOIN subtree parent ON child.parent_id = parent.id
        )
        UPDATE public_shares
        SET revoked_at = now(),
            revoked_by = NEW.deleted_by
        WHERE revoked_at IS NULL
          AND node_id IN (SELECT id FROM subtree);
    END IF;

    RETURN NULL;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER nodes_revoke_public_shares_on_trash
AFTER UPDATE OF deleted_at ON nodes
FOR EACH ROW
EXECUTE FUNCTION discloud_revoke_node_shares_on_trash();

-- +goose StatementBegin
CREATE FUNCTION discloud_revoke_collection_share_on_trash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
        UPDATE public_shares
        SET revoked_at = now(),
            revoked_by = NEW.deleted_by
        WHERE revoked_at IS NULL
          AND collection_id = NEW.id;
    END IF;

    RETURN NULL;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER collections_revoke_public_share_on_trash
AFTER UPDATE OF deleted_at ON collections
FOR EACH ROW
EXECUTE FUNCTION discloud_revoke_collection_share_on_trash();