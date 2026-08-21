package uploads

import (
	"mime"
	"path/filepath"
	"strings"
)

func isMediaUpload(name, mimeTypeHint string) bool {
	if isMediaMIMEType(normalizeMediaType(mimeTypeHint)) {
		return true
	}

	extension := strings.ToLower(filepath.Ext(name))
	if extension == "" {
		return false
	}

	return isMediaMIMEType(normalizeMediaType(mime.TypeByExtension(extension)))
}

func normalizeMediaType(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	mediaType, _, err := mime.ParseMediaType(value)
	if err != nil {
		return ""
	}

	return strings.ToLower(mediaType)
}

func isMediaMIMEType(value string) bool {
	return strings.HasPrefix(value, "image/") ||
		strings.HasPrefix(value, "video/") ||
		strings.HasPrefix(value, "audio/")
}
