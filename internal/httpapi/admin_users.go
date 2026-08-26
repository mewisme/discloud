package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/mewisme/discloud/internal/adminusers"
	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
)

type adminCreateUserRequest struct {
	Name              string `json:"name"`
	Username          string `json:"username"`
	Password          string `json:"password"`
	Role              string `json:"role"`
	StorageQuotaBytes *int64 `json:"storageQuotaBytes"`
}

type adminUpdateUserRequest struct {
	Name *string `json:"name"`
	Role *string `json:"role"`
}

type adminResetPasswordRequest struct {
	Password string `json:"password"`
}

type adminQuotaRequest struct {
	StorageQuotaBytes json.RawMessage `json:"storageQuotaBytes"`
}

type adminUserResponse struct {
	ID                   string `json:"id"`
	Username             string `json:"username"`
	Name                 string `json:"name"`
	Role                 string `json:"role"`
	Status               string `json:"status"`
	StorageQuotaBytes    *int64 `json:"storageQuotaBytes"`
	StorageUsedBytes     int64  `json:"storageUsedBytes"`
	StorageReservedBytes int64  `json:"storageReservedBytes"`
	MustChangePassword   bool   `json:"mustChangePassword"`
	HasAvatar            bool   `json:"hasAvatar"`
	AvatarRevision       int64  `json:"avatarRevision"`
}

type adminUsageResponse struct {
	QuotaBytes     *int64 `json:"quotaBytes"`
	UsedBytes      int64  `json:"usedBytes"`
	ReservedBytes  int64  `json:"reservedBytes"`
	AvailableBytes *int64 `json:"availableBytes"`
	OverQuota      bool   `json:"overQuota"`
}

func registerAdminUserRoutes(mux *http.ServeMux, service *adminusers.Service, authService *auth.Service, cfg config.AuthConfig) {
	admin := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAdmin(authService, cfg, handler))
	}

	admin("GET /api/v1/admin/users", func(w http.ResponseWriter, r *http.Request) {
		limit, offset, err := adminListParams(r)
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid pagination parameters")
			return
		}

		result, err := service.List(r.Context(), limit, offset)
		if err != nil {
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not list users")
			return
		}

		users := make([]adminUserResponse, len(result.Users))
		for i, user := range result.Users {
			users[i] = adminUserJSON(user)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Users  []adminUserResponse `json:"users"`
			Total  int64               `json:"total"`
			Limit  int                 `json:"limit"`
			Offset int                 `json:"offset"`
		}{
			Users:  users,
			Total:  result.Total,
			Limit:  limit,
			Offset: offset,
		})
	})

	admin("POST /api/v1/admin/users", func(w http.ResponseWriter, r *http.Request) {
		var input adminCreateUserRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		principal := currentPrincipal(r.Context())
		user, err := service.Create(r.Context(), principal.User.ID, adminusers.CreateInput{
			Name:              input.Name,
			Username:          input.Username,
			Password:          input.Password,
			Role:              input.Role,
			StorageQuotaBytes: input.StorageQuotaBytes,
		})
		if writeAdminUserError(w, r, err, "could not create user") {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(adminUserJSON(user))
	})

	admin("GET /api/v1/admin/users/{userId}", func(w http.ResponseWriter, r *http.Request) {
		user, err := service.Get(r.Context(), r.PathValue("userId"))
		if writeAdminUserError(w, r, err, "could not get user") {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(adminUserJSON(user))
	})

	admin("PATCH /api/v1/admin/users/{userId}", func(w http.ResponseWriter, r *http.Request) {
		var input adminUpdateUserRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		principal := currentPrincipal(r.Context())
		user, err := service.Update(
			r.Context(),
			principal.User.ID,
			r.PathValue("userId"),
			adminusers.UpdateInput{
				Name: input.Name,
				Role: input.Role,
			},
		)
		if writeAdminUserError(w, r, err, "could not update user") {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(adminUserJSON(user))
	})

	admin("PUT /api/v1/admin/users/{userId}/quota", func(w http.ResponseWriter, r *http.Request) {
		var input adminQuotaRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}
		if input.StorageQuotaBytes == nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "storageQuotaBytes is required")
			return
		}

		quota, err := decodeNullableInt64(input.StorageQuotaBytes)
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "storageQuotaBytes must be a non-negative integer or null")
			return
		}

		principal := currentPrincipal(r.Context())
		err = service.SetQuota(r.Context(), principal.User.ID, r.PathValue("userId"), quota)
		if writeAdminUserError(w, r, err, "could not update quota") {
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})

	admin("POST /api/v1/admin/users/{userId}/reset-password", func(w http.ResponseWriter, r *http.Request) {
		var input adminResetPasswordRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		principal := currentPrincipal(r.Context())
		err := service.ResetPassword(
			r.Context(),
			principal.User.ID,
			r.PathValue("userId"),
			input.Password,
		)
		if writeAdminUserError(w, r, err, "could not reset password") {
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})

	admin("POST /api/v1/admin/users/{userId}/disable", func(w http.ResponseWriter, r *http.Request) {
		principal := currentPrincipal(r.Context())
		err := service.Disable(r.Context(), principal.User.ID, r.PathValue("userId"))
		if writeAdminUserError(w, r, err, "could not disable user") {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	admin("POST /api/v1/admin/users/{userId}/enable", func(w http.ResponseWriter, r *http.Request) {
		principal := currentPrincipal(r.Context())
		err := service.Enable(r.Context(), principal.User.ID, r.PathValue("userId"))
		if writeAdminUserError(w, r, err, "could not enable user") {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	admin("GET /api/v1/admin/users/{userId}/usage", func(w http.ResponseWriter, r *http.Request) {
		usage, err := service.Usage(r.Context(), r.PathValue("userId"))
		if writeAdminUserError(w, r, err, "could not get usage") {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(adminUsageResponse{
			QuotaBytes:     usage.QuotaBytes,
			UsedBytes:      usage.UsedBytes,
			ReservedBytes:  usage.ReservedBytes,
			AvailableBytes: usage.AvailableBytes,
			OverQuota:      usage.OverQuota,
		})
	})

	admin("GET /api/v1/admin/users/{userId}/root", func(w http.ResponseWriter, r *http.Request) {
		root, err := service.Root(r.Context(), r.PathValue("userId"))
		if writeAdminUserError(w, r, err, "could not get user root") {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}{
			ID:   root.ID,
			Name: root.Name,
		})
	})
}

func writeAdminUserError(w http.ResponseWriter, r *http.Request, err error, internalDetail string) bool {
	if err == nil {
		return false
	}

	switch {
	case errors.Is(err, adminusers.ErrUserNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "user not found")
	case errors.Is(err, adminusers.ErrUsernameTaken):
		WriteProblem(w, r, http.StatusConflict, "Conflict", "username already exists")
	case errors.Is(err, adminusers.ErrLastActiveAdmin):
		WriteProblem(w, r, http.StatusConflict, "Conflict", err.Error())
	case errors.Is(err, auth.ErrInvalidName),
		errors.Is(err, auth.ErrInvalidUsername),
		errors.Is(err, auth.ErrWeakPassword),
		errors.Is(err, adminusers.ErrInvalidRole),
		errors.Is(err, adminusers.ErrInvalidQuota),
		errors.Is(err, auth.ErrInvalidTemporaryPassword),
		errors.Is(err, adminusers.ErrNoChanges):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", err.Error())
	default:
		WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", internalDetail)
	}

	return true
}

func adminUserJSON(user adminusers.User) adminUserResponse {
	return adminUserResponse{
		ID:                   user.ID,
		Username:             user.Username,
		Name:                 user.Name,
		Role:                 user.Role,
		Status:               user.Status,
		StorageQuotaBytes:    user.StorageQuotaBytes,
		StorageUsedBytes:     user.StorageUsedBytes,
		StorageReservedBytes: user.StorageReservedBytes,
		MustChangePassword:   user.MustChangePassword,
		HasAvatar:            user.HasAvatar,
		AvatarRevision:       user.AvatarRevision,
	}
}

func adminListParams(r *http.Request) (int, int, error) {
	limit := 50
	offset := 0

	if raw := r.URL.Query().Get("limit"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 {
			return 0, 0, errors.New("invalid limit")
		}
		limit = value
	}

	if raw := r.URL.Query().Get("offset"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			return 0, 0, errors.New("invalid offset")
		}
		offset = value
	}

	return limit, offset, nil
}

func decodeNullableInt64(raw json.RawMessage) (*int64, error) {
	if string(raw) == "null" {
		return nil, nil
	}

	var value int64
	if err := json.Unmarshal(raw, &value); err != nil || value < 0 {
		return nil, errors.New("invalid integer")
	}
	return &value, nil
}
