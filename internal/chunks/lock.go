package chunks

import (
	"context"
	"fmt"
	"time"

	"github.com/mewisme/discloud/internal/blobstore"
)

const digestUnlockTimeout = 5 * time.Second

func (r *Repository) WithDigestLock(ctx context.Context, digest [32]byte, size int64, fn func() error) (err error) {
	if r == nil || r.pool == nil || size <= 0 || fn == nil {
		return blobstore.ErrInvalidChunk
	}

	conn, err := r.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire chunk digest lock connection: %w", err)
	}

	locked := false
	defer func() {
		if locked {
			unlockCtx, cancel := context.WithTimeout(context.Background(), digestUnlockTimeout)
			defer cancel()

			var unlocked bool
			unlockErr := conn.QueryRow(unlockCtx, `
				SELECT pg_advisory_unlock(
					hashtextextended(
						encode($1::bytea, 'hex') || ':' || ($2::bigint)::text,
						0
					)
				)
			`, digest[:], size).Scan(&unlocked)

			if unlockErr != nil || !unlocked {
				_ = conn.Conn().Close(unlockCtx)
				if err == nil {
					if unlockErr != nil {
						err = fmt.Errorf("release chunk digest lock: %w", unlockErr)
					} else {
						err = fmt.Errorf("release chunk digest lock: lock was not held")
					}
				}
			}
		}

		conn.Release()
	}()

	if _, err := conn.Exec(ctx, `
		SELECT pg_advisory_lock(
			hashtextextended(
				encode($1::bytea, 'hex') || ':' || ($2::bigint)::text,
				0
			)
		)
	`, digest[:], size); err != nil {
		return fmt.Errorf("acquire chunk digest lock: %w", err)
	}

	locked = true
	return fn()
}
