package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/mewisme/discloud/internal/adminops"
	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/cursor"
)

type adminReconcileRequest struct {
	UserID string `json:"userId,omitempty"`
}

func registerAdminOpsRoutes(mux *http.ServeMux, service *adminops.Service, authService *auth.Service, cfg config.AuthConfig) {
	admin := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAdmin(authService, cfg, handler))
	}

	admin("GET /api/v1/admin/audit", func(w http.ResponseWriter, r *http.Request) {
		limit, err := nodeListLimit(r)
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid limit")
			return
		}

		beforeAt, beforeID, err := adminOpsCursor(r)
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid cursor")
			return
		}

		from, err := optionalTime(r.URL.Query().Get("from"))
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid from")
			return
		}
		to, err := optionalTime(r.URL.Query().Get("to"))
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid to")
			return
		}

		items, hasMore, err := service.ListAudit(r.Context(), adminops.AuditQuery{
			ActorUserID:  r.URL.Query().Get("actorUserId"),
			Action:       r.URL.Query().Get("action"),
			ResourceType: r.URL.Query().Get("resourceType"),
			ResourceID:   r.URL.Query().Get("resourceId"),
			From:         from,
			To:           to,
			Limit:        limit,
			BeforeAt:     beforeAt,
			BeforeID:     beforeID,
		})
		if writeAdminOpsError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Events     []adminops.AuditEvent `json:"events"`
			NextCursor string                `json:"nextCursor,omitempty"`
		}{
			Events: items,
			NextCursor: adminOpsNextCursor(hasMore, items, func(item adminops.AuditEvent) (time.Time, string) {
				return item.CreatedAt, item.ID
			}),
		})
	})

	admin("GET /api/v1/admin/jobs", func(w http.ResponseWriter, r *http.Request) {
		limit, err := nodeListLimit(r)
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid limit")
			return
		}
		beforeAt, beforeID, err := adminOpsCursor(r)
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid cursor")
			return
		}

		items, hasMore, err := service.ListJobs(r.Context(), adminops.JobQuery{
			Status:   r.URL.Query().Get("status"),
			Type:     r.URL.Query().Get("type"),
			Limit:    limit,
			BeforeAt: beforeAt,
			BeforeID: beforeID,
		})
		if writeAdminOpsError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Jobs       []adminops.JobDiagnostic `json:"jobs"`
			NextCursor string                   `json:"nextCursor,omitempty"`
		}{
			Jobs: items,
			NextCursor: adminOpsNextCursor(hasMore, items, func(item adminops.JobDiagnostic) (time.Time, string) {
				return item.UpdatedAt, item.ID
			}),
		})
	})

	admin("GET /api/v1/admin/uploads", func(w http.ResponseWriter, r *http.Request) {
		limit, err := nodeListLimit(r)
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid limit")
			return
		}
		beforeAt, beforeID, err := adminOpsCursor(r)
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid cursor")
			return
		}

		items, hasMore, err := service.ListUploads(r.Context(), adminops.UploadQuery{
			Status:      r.URL.Query().Get("status"),
			OwnerUserID: r.URL.Query().Get("ownerUserId"),
			ActorUserID: r.URL.Query().Get("actorUserId"),
			Limit:       limit,
			BeforeAt:    beforeAt,
			BeforeID:    beforeID,
		})
		if writeAdminOpsError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Uploads    []adminops.UploadDiagnostic `json:"uploads"`
			NextCursor string                      `json:"nextCursor,omitempty"`
		}{
			Uploads: items,
			NextCursor: adminOpsNextCursor(hasMore, items, func(item adminops.UploadDiagnostic) (time.Time, string) {
				return item.UpdatedAt, item.ID
			}),
		})
	})

	admin("GET /api/v1/admin/storage", func(w http.ResponseWriter, r *http.Request) {
		overview, err := service.Overview(r.Context())
		if writeAdminOpsError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(overview)
	})

	admin("POST /api/v1/admin/storage/reconcile", func(w http.ResponseWriter, r *http.Request) {
		var input adminReconcileRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		principal := currentPrincipal(r.Context())
		result, err := service.ReconcileQuota(r.Context(), principal.User.ID, input.UserID)
		if writeAdminOpsError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Users []adminops.QuotaReconciliation `json:"users"`
		}{Users: result})
	})
}

func adminOpsCursor(r *http.Request) (*time.Time, string, error) {
	raw := r.URL.Query().Get("cursor")
	if raw == "" {
		return nil, "", nil
	}

	parts, err := cursor.Decode(raw, 2)
	if err != nil {
		return nil, "", err
	}
	value, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return nil, "", err
	}
	return &value, parts[1], nil
}

func adminOpsNextCursor[T any](hasMore bool, items []T, value func(T) (time.Time, string)) string {
	if !hasMore || len(items) == 0 {
		return ""
	}
	at, id := value(items[len(items)-1])
	return cursor.Encode(at.Format(time.RFC3339Nano), id)
}

func optionalTime(value string) (*time.Time, error) {
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func writeAdminOpsError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}

	switch {
	case errors.Is(err, adminops.ErrInvalidQuery):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid admin operations query")
	case errors.Is(err, adminops.ErrUserNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "user not found")
	default:
		WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "admin operation failed")
	}
	return true
}
