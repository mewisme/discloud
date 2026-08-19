package files

import "testing"

func FuzzCanonicalMIME(f *testing.F) {
	f.Add(
		[]byte("%PDF-1.7\n"),
		"txt",
		"text/plain",
	)
	f.Add(
		[]byte{0, 1, 2, 3},
		"pdf",
		"text/plain",
	)
	f.Add(
		[]byte{0, 1, 2, 3},
		"",
		"Video/MP4; codecs=avc1",
	)
	f.Add(
		[]byte{},
		"",
		"",
	)
	f.Add(
		[]byte("<html>"),
		"bin",
		"application/octet-stream",
	)

	f.Fuzz(func(t *testing.T, prefix []byte, extension, hint string) {
		got := canonicalMIME(prefix, extension, hint)
		if got == "" {
			t.Fatal("canonicalMIME returned empty MIME")
		}

		if normalized := normalizeMIME(got); normalized != got {
			t.Fatalf(
				"canonical MIME %q is not normalized; normalizeMIME = %q",
				got,
				normalized,
			)
		}

		switch categoryForMIME(got) {
		case "image",
			"video",
			"audio",
			"document",
			"text",
			"archive",
			"application",
			"binary",
			"other":
		default:
			t.Fatalf("MIME %q produced invalid category", got)
		}
	})
}

func FuzzNormalizeMIME(f *testing.F) {
	for _, seed := range []string{
		"text/plain",
		"Text/Plain",
		"text/plain; charset=utf-8",
		"Video/MP4; codecs=avc1",
		"",
		"invalid",
		"text/",
		"../../etc/passwd",
	} {
		f.Add(seed)
	}

	f.Fuzz(func(t *testing.T, value string) {
		got := normalizeMIME(value)
		if got == "" {
			return
		}

		second := normalizeMIME(got)
		if second != got {
			t.Fatalf(
				"normalizeMIME is not idempotent: %q -> %q -> %q",
				value,
				got,
				second,
			)
		}
	})
}
