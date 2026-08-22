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
	ResourceType string `json:"resourceType"`
	ResourceID   string `json:"resourceId"`
}

type shareResponse struct {
	ID           string    `json:"id"`
	PublicID     string    `json:"publicId"`
	ResourceType string    `json:"resourceType"`
	ResourceID   string    `json:"resourceId"`
	CreatedBy    string    `json:"createdBy"`
	CreatedAt    time.Time `json:"createdAt"`
	Created      bool      `json:"created,omitempty"`
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
	PublicID     string                    `json:"publicId"`
	ResourceType string                    `json:"resourceType"`
	ResourceID   string                    `json:"resourceId"`
	File         *publicFileResponse       `json:"file,omitempty"`
	Folder       *publicFolderResponse     `json:"folder,omitempty"`
	Collection   *publicCollectionResponse `json:"collection,omitempty"`
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
			ResourceType: resourceType,
			ResourceID:   input.ResourceID,
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

	protected("DELETE /api/v1/shares/{shareId}", func(w http.ResponseWriter, r *http.Request) {
		if writeShareError(w, r, service.Revoke(r.Context(), shareActor(r), r.PathValue("shareId"))) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func registerPublicShareRoutes(mux *http.ServeMux, shareService *shares.Service, fileService *files.Service, folderService *folders.Service) {
	resources := newPublicShareResources()

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
		share, err := shareService.Resolve(r.Context(), r.PathValue("publicId"))
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
		share, err := shareService.Resolve(r.Context(), r.PathValue("publicId"))
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
		share, err := shareService.Resolve(r.Context(), r.PathValue("publicId"))
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
	share, err := shareService.Resolve(r.Context(), publicID)
	if writePublicShareError(w, r, err) {
		return
	}

	response := publicShareResponse{
		PublicID:     share.PublicID,
		ResourceType: string(share.ResourceType),
		ResourceID:   share.ResourceID,
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
	share, err := shareService.Resolve(r.Context(), r.PathValue("publicId"))
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
		ID: share.ID, PublicID: share.PublicID, ResourceType: string(share.ResourceType),
		ResourceID: share.ResourceID, CreatedBy: share.CreatedBy, CreatedAt: share.CreatedAt,
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
	case errors.Is(err, shares.ErrInvalidResourceType):
		WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid share resource type")
	default:
		WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not manage public share")
	}
	return true
}

func writePublicShareError(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, shares.ErrNotFound) {
		WriteProblem(w, r, http.StatusNotFound, "Not Found", "public resource not found")
	} else {
		WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not resolve public resource")
	}
	return true
}
