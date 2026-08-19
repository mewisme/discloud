-- +goose Up

CREATE TABLE folder_permissions (
    folder_id uuid NOT NULL REFERENCES nodes(id),
    user_id uuid NOT NULL REFERENCES users(id),
    level text NOT NULL CHECK (level IN ('view', 'edit', 'full')),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (folder_id, user_id)
);

CREATE INDEX folder_permissions_user_idx
    ON folder_permissions (user_id, folder_id);

CREATE FUNCTION discloud_validate_folder_permission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    folder_kind text;
    folder_owner uuid;
BEGIN
    SELECT kind, owner_user_id
    INTO folder_kind, folder_owner
    FROM nodes
    WHERE id = NEW.folder_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'permission target does not exist'
            USING ERRCODE = '23514';
    END IF;

    IF folder_kind <> 'folder' THEN
        RAISE EXCEPTION 'permission target must be a folder'
            USING ERRCODE = '23514';
    END IF;

    IF folder_owner = NEW.user_id THEN
        RAISE EXCEPTION 'folder owner does not need an explicit grant'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER folder_permissions_target_invariant
AFTER INSERT OR UPDATE ON folder_permissions
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION discloud_validate_folder_permission();