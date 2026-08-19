-- +goose Up

CREATE UNIQUE INDEX nodes_active_sibling_name_uq
    ON nodes (parent_id, name_key)
    WHERE deleted_at IS NULL AND parent_id IS NOT NULL;

DROP INDEX IF EXISTS nodes_parent_active_idx;

CREATE INDEX nodes_parent_active_idx
    ON nodes (parent_id, name_key, id)
    WHERE deleted_at IS NULL;

CREATE FUNCTION discloud_validate_node_parent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent_kind text;
    parent_owner uuid;
BEGIN
    IF NEW.parent_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT kind, owner_user_id
    INTO parent_kind, parent_owner
    FROM nodes
    WHERE id = NEW.parent_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'node parent does not exist'
            USING ERRCODE = '23514';
    END IF;

    IF parent_kind <> 'folder' THEN
        RAISE EXCEPTION 'node parent must be a folder'
            USING ERRCODE = '23514';
    END IF;

    IF parent_owner <> NEW.owner_user_id THEN
        RAISE EXCEPTION 'node and parent must have the same owner'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER nodes_parent_invariant
AFTER INSERT OR UPDATE ON nodes
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION discloud_validate_node_parent();

CREATE FUNCTION discloud_protect_root_node()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT OLD.is_root THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'root node cannot be deleted'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.is_root IS DISTINCT FROM OLD.is_root
        OR NEW.kind IS DISTINCT FROM OLD.kind
        OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
        OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
        OR NEW.name IS DISTINCT FROM OLD.name
        OR NEW.name_key IS DISTINCT FROM OLD.name_key
        OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
        OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
    THEN
        RAISE EXCEPTION 'root node is immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER nodes_protect_root_update
BEFORE UPDATE ON nodes
FOR EACH ROW
EXECUTE FUNCTION discloud_protect_root_node();

CREATE TRIGGER nodes_protect_root_delete
BEFORE DELETE ON nodes
FOR EACH ROW
EXECUTE FUNCTION discloud_protect_root_node();