package httpapi

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/blobstore"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/nodes"
	"github.com/mewisme/discloud/internal/uploads"
)

const chunkSHA256Header = "X-Chunk-SHA256"

type createUploadRequest struct {
	ParentFolderID string  `json:"parentFolderId"`
	Name           string  `json:"name"`
	Size           int64   `json:"size"`
	MIMETypeHint   string  `json:"mimeTypeHint"`
	FileSHA256     *string `json:"fileSha256"`
}

type uploadSessionResponse struct {
	ID                         string               `json:"id"`
	OwnerUserID                string               `json:"ownerUserId"`
	ParentFolderID             string               `json:"parentFolderId"`
	Name                       string               `json:"name"`
	Size                       int64                `json:"size"`
	ChunkSize                  int64                `json:"chunkSize"`
	ExpectedParts              int                  `json:"expectedParts"`
	RecommendedPartConcurrency int                  `json:"recommendedPartConcurrency"`
	Status                     string               `json:"status"`
	FileSHA256                 string               `json:"fileSha256,omitempty"`
	ExpiresAt                  time.Time            `json:"expiresAt"`
	CommittedFileID            string               `json:"committedFileId,omitempty"`
	Parts                      []uploadPartResponse `json:"parts,omitempty"`
}

type uploadPartResponse struct {
	PartIndex    int       `json:"partIndex"`
	ChunkID      string    `json:"chunkId"`
	Size         int64     `json:"size"`
	SHA256       string    `json:"sha256"`
	Deduplicated bool      `json:"deduplicated,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

type completedFileResponse struct {
	ID             string    `json:"id"`
	OwnerUserID    string    `json:"ownerUserId"`
	ParentFolderID string    `json:"parentFolderId"`
	Name           string    `json:"name"`
	Size           int64     `json:"size"`
	ChunkSize      int64     `json:"chunkSize"`
	SHA256         string    `json:"sha256,omitempty"`
	MIMEType       string    `json:"mimeType"`
	CreatedAt      time.Time `json:"createdAt"`
}

func registerUploadRoutes(mux *http.ServeMux, service *uploads.Service, uploader *uploads.PartUploader, finalizer *uploads.Finalizer, authService *auth.Service, cfg config.AuthConfig) {
	protected := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAuth(authService, cfg, handler))
	}

	protected("POST /api/v1/uploads", func(w http.ResponseWriter, r *http.Request) {
		var input createUploadRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		fileSHA, err := optionalSHA256(input.FileSHA256)
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "fileSha256 must be a 64-character hexadecimal SHA-256")
			return
		}

		session, err := service.Create(r.Context(), uploadActor(r), uploads.CreateInput{
			ParentFolderID: input.ParentFolderID,
			Name:           input.Name,
			SizeBytes:      input.Size,
			MIMETypeHint:   input.MIMETypeHint,
			FileSHA256:     fileSHA,
		})
		if writeUploadError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(uploadSessionJSON(session, nil, uploader.RecommendedPartConcurrency()))
	})

	protected("GET /api/v1/uploads/{uploadId}", func(w http.ResponseWriter, r *http.Request) {
		actor := uploadActor(r)
		session, err := service.Get(r.Context(), actor, r.PathValue("uploadId"))
		if writeUploadError(w, r, err) {
			return
		}

		parts, err := service.ListParts(r.Context(), actor, session.ID)
		if writeUploadError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(uploadSessionJSON(session, parts, uploader.RecommendedPartConcurrency()))
	})

	protected("PUT /api/v1/uploads/{uploadId}/parts/{partIndex}", func(w http.ResponseWriter, r *http.Request) {
		partIndex, err := strconv.Atoi(r.PathValue("partIndex"))
		if err != nil || partIndex < 0 {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid part index")
			return
		}

		digest, err := parseSHA256(r.Header.Get(chunkSHA256Header))
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", chunkSHA256Header+" must be a 64-character hexadecimal SHA-256")
			return
		}

		result, err := uploader.PutPart(r.Context(), uploadActor(r), r.PathValue("uploadId"), partIndex, digest, r.Body)
		if writeUploadError(w, r, err) {
			return
		}

		response := uploadPartJSON(result.Part)
		response.Deduplicated = result.Deduplicated

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
	})

	protected("POST /api/v1/uploads/{uploadId}/complete", func(w http.ResponseWriter, r *http.Request) {
		file, err := finalizer.Finalize(r.Context(), uploadActor(r), r.PathValue("uploadId"))
		if writeUploadError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(completedFileJSON(file))
	})

	protected("DELETE /api/v1/uploads/{uploadId}", func(w http.ResponseWriter, r *http.Request) {
		_, err := service.Cancel(r.Context(), uploadActor(r), r.PathValue("uploadId"))
		if writeUploadError(w, r, err) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func uploadActor(r *http.Request) uploads.Actor {
	principal := currentPrincipal(r.Context())
	return uploads.Actor{UserID: principal.User.ID, Admin: principal.User.Role == "admin"}
}

func uploadSessionJSON(session uploads.Session, parts []uploads.Part, recommendedPartConcurrency int) uploadSessionResponse {
	if recommendedPartConcurrency < 1 {
		recommendedPartConcurrency = 1
	}

	response := uploadSessionResponse{
		ID: session.ID, OwnerUserID: session.OwnerUserID, ParentFolderID: session.ParentFolderID,
		Name: session.Name, Size: session.SizeBytes, ChunkSize: session.ChunkSizeBytes,
		ExpectedParts: session.ExpectedParts, RecommendedPartConcurrency: recommendedPartConcurrency,
		Status: string(session.Status), ExpiresAt: session.ExpiresAt, CommittedFileID: session.CommittedFileID,
	}
	if len(session.FileSHA256) == 32 {
		response.FileSHA256 = hex.EncodeToString(session.FileSHA256)
	}
	if parts != nil {
		response.Parts = make([]uploadPartResponse, len(parts))
		for i, part := range parts {
			response.Parts[i] = uploadPartJSON(part)
		}
	}
	return response
}

func uploadPartJSON(part uploads.Part) uploadPartResponse {
	return uploadPartResponse{
		PartIndex: part.PartIndex, ChunkID: part.ChunkID, Size: part.SizeBytes,
		SHA256: hex.EncodeToString(part.SHA256[:]), CreatedAt: part.CreatedAt,
	}
}

func completedFileJSON(file uploads.CompletedFile) completedFileResponse {
	response := completedFileResponse{
		ID: file.ID, OwnerUserID: file.OwnerUserID, ParentFolderID: file.ParentFolderID,
		Name: file.Name, Size: file.SizeBytes, ChunkSize: file.ChunkSizeBytes,
		MIMEType: file.MIMEType, CreatedAt: file.CreatedAt,
	}
	if len(file.SHA256) == 32 {
		response.SHA256 = hex.EncodeToString(file.SHA256)
	}
	return response
}

func parseSHA256(value string) ([32]byte, error) {
	var digest [32]byte
	value = strings.TrimSpace(value)
	if len(value) != hex.EncodedLen(len(digest)) {
		return digest, errors.New("invalid SHA-256")
	}

	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != len(digest) {
		return digest, errors.New("invalid SHA-256")
	}
	copy(digest[:], decoded)
	return digest, nil
}

func optionalSHA256(value *string) ([]byte, error) {
	if value == nil {
		return nil, nil
	}
	digest, err := parseSHA256(*value)
	if err != nil {
		return nil, err
	}
	return digest[:], nil
}

func writeUploadError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}

	switch {
	case errors.Is(err, uploads.ErrNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "upload session not found")
	case errors.Is(err, uploads.ErrForbidden):
		WriteProblem(w, r, http.StatusForbidden, "Forbidden", "upload permission denied")
	case errors.Is(err, nodes.ErrInvalidName), errors.Is(err, uploads.ErrInvalidUpload), errors.Is(err, uploads.ErrInvalidPart), errors.Is(err, uploads.ErrPartSizeMismatch):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", err.Error())
	case errors.Is(err, uploads.ErrPartHashMismatch), errors.Is(err, uploads.ErrFileHashMismatch):
		WriteProblem(w, r, http.StatusUnprocessableEntity, "Unprocessable Entity", err.Error())
	case errors.Is(err, uploads.ErrNameConflict), errors.Is(err, uploads.ErrPartConflict), errors.Is(err, uploads.ErrIncompleteUpload), errors.Is(err, uploads.ErrSessionClosed):
		WriteProblem(w, r, http.StatusConflict, "Conflict", err.Error())
	case errors.Is(err, uploads.ErrSessionExpired):
		WriteProblem(w, r, http.StatusGone, "Gone", "upload session expired")
	case errors.Is(err, uploads.ErrQuotaExceeded):
		WriteProblem(w, r, http.StatusConflict, "Conflict", "storage quota exceeded")
	case errors.Is(err, uploads.ErrAttemptsExhausted), errors.Is(err, uploads.ErrStorageUnavailable), errors.Is(err, blobstore.ErrNoUsableBot):
		logUploadServerError(r, err, "unavailable", true)
		WriteProblem(w, r, http.StatusServiceUnavailable, "Service Unavailable", "upload storage is temporarily unavailable")
	case errors.Is(err, uploads.ErrStorageInvariant):
		logUploadServerError(r, err, "protocol", false)
		WriteProblem(w, r, http.StatusBadGateway, "Bad Gateway", "storage returned an invalid response")
	default:
		class, retryable := blobstore.Classify(err)
		if class != "unknown" {
			logUploadServerError(r, err, class, retryable)
			status := http.StatusBadGateway
			if retryable {
				status = http.StatusServiceUnavailable
			}
			WriteProblem(w, r, status, http.StatusText(status), "Discord storage request failed")
		} else {
			logUploadServerError(r, err, "internal", false)
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not process upload")
		}
	}
	return true
}

func logUploadServerError(r *http.Request, err error, class string, retryable bool) {
	slog.ErrorContext(
		r.Context(),
		"Upload request failed",
		"request_id", RequestID(r.Context()),
		"route", routePattern(r),
		"upload_id", r.PathValue("uploadId"),
		"part_index", r.PathValue("partIndex"),
		"error_class", class,
		"retryable", retryable,
		"error", err,
	)
}
