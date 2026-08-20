package httpapi

import (
	"errors"
	"net/http"

	"github.com/mewisme/discloud/internal/blobstore"
	"github.com/mewisme/discloud/internal/objects"
)

func writeObjectStorageError(w http.ResponseWriter, r *http.Request, err error, detail string) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, objects.ErrUnavailable) {
		WriteProblem(w, r, http.StatusServiceUnavailable, "Service Unavailable", detail)
		return true
	}

	class, retryable := blobstore.Classify(err)
	if class != "unknown" {
		status := http.StatusBadGateway
		if retryable {
			status = http.StatusServiceUnavailable
		}
		WriteProblem(w, r, status, http.StatusText(status), detail)
		return true
	}
	WriteProblem(w, r, http.StatusInternalServerError, "Internal Server Error", detail)
	return true
}

func writeObjectRedirect(w http.ResponseWriter, rawURL, cacheControl string) {
	w.Header().Set("Cache-Control", cacheControl)
	w.Header().Set("Location", rawURL)
	w.WriteHeader(http.StatusTemporaryRedirect)
}
