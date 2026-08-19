-- +goose Up

CREATE TABLE collections (
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    owner_user_id uuid NOT NULL REFERENCES users(id),
    name text NOT NULL,
    name_key text NOT NULL,
    description text,

    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    deleted_at timestamptz,
    deleted_by uuid REFERENCES users(id)
);

CREATE UNIQUE INDEX collections_owner_active_name_uq
    ON collections (owner_user_id, name_key)
    WHERE deleted_at IS NULL;

CREATE INDEX collections_owner_idx
    ON collections (owner_user_id, name_key, id);

CREATE INDEX collections_deleted_idx
    ON collections (deleted_at)
    WHERE deleted_at IS NOT NULL;

CREATE TABLE collection_items (
    collection_id uuid NOT NULL REFERENCES collections(id),
    file_id uuid NOT NULL REFERENCES files(node_id),
    added_by uuid NOT NULL REFERENCES users(id),
    added_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (collection_id, file_id)
);

CREATE INDEX collection_items_file_idx
    ON collection_items (file_id);

CREATE TABLE collection_permissions (
    collection_id uuid NOT NULL REFERENCES collections(id),
    user_id uuid NOT NULL REFERENCES users(id),
    level text NOT NULL CHECK (level IN ('view', 'edit', 'full')),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (collection_id, user_id)
);

CREATE INDEX collection_permissions_user_idx
    ON collection_permissions (user_id, collection_id);

-- +goose StatementBegin
CREATE FUNCTION discloud_validate_collection_permission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    collection_owner uuid;
BEGIN
    SELECT owner_user_id
    INTO collection_owner
    FROM collections
    WHERE id = NEW.collection_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'collection does not exist'
            USING ERRCODE = '23514';
    END IF;

    IF collection_owner = NEW.user_id THEN
        RAISE EXCEPTION 'collection owner does not need an explicit grant'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER collection_permissions_owner_invariant
AFTER INSERT OR UPDATE ON collection_permissions
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION discloud_validate_collection_permission();