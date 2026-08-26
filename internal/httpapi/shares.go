package httpapi

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/files"
	"github.com/mewisme/discloud/internal/folders"
	"github.com/mewisme/discloud/internal/shares"
)

type createShareRequest struct {
	ResourceType  string     `json:"resourceType"`
	ResourceID    string     `json:"resourceId"`
	ExpiresAt     *time.Time `json:"expiresAt"`
	Password      string     `json:"password"`
	AllowDownload *bool      `json:"allowDownload"`
	MaxViews      *int64     `json:"maxViews"`
	MaxDownloads  *int64     `json:"maxDownloads"`
}

type updateShareRequest struct {
	ExpiresAt     *time.Time `json:"expiresAt"`
	Password      *string    `json:"password"`
	ClearPassword bool       `json:"clearPassword"`
	AllowDownload *bool      `json:"allowDownload"`
	MaxViews      *int64     `json:"maxViews"`
	MaxDownloads  *int64     `json:"maxDownloads"`
}

type unlockShareRequest struct {
	Password string `json:"password"`
}

type shareResponse struct {
	ID                string     `json:"id"`
	PublicID          string     `json:"publicId"`
	ResourceType      string     `json:"resourceType"`
	ResourceID        string     `json:"resourceId"`
	CreatedBy         string     `json:"createdBy"`
	CreatedAt         time.Time  `json:"createdAt"`
	ExpiresAt         *time.Time `json:"expiresAt"`
	PasswordProtected bool       `json:"passwordProtected"`
	AllowDownload     bool       `json:"allowDownload"`
	MaxViews          *int64     `json:"maxViews"`
	ViewCount         int64      `json:"viewCount"`
	MaxDownloads      *int64     `json:"maxDownloads"`
	DownloadCount     int64      `json:"downloadCount"`
	Created           bool       `json:"created,omitempty"`
}

type publicFileResponse struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Size      int64     `json:"size"`
	SHA256    string    `json:"sha256,omitempty"`
	MIMEType  string    `json:"mimeType"`
	Category  string    `json:"category"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type publicNodeResponse struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	Name      string    `json:"name"`
	Size      *int64    `json:"size,omitempty"`
	MIMEType  string    `json:"mimeType,omitempty"`
	Category  string    `json:"category,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type publicFolderResponse struct {
	ID       string               `json:"id"`
	Name     string               `json:"name"`
	Children []publicNodeResponse `json:"children"`
}

type publicCollectionResponse struct {
	ID          string               `json:"id"`
	Name        string               `json:"name"`
	Description string               `json:"description,omitempty"`
	Items       []publicNodeResponse `json:"items"`
}

type publicShareResponse struct {
	PublicID          string                    `json:"publicId"`
	ResourceType      string                    `json:"resourceType"`
	ResourceID        string                    `json:"resourceId"`
	ExpiresAt         *time.Time                `json:"expiresAt"`
	PasswordProtected bool                      `json:"passwordProtected"`
	AllowDownload     bool                      `json:"allowDownload"`
	File              *publicFileResponse       `json:"file,omitempty"`
	Folder            *publicFolderResponse     `json:"folder,omitempty"`
	Collection        *publicCollectionResponse `json:"collection,omitempty"`
}

func registerShareRoutes(mux *http.ServeMux, service *shares.Service, authService *auth.Service, cfg config.AuthConfig) {
	protected := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAuth(authService, cfg, handler))
	}

	protected("POST /api/v1/shares", func(w http.ResponseWriter, r *http.Request) {
		var input createShareRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}

		resourceType, err := shares.ParseResourceType(strings.TrimSpace(input.ResourceType))
		if err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "resourceType must be file, folder, or collection")
			return
		}

		result, err := service.Create(r.Context(), shareActor(r), shares.CreateInput{
			ResourceType: resourceType, ResourceID: input.ResourceID, ExpiresAt: input.ExpiresAt,
			Password: input.Password, AllowDownload: input.AllowDownload, MaxViews: input.MaxViews, MaxDownloads: input.MaxDownloads,
		})
		if writeShareError(w, r, err) {
			return
		}

		response := shareJSON(result.Share)
		response.Created = result.Created

		w.Header().Set("Content-Type", "application/json")
		if result.Created {
			w.WriteHeader(http.StatusCreated)
		}
		_ = json.NewEncoder(w).Encode(response)
	})

	protected("PATCH /api/v1/shares/{shareId}", func(w http.ResponseWriter, r *http.Request) {
		var input updateShareRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}
		if input.AllowDownload == nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "allowDownload is required")
			return
		}
		share, err := service.Update(r.Context(), shareActor(r), r.PathValue("shareId"), shares.UpdateInput{
			ExpiresAt: input.ExpiresAt, Password: input.Password, ClearPassword: input.ClearPassword,
			AllowDownload: *input.AllowDownload, MaxViews: input.MaxViews, MaxDownloads: input.MaxDownloads,
		})
		if writeShareError(w, r, err) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(shareJSON(share))
	})

	protected("DELETE /api/v1/shares/{shareId}/sessions", func(w http.ResponseWriter, r *http.Request) {
		if writeShareError(w, r, service.RevokeSessions(r.Context(), shareActor(r), r.PathValue("shareId"))) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	protected("DELETE /api/v1/shares/{shareId}", func(w http.ResponseWriter, r *http.Request) {
		if writeShareError(w, r, service.Revoke(r.Context(), shareActor(r), r.PathValue("shareId"))) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func registerPublicShareRoutes(mux *http.ServeMux, shareService *shares.Service, fileService *files.Service, folderService *folders.Service, httpCfg config.HTTPConfig) {
	resources := newPublicShareResources()
	unlockLimits := newPublicShareUnlockLimits()

	mux.HandleFunc("POST /api/v1/public/shares/{publicId}/unlock", func(w http.ResponseWriter, r *http.Request) {
		publicID := r.PathValue("publicId")
		if allowed, retryAfter := unlockLimits.allow(requestIP(r, httpCfg), publicID); !allowed {
			writePublicShareUnlockRateLimit(w, r, retryAfter)
			return
		}
		var input unlockShareRequest
		if err := decodeJSON(w, r, accountBodyLimit, &input); err != nil {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid JSON body")
			return
		}
		result, err := shareService.Unlock(r.Context(), publicID, input.Password)
		if writePublicShareError(w, r, err) {
			return
		}
		setPublicShareSessionCookie(w, r, publicID, result, httpCfg)
		w.WriteHeader(http.StatusNoContent)
	})

	resolve := func(w http.ResponseWriter, r *http.Request) {
		writePublicShare(w, r, shareService, fileService, r.PathValue("publicId"))
	}

	mux.HandleFunc("GET /s/{publicId}", resolve)
	mux.HandleFunc("GET /api/v1/public/shares/{publicId}", resolve)

	mux.HandleFunc("GET /api/v1/public/shares/{publicId}/content", func(w http.ResponseWriter, r *http.Request) {
		servePublicFile(w, r, shareService, fileService, resources, "", false)
	})
	mux.HandleFunc("GET /api/v1/public/shares/{publicId}/download", func(w http.ResponseWriter, r *http.Request) {
		servePublicFile(w, r, shareService, fileService, resources, "", true)
	})

	mux.HandleFunc("GET /api/v1/public/shares/{publicId}/files/{fileId}/content", func(w http.ResponseWriter, r *http.Request) {
		servePublicFile(w, r, shareService, fileService, resources, r.PathValue("fileId"), false)
	})
	mux.HandleFunc("GET /api/v1/public/shares/{publicId}/files/{fileId}/download", func(w http.ResponseWriter, r *http.Request) {
		servePublicFile(w, r, shareService, fileService, resources, r.PathValue("fileId"), true)
	})

	mux.HandleFunc("GET /api/v1/public/shares/{publicId}/folders/{folderId}", func(w http.ResponseWriter, r *http.Request) {
		share, err := resolvePublicShareRequest(r.Context(), r, shareService)
		if writePublicShareError(w, r, err) {
			return
		}

		folder, err := shareService.Folder(r.Context(), share, r.PathValue("folderId"))
		if writePublicShareError(w, r, err) {
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(publicFolderJSON(folder))
	})

	mux.HandleFunc("GET /api/v1/public/shares/{publicId}/folders/{folderId}/download", func(w http.ResponseWriter, r *http.Request) {
		share, err := resolvePublicShareRequest(r.Context(), r, shareService)
		if writePublicShareError(w, r, err) {
			return
		}

		folderID := r.PathValue("folderId")
		if err := shareService.CanAccessFolder(r.Context(), share, folderID); writePublicShareError(w, r, err) {
			return
		}
		release, ok := resources.tryAcquireArchive()
		if !ok {
			writePublicShareCapacityExceeded(w, r)
			return
		}
		defer release()

		archive, err := folderService.PrepareArchiveStoredLimited(r.Context(), folderID, publicFolderArchiveLimits())
		switch {
		case errors.Is(err, folders.ErrNotFound):
			WriteProblem(w, r, http.StatusNotFound, "Not Found", "public resource not found")
			return
		case errors.Is(err, folders.ErrArchiveTooLarge):
			WriteProblem(w, r, http.StatusRequestEntityTooLarge, "Content Too Large", "public folder archive exceeds the download limits")
			return
		case err != nil:
			WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not prepare public archive")
			return
		}
		if _, err := shareService.ConsumeDownload(r.Context(), share.ID); writePublicShareError(w, r, err) {
			return
		}

		disposition := mime.FormatMediaType("attachment", map[string]string{"filename": archive.Filename})
		if disposition == "" {
			disposition = "attachment"
		}

		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", disposition)
		w.Header().Set("X-Content-Type-Options", "nosniff")

		if err := folderService.WriteZIPStored(r.Context(), archive, w); err != nil {
			slog.ErrorContext(r.Context(), "stream public folder archive failed", "error", err)
		}
	})

	mux.HandleFunc("GET /api/v1/public/shares/{publicId}/items", func(w http.ResponseWriter, r *http.Request) {
		share, err := resolvePublicShareRequest(r.Context(), r, shareService)
		if writePublicShareError(w, r, err) {
			return
		}

		items, err := shareService.CollectionItems(r.Context(), share)
		if writePublicShareError(w, r, err) {
			return
		}

		response := make([]publicNodeResponse, len(items))
		for i, item := range items {
			response[i] = publicNodeJSON(item)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Items []publicNodeResponse `json:"items"`
		}{response})
	})
}

func writePublicShare(w http.ResponseWriter, r *http.Request, shareService *shares.Service, fileService *files.Service, publicID string) {
	share, err := shareService.ConsumeView(r.Context(), publicID, publicShareSessionToken(r, publicID))
	if writePublicShareError(w, r, err) {
		return
	}

	response := publicShareResponse{
		PublicID: share.PublicID, ResourceType: string(share.ResourceType), ResourceID: share.ResourceID,
		ExpiresAt: share.ExpiresAt, PasswordProtected: share.PasswordProtected, AllowDownload: share.AllowDownload,
	}

	switch share.ResourceType {
	case shares.ResourceFile:
		file, err := fileService.GetStored(r.Context(), share.ResourceID)
		if writeFileError(w, r, err) {
			return
		}
		value := publicFileJSON(file)
		response.File = &value

	case shares.ResourceFolder:
		folder, err := shareService.Folder(r.Context(), share, share.ResourceID)
		if writePublicShareError(w, r, err) {
			return
		}
		value := publicFolderJSON(folder)
		response.Folder = &value

	case shares.ResourceCollection:
		collection, err := shareService.Collection(r.Context(), share)
		if writePublicShareError(w, r, err) {
			return
		}
		value := publicCollectionJSON(collection)
		response.Collection = &value
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

func servePublicFile(w http.ResponseWriter, r *http.Request, shareService *shares.Service, fileService *files.Service, resources *publicShareResources, fileID string, download bool) {
	share, err := resolvePublicShareRequest(r.Context(), r, shareService)
	if writePublicShareError(w, r, err) {
		return
	}

	if fileID == "" {
		if share.ResourceType != shares.ResourceFile {
			WriteProblem(w, r, http.StatusNotFound, "Not Found", "public resource not found")
			return
		}
		fileID = share.ResourceID
	} else if err := shareService.CanAccessFile(r.Context(), share, fileID); writePublicShareError(w, r, err) {
		return
	}

	file, err := fileService.GetStored(r.Context(), fileID)
	if writeFileError(w, r, err) {
		return
	}

	byteRange, err := files.ParseRange(r.Header.Get("Range"), file.SizeBytes)
	if errors.Is(err, files.ErrUnsatisfiableRange) {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", file.SizeBytes))
		WriteProblem(w, r, http.StatusRequestedRangeNotSatisfiable, "Range Not Satisfiable", "requested byte range is outside the file")
		return
	}
	if errors.Is(err, files.ErrInvalidRange) {
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid Range header")
		return
	}
	if err != nil {
		WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not parse file range")
		return
	}

	start, length, status := int64(0), file.SizeBytes, http.StatusOK
	if byteRange != nil {
		start, length, status = byteRange.Start, byteRange.Length(), http.StatusPartialContent
	}

	release, ok := resources.tryAcquireFile()
	if !ok {
		writePublicShareCapacityExceeded(w, r)
		return
	}
	defer release()

	_, reader, err := fileService.OpenStored(r.Context(), fileID, start, length)
	if writeFileError(w, r, err) {
		return
	}
	defer reader.Close()
	if download {
		if _, err := shareService.ConsumeDownload(r.Context(), share.ID); writePublicShareError(w, r, err) {
			return
		}
	}

	setFileHeaders(w, file, download, length)
	if byteRange != nil {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", byteRange.Start, byteRange.End, file.SizeBytes))
	}

	w.WriteHeader(status)
	if length == 0 {
		return
	}
	_, _ = io.Copy(w, reader)
}

func writePublicShareCapacityExceeded(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Retry-After", "1")
	WriteProblem(w, r, http.StatusServiceUnavailable, "Service Unavailable", "public download capacity is temporarily exhausted")
}

func shareActor(r *http.Request) shares.Actor {
	principal := currentPrincipal(r.Context())
	return shares.Actor{UserID: principal.User.ID, Admin: principal.User.Role == "admin"}
}

func shareJSON(share shares.Share) shareResponse {
	return shareResponse{
		ID: share.ID, PublicID: share.PublicID, ResourceType: string(share.ResourceType), ResourceID: share.ResourceID,
		CreatedBy: share.CreatedBy, CreatedAt: share.CreatedAt, ExpiresAt: share.ExpiresAt,
		PasswordProtected: share.PasswordProtected, AllowDownload: share.AllowDownload,
		MaxViews: share.MaxViews, ViewCount: share.ViewCount, MaxDownloads: share.MaxDownloads, DownloadCount: share.DownloadCount,
	}
}

func publicFileJSON(file files.File) publicFileResponse {
	response := publicFileResponse{
		ID: file.ID, Name: file.Name, Size: file.SizeBytes, MIMEType: file.MIMEType,
		Category: file.Category, CreatedAt: file.CreatedAt, UpdatedAt: file.UpdatedAt,
	}
	if len(file.SHA256) == 32 {
		response.SHA256 = hex.EncodeToString(file.SHA256)
	}
	return response
}

func publicNodeJSON(node shares.PublicNode) publicNodeResponse {
	return publicNodeResponse{
		ID: node.ID, Kind: node.Kind, Name: node.Name, Size: node.SizeBytes,
		MIMEType: node.MIMEType, Category: node.Category,
		CreatedAt: node.CreatedAt, UpdatedAt: node.UpdatedAt,
	}
}

func publicFolderJSON(folder shares.PublicFolder) publicFolderResponse {
	response := publicFolderResponse{
		ID:       folder.ID,
		Name:     folder.Name,
		Children: make([]publicNodeResponse, len(folder.Children)),
	}
	for i, child := range folder.Children {
		response.Children[i] = publicNodeJSON(child)
	}
	return response
}

func publicCollectionJSON(collection shares.PublicCollection) publicCollectionResponse {
	response := publicCollectionResponse{
		ID: collection.ID, Name: collection.Name, Description: collection.Description,
		Items: make([]publicNodeResponse, len(collection.Items)),
	}
	for i, item := range collection.Items {
		response.Items[i] = publicNodeJSON(item)
	}
	return response
}

func writeShareError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}

	switch {
	case errors.Is(err, shares.ErrNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "share resource not found")
	case errors.Is(err, shares.ErrForbidden):
		WriteProblem(w, r, http.StatusForbidden, "Forbidden", "full permission is required to manage public sharing")
	case errors.Is(err, shares.ErrInvalidResourceType), errors.Is(err, shares.ErrInvalidPolicy):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", err.Error())
	default:
		WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not manage public share")
	}
	return true
}

func writePublicShareError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}
	switch {
	case errors.Is(err, shares.ErrNotFound):
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "public resource not found")
	case errors.Is(err, shares.ErrPasswordRequired):
		WriteProblem(w, r, http.StatusUnauthorized, "Unauthorized", "public share password required")
	case errors.Is(err, shares.ErrInvalidPassword):
		WriteProblem(w, r, http.StatusUnauthorized, "Unauthorized", "invalid public share password")
	case errors.Is(err, shares.ErrExpired):
		WriteProblem(w, r, http.StatusGone, "Gone", "public share has expired")
	case errors.Is(err, shares.ErrViewLimit):
		WriteProblem(w, r, http.StatusGone, "Gone", "public share view limit reached")
	case errors.Is(err, shares.ErrDownloadDisabled):
		WriteProblem(w, r, http.StatusForbidden, "Forbidden", "downloads are disabled for this public share")
	case errors.Is(err, shares.ErrDownloadLimit):
		WriteProblem(w, r, http.StatusGone, "Gone", "public share download limit reached")
	default:
		WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not resolve public resource")
	}
	return true
}
