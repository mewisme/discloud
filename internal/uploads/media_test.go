package uploads

import "testing"

func TestIsMediaUpload(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		fileName     string
		mimeTypeHint string
		want         bool
	}{
		{name: "image MIME", fileName: "image.bin", mimeTypeHint: "image/png", want: true},
		{name: "video MIME", fileName: "video.bin", mimeTypeHint: "video/mp4", want: true},
		{name: "audio MIME", fileName: "audio.bin", mimeTypeHint: "audio/mpeg", want: true},
		{name: "MIME parameters", fileName: "video.bin", mimeTypeHint: "video/mp4; codecs=avc1", want: true},
		{name: "video extension fallback", fileName: "video.mp4", want: true},
		{name: "audio extension fallback", fileName: "track.mp3", want: true},
		{name: "image extension fallback", fileName: "photo.webp", want: true},
		{name: "document", fileName: "document.pdf", mimeTypeHint: "application/pdf", want: false},
		{name: "archive", fileName: "archive.zip", mimeTypeHint: "application/zip", want: false},
		{name: "unknown", fileName: "data.bin", mimeTypeHint: "application/octet-stream", want: false},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			if got := isMediaUpload(test.fileName, test.mimeTypeHint); got != test.want {
				t.Fatalf("isMediaUpload(%q, %q) = %v, want %v", test.fileName, test.mimeTypeHint, got, test.want)
			}
		})
	}
}
