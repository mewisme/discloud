package adminops

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInvalidQuery = errors.New("invalid admin operations query")
	ErrUserNotFound = errors.New("user not found")
)

type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

type AuditQuery struct {
	ActorUserID  string
	Action       string
	ResourceType string
	ResourceID   string
	From         *time.Time
	To           *time.Time
	Limit        int
	BeforeAt     *time.Time
	BeforeID     string
}

type AuditEvent struct {
	ID            string          `json:"id"`
	ActorUserID   string          `json:"actorUserId,omitempty"`
	ActorUsername string          `json:"actorUsername,omitempty"`
	ActorName     string          `json:"actorName,omitempty"`
	Action        string          `json:"action"`
	ResourceType  string          `json:"resourceType,omitempty"`
	ResourceID    string          `json:"resourceId,omitempty"`
	RequestID     string          `json:"requestId,omitempty"`
	IPAddress     string          `json:"ipAddress,omitempty"`
	Metadata      json.RawMessage `json:"metadata"`
	CreatedAt     time.Time       `json:"createdAt"`
}

type JobQuery struct {
	Status   string
	Type     string
	Limit    int
	BeforeAt *time.Time
	BeforeID string
}

type JobDiagnostic struct {
	ID          string          `json:"id"`
	Type        string          `json:"type"`
	Status      string          `json:"status"`
	Payload     json.RawMessage `json:"payload"`
	Priority    int             `json:"priority"`
	Attempts    int             `json:"attempts"`
	MaxAttempts int             `json:"maxAttempts"`
	RunAt       time.Time       `json:"runAt"`
	LockedAt    *time.Time      `json:"lockedAt,omitempty"`
	LockedBy    string          `json:"lockedBy,omitempty"`
	LastError   string          `json:"lastError,omitempty"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
	CompletedAt *time.Time      `json:"completedAt,omitempty"`
}

type UploadQuery struct {
	Status      string
	OwnerUserID string
	ActorUserID string
	Limit       int
	BeforeAt    *time.Time
	BeforeID    string
}

type UploadDiagnostic struct {
	ID               string    `json:"id"`
	ActorUserID      string    `json:"actorUserId"`
	ActorUsername    string    `json:"actorUsername"`
	ActorName        string    `json:"actorName"`
	OwnerUserID      string    `json:"ownerUserId"`
	OwnerUsername    string    `json:"ownerUsername"`
	OwnerName        string    `json:"ownerName"`
	ParentFolderID   string    `json:"parentFolderId"`
	Name             string    `json:"name"`
	SizeBytes        int64     `json:"sizeBytes"`
	ReservedBytes    int64     `json:"reservedBytes"`
	Status           string    `json:"status"`
	ExpectedParts    int       `json:"expectedParts"`
	UploadedParts    int64     `json:"uploadedParts"`
	AttemptCount     int64     `json:"attemptCount"`
	FailedAttempts   int64     `json:"failedAttempts"`
	LastErrorClass   string    `json:"lastErrorClass,omitempty"`
	LastErrorMessage string    `json:"lastErrorMessage,omitempty"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
	ExpiresAt        time.Time `json:"expiresAt"`
}

type StorageOverview struct {
	UserCount                 int64 `json:"userCount"`
	ActiveFileCount           int64 `json:"activeFileCount"`
	DerivedLogicalUsedBytes   int64 `json:"derivedLogicalUsedBytes"`
	CachedLogicalUsedBytes    int64 `json:"cachedLogicalUsedBytes"`
	DerivedReservedBytes      int64 `json:"derivedReservedBytes"`
	CachedReservedBytes       int64 `json:"cachedReservedBytes"`
	QuotaMismatchUsers        int64 `json:"quotaMismatchUsers"`
	UniqueChunkCount          int64 `json:"uniqueChunkCount"`
	UniqueChunkBytes          int64 `json:"uniqueChunkBytes"`
	ReadyChunkCount           int64 `json:"readyChunkCount"`
	ReadyChunkBytes           int64 `json:"readyChunkBytes"`
	UncommittedChunkCount     int64 `json:"uncommittedChunkCount"`
	UncommittedChunkBytes     int64 `json:"uncommittedChunkBytes"`
	OrphanCandidateChunkCount int64 `json:"orphanCandidateChunkCount"`
	OrphanCandidateChunkBytes int64 `json:"orphanCandidateChunkBytes"`
}

type QuotaReconciliation struct {
	UserID              string `json:"userId"`
	Username            string `json:"username"`
	Name                string `json:"name"`
	QuotaBytes          *int64 `json:"quotaBytes"`
	BeforeUsedBytes     int64  `json:"beforeUsedBytes"`
	AfterUsedBytes      int64  `json:"afterUsedBytes"`
	BeforeReservedBytes int64  `json:"beforeReservedBytes"`
	AfterReservedBytes  int64  `json:"afterReservedBytes"`
	Changed             bool   `json:"changed"`
	OverQuota           bool   `json:"overQuota"`
}

func validPage(limit int, beforeAt *time.Time, beforeID string) bool {
	return limit >= 1 && limit <= 100 && ((beforeAt == nil) == (beforeID == ""))
}

func isInvalidUUID(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "22P02"
}
