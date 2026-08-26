package adminusers

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/audit"
	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/postgres"
)

var (
	ErrUserNotFound    = errors.New("user not found")
	ErrUsernameTaken   = errors.New("username already exists")
	ErrInvalidRole     = errors.New("invalid role")
	ErrInvalidQuota    = errors.New("invalid storage quota")
	ErrNoChanges       = errors.New("no changes supplied")
	ErrLastActiveAdmin = errors.New("at least one active administrator is required")
)

const adminMutationLockID int64 = 0x6469736361646d6e

type Service struct {
	pool *pgxpool.Pool
}

type User struct {
	ID                   string
	Username             string
	Name                 string
	Role                 string
	Status               string
	StorageQuotaBytes    *int64
	StorageUsedBytes     int64
	StorageReservedBytes int64
	MustChangePassword   bool
	HasAvatar            bool
	AvatarRevision       int64
	CreatedAt            time.Time
	UpdatedAt            time.Time
	DisabledAt           *time.Time
}

type CreateInput struct {
	Name              string
	Username          string
	Password          string
	Role              string
	StorageQuotaBytes *int64
}

type UpdateInput struct {
	Name *string
	Role *string
}

type ListResult struct {
	Users []User
	Total int64
}

type Usage struct {
	QuotaBytes     *int64
	UsedBytes      int64
	ReservedBytes  int64
	AvailableBytes *int64
	OverQuota      bool
}

type Root struct {
	ID   string
	Name string
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) Create(ctx context.Context, actorUserID string, input CreateInput) (User, error) {
	name, err := auth.NormalizeName(input.Name)
	if err != nil {
		return User{}, err
	}
	username, err := auth.NormalizeUsername(input.Username)
	if err != nil {
		return User{}, err
	}
	if err := auth.ValidateTemporaryPassword(input.Password); err != nil {
		return User{}, err
	}

	role := input.Role
	if role == "" {
		role = "user"
	}
	if !validRole(role) {
		return User{}, ErrInvalidRole
	}
	if input.StorageQuotaBytes != nil && *input.StorageQuotaBytes < 0 {
		return User{}, ErrInvalidQuota
	}

	passwordHash, err := auth.HashPassword(input.Password)
	if err != nil {
		return User{}, fmt.Errorf("hash password: %w", err)
	}

	var user User
	err = postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			INSERT INTO users (
				username,
				name,
				password_hash,
				role,
				storage_quota_bytes,
				must_change_password
			)
			VALUES ($1, $2, $3, $4, $5, true)
			RETURNING
				id::text,
				username::text,
				name,
				role,
				status,
				storage_quota_bytes,
				storage_used_bytes,
				storage_reserved_bytes,
				must_change_password,
				avatar_object_id IS NOT NULL,
				avatar_revision,
				created_at,
				updated_at,
				disabled_at
		`,
			username,
			name,
			passwordHash,
			role,
			input.StorageQuotaBytes,
		).Scan(
			&user.ID,
			&user.Username,
			&user.Name,
			&user.Role,
			&user.Status,
			&user.StorageQuotaBytes,
			&user.StorageUsedBytes,
			&user.StorageReservedBytes,
			&user.MustChangePassword,
			&user.HasAvatar,
			&user.AvatarRevision,
			&user.CreatedAt,
			&user.UpdatedAt,
			&user.DisabledAt,
		)
		if err != nil {
			return fmt.Errorf("create user: %w", err)
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO nodes (
				kind,
				owner_user_id,
				name,
				name_key,
				is_root,
				created_by
			)
			VALUES ('folder', $1, '', '', true, $2)
		`, user.ID, actorUserID); err != nil {
			return fmt.Errorf("create user root: %w", err)
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actorUserID,
			Action:       "user.create",
			ResourceType: "user",
			ResourceID:   user.ID,
			Metadata: map[string]any{
				"role":              role,
				"storageQuotaBytes": input.StorageQuotaBytes,
			},
		})
	})
	if err != nil {
		if isUniqueViolation(err) {
			return User{}, ErrUsernameTaken
		}
		return User{}, err
	}

	return user, nil
}

func (s *Service) Get(ctx context.Context, userID string) (User, error) {
	var user User
	err := s.pool.QueryRow(ctx, `
		SELECT
			id::text,
			username::text,
			name,
			role,
			status,
			storage_quota_bytes,
			storage_used_bytes,
			storage_reserved_bytes,
			must_change_password,
			avatar_object_id IS NOT NULL,
			avatar_revision,
			created_at,
			updated_at,
			disabled_at
		FROM users
		WHERE id::text = $1
	`, userID).Scan(
		&user.ID,
		&user.Username,
		&user.Name,
		&user.Role,
		&user.Status,
		&user.StorageQuotaBytes,
		&user.StorageUsedBytes,
		&user.StorageReservedBytes,
		&user.MustChangePassword,
		&user.HasAvatar,
		&user.AvatarRevision,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.DisabledAt,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUserNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("get user: %w", err)
	}
	return user, nil
}

func (s *Service) List(ctx context.Context, limit, offset int) (ListResult, error) {
	var result ListResult
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&result.Total); err != nil {
		return ListResult{}, fmt.Errorf("count users: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			id::text,
			username::text,
			name,
			role,
			status,
			storage_quota_bytes,
			storage_used_bytes,
			storage_reserved_bytes,
			must_change_password,
			avatar_object_id IS NOT NULL,
			avatar_revision,
			created_at,
			updated_at,
			disabled_at
		FROM users
		ORDER BY created_at DESC, id DESC
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		return ListResult{}, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	result.Users = make([]User, 0)
	for rows.Next() {
		var user User
		if err := rows.Scan(
			&user.ID,
			&user.Username,
			&user.Name,
			&user.Role,
			&user.Status,
			&user.StorageQuotaBytes,
			&user.StorageUsedBytes,
			&user.StorageReservedBytes,
			&user.MustChangePassword,
			&user.HasAvatar,
			&user.AvatarRevision,
			&user.CreatedAt,
			&user.UpdatedAt,
			&user.DisabledAt,
		); err != nil {
			return ListResult{}, fmt.Errorf("scan user: %w", err)
		}
		result.Users = append(result.Users, user)
	}

	if err := rows.Err(); err != nil {
		return ListResult{}, fmt.Errorf("read users: %w", err)
	}
	return result, nil
}

func (s *Service) Update(ctx context.Context, actorUserID, userID string, input UpdateInput) (User, error) {
	if input.Name == nil && input.Role == nil {
		return User{}, ErrNoChanges
	}

	var name *string
	if input.Name != nil {
		value, err := auth.NormalizeName(*input.Name)
		if err != nil {
			return User{}, err
		}
		name = &value
	}

	if input.Role != nil && !validRole(*input.Role) {
		return User{}, ErrInvalidRole
	}

	var user User
	err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if input.Role != nil {
			if err := lockAdminMutations(ctx, tx); err != nil {
				return err
			}
			if err := ensureAdminMutationAllowed(ctx, tx, userID, *input.Role, ""); err != nil {
				return err
			}
		}
		err := tx.QueryRow(ctx, `
			UPDATE users
			SET name = COALESCE($2, name),
			    role = COALESCE($3, role),
			    updated_at = now()
			WHERE id::text = $1
			RETURNING
				id::text,
				username::text,
				name,
				role,
				status,
				storage_quota_bytes,
				storage_used_bytes,
				storage_reserved_bytes,
				must_change_password,
				avatar_object_id IS NOT NULL,
				avatar_revision,
				created_at,
				updated_at,
				disabled_at
		`, userID, name, input.Role).Scan(
			&user.ID,
			&user.Username,
			&user.Name,
			&user.Role,
			&user.Status,
			&user.StorageQuotaBytes,
			&user.StorageUsedBytes,
			&user.StorageReservedBytes,
			&user.MustChangePassword,
			&user.HasAvatar,
			&user.AvatarRevision,
			&user.CreatedAt,
			&user.UpdatedAt,
			&user.DisabledAt,
		)

		if errors.Is(err, pgx.ErrNoRows) {
			return ErrUserNotFound
		}
		if err != nil {
			return fmt.Errorf("update user: %w", err)
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actorUserID,
			Action:       "user.update",
			ResourceType: "user",
			ResourceID:   userID,
		})
	})
	if err != nil {
		return User{}, err
	}
	return user, nil
}

func (s *Service) Disable(ctx context.Context, actorUserID, userID string) error {
	return s.setStatus(ctx, actorUserID, userID, "disabled")
}

func (s *Service) Enable(ctx context.Context, actorUserID, userID string) error {
	return s.setStatus(ctx, actorUserID, userID, "active")
}

func (s *Service) SetQuota(ctx context.Context, actorUserID, userID string, quota *int64) error {
	if quota != nil && *quota < 0 {
		return ErrInvalidQuota
	}

	return postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE users
			SET storage_quota_bytes = $2,
			    updated_at = now()
			WHERE id::text = $1
		`, userID, quota)
		if err != nil {
			return fmt.Errorf("update quota: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return ErrUserNotFound
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actorUserID,
			Action:       "user.quota_update",
			ResourceType: "user",
			ResourceID:   userID,
			Metadata: map[string]any{
				"storageQuotaBytes": quota,
			},
		})
	})
}

func (s *Service) ResetPassword(ctx context.Context, actorUserID, userID, password string) error {
	if err := auth.ValidateTemporaryPassword(password); err != nil {
		return err
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	return postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE users
			SET password_hash = $2,
			    password_changed_at = now(),
			    must_change_password = true,
			    updated_at = now()
			WHERE id::text = $1
		`, userID, hash)
		if err != nil {
			return fmt.Errorf("reset password: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return ErrUserNotFound
		}

		if _, err := tx.Exec(ctx, `
			UPDATE sessions
			SET revoked_at = COALESCE(revoked_at, now())
			WHERE user_id::text = $1
			  AND revoked_at IS NULL
		`, userID); err != nil {
			return fmt.Errorf("revoke sessions: %w", err)
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actorUserID,
			Action:       "user.password_reset",
			ResourceType: "user",
			ResourceID:   userID,
		})
	})
}

func (s *Service) Usage(ctx context.Context, userID string) (Usage, error) {
	var usage Usage
	err := s.pool.QueryRow(ctx, `
		SELECT storage_quota_bytes, storage_used_bytes, storage_reserved_bytes
		FROM users
		WHERE id::text = $1
	`, userID).Scan(
		&usage.QuotaBytes,
		&usage.UsedBytes,
		&usage.ReservedBytes,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return Usage{}, ErrUserNotFound
	}
	if err != nil {
		return Usage{}, fmt.Errorf("get usage: %w", err)
	}

	if usage.QuotaBytes != nil {
		available := *usage.QuotaBytes - usage.UsedBytes - usage.ReservedBytes
		if available < 0 {
			usage.OverQuota = true
			available = 0
		}
		usage.AvailableBytes = &available
	}

	return usage, nil
}

func (s *Service) Root(ctx context.Context, userID string) (Root, error) {
	var root Root
	err := s.pool.QueryRow(ctx, `
		SELECT n.id::text, n.name
		FROM users u
		JOIN nodes n
		  ON n.owner_user_id = u.id
		 AND n.is_root
		WHERE u.id::text = $1
	`, userID).Scan(&root.ID, &root.Name)

	if errors.Is(err, pgx.ErrNoRows) {
		return Root{}, ErrUserNotFound
	}
	if err != nil {
		return Root{}, fmt.Errorf("get user root: %w", err)
	}
	return root, nil
}

func (s *Service) setStatus(ctx context.Context, actorUserID, userID, status string) error {
	return postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockAdminMutations(ctx, tx); err != nil {
			return err
		}
		if err := ensureAdminMutationAllowed(ctx, tx, userID, "", status); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			UPDATE users
			SET status = $2,
			    disabled_at = CASE WHEN $2 = 'disabled' THEN now() ELSE NULL END,
			    updated_at = now()
			WHERE id::text = $1
		`, userID, status)
		if err != nil {
			return fmt.Errorf("update user status: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return ErrUserNotFound
		}

		if status == "disabled" {
			if _, err := tx.Exec(ctx, `
				UPDATE sessions
				SET revoked_at = COALESCE(revoked_at, now())
				WHERE user_id::text = $1
				  AND revoked_at IS NULL
			`, userID); err != nil {
				return fmt.Errorf("revoke sessions: %w", err)
			}
		}

		return audit.Append(ctx, tx, audit.Event{
			ActorUserID:  actorUserID,
			Action:       "user." + status,
			ResourceType: "user",
			ResourceID:   userID,
		})
	})
}

func lockAdminMutations(ctx context.Context, tx pgx.Tx) error {
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", adminMutationLockID); err != nil {
		return fmt.Errorf("lock administrator mutation: %w", err)
	}
	return nil
}

func ensureAdminMutationAllowed(ctx context.Context, tx pgx.Tx, userID, nextRole, nextStatus string) error {
	var role, status string
	if err := tx.QueryRow(ctx, `
		SELECT role, status
		FROM users
		WHERE id::text = $1
		FOR UPDATE
	`, userID).Scan(&role, &status); errors.Is(err, pgx.ErrNoRows) {
		return ErrUserNotFound
	} else if err != nil {
		return fmt.Errorf("read administrator state: %w", err)
	}

	if nextRole == "" {
		nextRole = role
	}
	if nextStatus == "" {
		nextStatus = status
	}
	if role != "admin" || status != "active" || (nextRole == "admin" && nextStatus == "active") {
		return nil
	}

	var admins int
	if err := tx.QueryRow(ctx, `
		SELECT count(*)
		FROM users
		WHERE role = 'admin' AND status = 'active'
	`).Scan(&admins); err != nil {
		return fmt.Errorf("count active administrators: %w", err)
	}
	if admins <= 1 {
		return ErrLastActiveAdmin
	}
	return nil
}

func validRole(role string) bool {
	return role == "user" || role == "admin"
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
