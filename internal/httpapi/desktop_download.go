package httpapi

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/collections"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/files"
	"github.com/mewisme/discloud/internal/folders"
)

type desktopFileManifestResponse struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Size            int64  `json:"size"`
	ChunkSize       int64  `json:"chunkSize"`
	ChunkCount      int    `json:"chunkCount"`
	ChunkWindowSize int    `json:"chunkWindowSize"`
	SHA256          string `json:"sha256"`
}

type desktopChunkResponse struct {
	Index     int       `json:"index"`
	Offset    int64     `json:"offset"`
	Size      int64     `json:"size"`
	SHA256    string    `json:"sha256"`
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type desktopChunkWindowResponse struct {
	Chunks    []desktopChunkResponse `json:"chunks"`
	NextStart *int                   `json:"nextStart,omitempty"`
}

type desktopFolderEntryResponse struct {
	Path   string `json:"path"`
	Kind   string `json:"kind"`
	FileID string `json:"fileId,omitempty"`
	Size   int64  `json:"size,omitempty"`
}

type desktopFolderManifestResponse struct {
	Entries []desktopFolderEntryResponse `json:"entries"`
}

func registerDesktopDownloadRoutes(mux *http.ServeMux, fileService *files.Service, folderService *folders.Service, collectionService *collections.Service, authService *auth.Service, cfg config.AuthConfig) {
	protected := func(pattern string, handler http.HandlerFunc) {
		mux.Handle(pattern, requireAuth(authService, cfg, handler))
	}
	protected("GET /api/v1/files/{fileId}/desktop-download/manifest", func(w http.ResponseWriter, r *http.Request) {
		file, err := getFileForRequest(r, fileService, collectionService, r.PathValue("fileId"), strings.TrimSpace(r.URL.Query().Get("collectionId")))
		if writeFileContextError(w, r, err) {
			return
		}
		chunkCount := 0
		if file.SizeBytes > 0 && file.ChunkSizeBytes > 0 {
			chunkCount = int((file.SizeBytes + file.ChunkSizeBytes - 1) / file.ChunkSizeBytes)
		}
		response := desktopFileManifestResponse{ID: file.ID, Name: file.Name, Size: file.SizeBytes, ChunkSize: file.ChunkSizeBytes, ChunkCount: chunkCount, ChunkWindowSize: files.DesktopDownloadChunkWindowSize}
		if len(file.SHA256) == 32 {
			response.SHA256 = hex.EncodeToString(file.SHA256)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(response)
	})
	protected("GET /api/v1/files/{fileId}/desktop-download/chunks", func(w http.ResponseWriter, r *http.Request) {
		file, err := getFileForRequest(r, fileService, collectionService, r.PathValue("fileId"), strings.TrimSpace(r.URL.Query().Get("collectionId")))
		if writeFileContextError(w, r, err) {
			return
		}
		start, err := parseDesktopDownloadInt(r.URL.Query().Get("start"), 0)
		if err != nil || start < 0 {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid chunk start")
			return
		}
		limit, err := parseDesktopDownloadInt(r.URL.Query().Get("limit"), files.DesktopDownloadChunkWindowSize)
		if err != nil || limit < 1 || limit > files.DesktopDownloadChunkWindowSize {
			WriteProblem(w, r, http.StatusBadRequest, "Bad Request", "invalid chunk limit")
			return
		}
		refresh := r.URL.Query().Get("refresh") == "1" || strings.EqualFold(r.URL.Query().Get("refresh"), "true")
		chunks, err := fileService.ResolveStoredDownloadChunks(r.Context(), file, start, limit, refresh)
		if writeFileError(w, r, err) {
			return
		}
		response := desktopChunkWindowResponse{Chunks: make([]desktopChunkResponse, 0, len(chunks))}
		for _, chunk := range chunks {
			response.Chunks = append(response.Chunks, desktopChunkResponse{Index: chunk.Index, Offset: chunk.Offset, Size: chunk.SizeBytes, SHA256: hex.EncodeToString(chunk.SHA256[:]), URL: chunk.URL, ExpiresAt: chunk.ExpiresAt})
		}
		if len(chunks) == limit && start+len(chunks) < int((file.SizeBytes+file.ChunkSizeBytes-1)/file.ChunkSizeBytes) {
			next := start + len(chunks)
			response.NextStart = &next
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(response)
	})
	if folderService != nil {
		protected("GET /api/v1/folders/{folderId}/desktop-download/manifest", func(w http.ResponseWriter, r *http.Request) {
			archive, err := folderService.PrepareArchive(r.Context(), folderActor(r), r.PathValue("folderId"))
			if errors.Is(err, folders.ErrNotFound) {
				WriteProblem(w, r, http.StatusNotFound, "Not Found", "folder not found")
				return
			}
			if err != nil {
				WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", "could not prepare folder manifest")
				return
			}
			response := desktopFolderManifestResponse{Entries: make([]desktopFolderEntryResponse, 0, len(archive.Entries))}
			for _, entry := range archive.Entries {
				item := desktopFolderEntryResponse{Path: entry.Path, Kind: entry.Kind, Size: entry.SizeBytes}
				if entry.Kind == "file" {
					item.FileID = entry.NodeID
				}
				response.Entries = append(response.Entries, item)
			}
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			_ = json.NewEncoder(w).Encode(response)
		})
	}
}

func parseDesktopDownloadInt(value string, fallback int) (int, error) {
	if strings.TrimSpace(value) == "" {
		return fallback, nil
	}
	return strconv.Atoi(value)
}
