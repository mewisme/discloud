package uploads

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/mewisme/discloud/internal/postgres"
)

const MaxDistinctChunkUploadAttempts = 5

var (
	ErrInvalidPart       = errors.New("invalid upload part")
	ErrBotAlreadyTried   = errors.New("Discord bot already tried for this part")
	ErrAttemptsExhausted = errors.New("chunk upload attempts exhausted")
	ErrAttemptNotFound   = errors.New("chunk upload attempt not found")
	ErrAttemptClosed     = errors.New("chunk upload attempt already finished")
)

type AttemptStatus string

const (
	AttemptStarted   AttemptStatus = "started"
	AttemptSucceeded AttemptStatus = "succeeded"
	AttemptFailed    AttemptStatus = "failed"
)

type Attempt struct {
	ID               string
	UploadSessionID  string
	PartNumber       int
	AttemptNumber    int
	DiscordBotUserID string
	Status           AttemptStatus
	ErrorClass       string
	ErrorMessage     string
	StartedAt        time.Time
	FinishedAt       *time.Time
}

func (s *Service) UsedBotIDs(
	ctx context.Context,
	sessionID string,
	partNumber int,
) ([]string, error) {
	if partNumber < 0 {
		return nil, ErrInvalidPart
	}

	rows, err := s.pool.Query(ctx, `
		SELECT discord_bot_user_id
		FROM chunk_upload_attempts
		WHERE upload_session_id::text = $1
		  AND part_number = $2
		ORDER BY attempt_number
	`, sessionID, partNumber)
	if err != nil {
		return nil, fmt.Errorf("list chunk upload bots: %w", err)
	}
	defer rows.Close()

	bots := make([]string, 0, MaxDistinctChunkUploadAttempts)

	for rows.Next() {
		var bot string
		if err := rows.Scan(&bot); err != nil {
			return nil, fmt.Errorf("scan chunk upload bot: %w", err)
		}
		bots = append(bots, bot)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read chunk upload bots: %w", err)
	}

	return bots, nil
}

func (s *Service) StartAttempt(
	ctx context.Context,
	sessionID string,
	partNumber int,
	botUserID string,
) (Attempt, error) {
	botUserID = strings.TrimSpace(botUserID)

	if partNumber < 0 || botUserID == "" {
		return Attempt{}, ErrInvalidPart
	}

	var attempt Attempt

	err := postgres.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		var (
			status        Status
			expectedParts int
			active        bool
		)

		err := tx.QueryRow(ctx, `
			SELECT
				status,
				expected_parts,
				expires_at > now()
			FROM upload_sessions
			WHERE id::text = $1
			FOR UPDATE
		`, sessionID).Scan(
			&status,
			&expectedParts,
			&active,
		)

		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("lock upload for attempt: %w", err)
		}

		if status != StatusOpen {
			return ErrSessionClosed
		}
		if !active {
			return ErrSessionExpired
		}
		if partNumber >= expectedParts {
			return ErrInvalidPart
		}

		var tried bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM chunk_upload_attempts
				WHERE upload_session_id::text = $1
				  AND part_number = $2
				  AND discord_bot_user_id = $3
			)
		`, sessionID, partNumber, botUserID).Scan(&tried); err != nil {
			return fmt.Errorf("check previous bot attempt: %w", err)
		}
		if tried {
			return ErrBotAlreadyTried
		}

		var attemptNumber int
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(MAX(attempt_number), 0)
			FROM chunk_upload_attempts
			WHERE upload_session_id::text = $1
			  AND part_number = $2
		`, sessionID, partNumber).Scan(&attemptNumber); err != nil {
			return fmt.Errorf("count chunk attempts: %w", err)
		}

		if attemptNumber >= MaxDistinctChunkUploadAttempts {
			return ErrAttemptsExhausted
		}

		attemptNumber++

		err = tx.QueryRow(ctx, `
			INSERT INTO chunk_upload_attempts (
				upload_session_id,
				part_number,
				attempt_number,
				discord_bot_user_id,
				status
			)
			VALUES (
				$1::uuid,
				$2,
				$3,
				$4,
				'started'
			)
			RETURNING
				id::text,
				upload_session_id::text,
				part_number,
				attempt_number,
				discord_bot_user_id,
				status,
				COALESCE(error_class, ''),
				COALESCE(error_message, ''),
				started_at,
				finished_at
		`,
			sessionID,
			partNumber,
			attemptNumber,
			botUserID,
		).Scan(
			&attempt.ID,
			&attempt.UploadSessionID,
			&attempt.PartNumber,
			&attempt.AttemptNumber,
			&attempt.DiscordBotUserID,
			&attempt.Status,
			&attempt.ErrorClass,
			&attempt.ErrorMessage,
			&attempt.StartedAt,
			&attempt.FinishedAt,
		)
		if err != nil {
			return fmt.Errorf("start chunk upload attempt: %w", err)
		}

		return nil
	})
	if err != nil {
		return Attempt{}, err
	}

	return attempt, nil
}

func (s *Service) FinishAttempt(
	ctx context.Context,
	attemptID string,
	status AttemptStatus,
	errorClass string,
	errorMessage string,
) error {
	if status != AttemptSucceeded && status != AttemptFailed {
		return ErrAttemptClosed
	}

	if status == AttemptSucceeded {
		errorClass = ""
		errorMessage = ""
	}

	errorClass = strings.TrimSpace(errorClass)
	errorMessage = strings.TrimSpace(errorMessage)

	if len(errorMessage) > 2000 {
		errorMessage = errorMessage[:2000]
	}

	tag, err := s.pool.Exec(ctx, `
		UPDATE chunk_upload_attempts
		SET status = $2,
		    error_class = NULLIF($3, ''),
		    error_message = NULLIF($4, ''),
		    finished_at = now()
		WHERE id::text = $1
		  AND status = 'started'
	`,
		attemptID,
		status,
		errorClass,
		errorMessage,
	)
	if err != nil {
		return fmt.Errorf("finish chunk upload attempt: %w", err)
	}

	if tag.RowsAffected() == 1 {
		return nil
	}

	var current AttemptStatus
	err = s.pool.QueryRow(ctx, `
		SELECT status
		FROM chunk_upload_attempts
		WHERE id::text = $1
	`, attemptID).Scan(&current)

	if errors.Is(err, pgx.ErrNoRows) {
		return ErrAttemptNotFound
	}
	if err != nil {
		return fmt.Errorf("read chunk upload attempt: %w", err)
	}

	if current == status {
		return nil
	}

	return ErrAttemptClosed
}
