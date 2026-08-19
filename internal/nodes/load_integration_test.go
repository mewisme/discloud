package nodes

import (
	"os"
	"strconv"
	"testing"
	"time"
)

func TestLoadLargeFolderListing(t *testing.T) {
	requireNodeLoadTest(t)

	ctx, pool := openNodeConcurrencyTestPool(t)
	userID, rootID := createTreeUser(
		t,
		ctx,
		pool,
		"folder-list-load-owner",
		false,
	)

	count := nodeLoadInt(
		"DISCLOUD_LOAD_FOLDER_CHILDREN",
		10000,
	)
	passes := nodeLoadInt(
		"DISCLOUD_LOAD_FOLDER_LIST_PASSES",
		3,
	)

	if _, err := pool.Exec(ctx, `
		INSERT INTO nodes (
			kind,
			owner_user_id,
			parent_id,
			name,
			name_key,
			created_by
		)
		SELECT
			'folder',
			$1::uuid,
			$2::uuid,
			'folder-' || lpad(g::text, 8, '0'),
			'folder-' || lpad(g::text, 8, '0'),
			$1::uuid
		FROM generate_series(1, $3) AS g
	`, userID, rootID, count); err != nil {
		t.Fatalf(
			"seed large folder: %v",
			err,
		)
	}

	if _, err := pool.Exec(
		ctx,
		"ANALYZE nodes",
	); err != nil {
		t.Fatalf(
			"analyze nodes: %v",
			err,
		)
	}

	service := New(pool)
	actor := Actor{
		UserID: userID,
	}

	started := time.Now()
	totalItems := 0

	for pass := range passes {
		afterNameKey := ""
		afterID := ""
		passItems := 0

		for {
			items, hasMore, err :=
				service.ListChildren(
					ctx,
					actor,
					rootID,
					100,
					afterNameKey,
					afterID,
				)
			if err != nil {
				t.Fatalf(
					"pass %d list children: %v",
					pass,
					err,
				)
			}

			passItems += len(items)

			if !hasMore {
				break
			}
			if len(items) == 0 {
				t.Fatal(
					"pagination reports more with empty page",
				)
			}

			last := items[len(items)-1]
			afterNameKey = last.NameKey
			afterID = last.ID
		}

		if passItems != count {
			t.Fatalf(
				"pass %d items=%d, want %d",
				pass,
				passItems,
				count,
			)
		}

		totalItems += passItems
	}

	elapsed := time.Since(started)

	t.Logf(
		"folder listing nodes=%d passes=%d elapsed=%s items/s=%.0f",
		count,
		passes,
		elapsed,
		float64(totalItems)/elapsed.Seconds(),
	)
}

func TestLoadLargeTrashTree(t *testing.T) {
	requireNodeLoadTest(t)

	ctx, pool := openNodeConcurrencyTestPool(t)
	userID, rootID := createTreeUser(
		t,
		ctx,
		pool,
		"trash-load-owner",
		false,
	)

	parents := nodeLoadInt(
		"DISCLOUD_LOAD_TRASH_PARENTS",
		100,
	)
	childrenPerParent := nodeLoadInt(
		"DISCLOUD_LOAD_TRASH_CHILDREN",
		50,
	)
	passes := nodeLoadInt(
		"DISCLOUD_LOAD_TRASH_PASSES",
		3,
	)

	if _, err := pool.Exec(ctx, `
		WITH parents AS (
			INSERT INTO nodes (
				kind,
				owner_user_id,
				parent_id,
				name,
				name_key,
				created_by,
				deleted_at,
				deleted_by
			)
			SELECT
				'folder',
				$1::uuid,
				$2::uuid,
				'trash-parent-' || lpad(g::text, 6, '0'),
				'trash-parent-' || lpad(g::text, 6, '0'),
				$1::uuid,
				now() - make_interval(secs => g),
				$1::uuid
			FROM generate_series(1, $3) AS g
			RETURNING id, name
		)
		INSERT INTO nodes (
			kind,
			owner_user_id,
			parent_id,
			name,
			name_key,
			created_by,
			deleted_at,
			deleted_by
		)
		SELECT
			'folder',
			$1::uuid,
			parent.id,
			parent.name || '-child-' ||
				lpad(child.g::text, 4, '0'),
			parent.name || '-child-' ||
				lpad(child.g::text, 4, '0'),
			$1::uuid,
			now(),
			$1::uuid
		FROM parents parent
		CROSS JOIN generate_series(1, $4) AS child(g)
	`, userID, rootID, parents, childrenPerParent); err != nil {
		t.Fatalf(
			"seed trash tree: %v",
			err,
		)
	}

	if _, err := pool.Exec(
		ctx,
		"ANALYZE nodes",
	); err != nil {
		t.Fatalf(
			"analyze nodes: %v",
			err,
		)
	}

	service := New(pool)
	actor := Actor{
		UserID: userID,
	}

	started := time.Now()
	totalVisible := 0

	for pass := range passes {
		var beforeDeletedAt *time.Time
		beforeID := ""
		passVisible := 0

		for {
			items, hasMore, err :=
				service.ListTrash(
					ctx,
					actor,
					"",
					100,
					beforeDeletedAt,
					beforeID,
				)
			if err != nil {
				t.Fatalf(
					"pass %d list trash: %v",
					pass,
					err,
				)
			}

			passVisible += len(items)

			if !hasMore {
				break
			}
			if len(items) == 0 {
				t.Fatal(
					"trash pagination reports more with empty page",
				)
			}

			last := items[len(items)-1]
			cursorTime := last.DeletedAt
			beforeDeletedAt = &cursorTime
			beforeID = last.ID
		}

		if passVisible != parents {
			t.Fatalf(
				"pass %d visible trash=%d, want top-level %d",
				pass,
				passVisible,
				parents,
			)
		}

		totalVisible += passVisible
	}

	elapsed := time.Since(started)
	totalNodes :=
		parents +
			parents*childrenPerParent

	t.Logf(
		"trash tree nodes=%d visible=%d passes=%d elapsed=%s visible-items/s=%.0f",
		totalNodes,
		parents,
		passes,
		elapsed,
		float64(totalVisible)/elapsed.Seconds(),
	)
}

func requireNodeLoadTest(t *testing.T) {
	t.Helper()

	if os.Getenv(
		"DISCLOUD_RUN_LOAD_TESTS",
	) != "1" {
		t.Skip(
			"set DISCLOUD_RUN_LOAD_TESTS=1 to run load tests",
		)
	}
}

func nodeLoadInt(
	name string,
	fallback int,
) int {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}

	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 {
		return fallback
	}

	return value
}
