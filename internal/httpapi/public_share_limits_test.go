package httpapi

import "testing"

func TestPublicShareFileCapacity(t *testing.T) {
	resources := newPublicShareResourcesWithCapacity(2, 1)

	first, ok := resources.tryAcquireFile()
	if !ok {
		t.Fatal("first file slot was rejected")
	}
	second, ok := resources.tryAcquireFile()
	if !ok {
		t.Fatal("second file slot was rejected")
	}

	if release, ok := resources.tryAcquireFile(); ok {
		release()
		t.Fatal("file transfer exceeded configured capacity")
	}

	first()

	third, ok := resources.tryAcquireFile()
	if !ok {
		t.Fatal("released file slot was not reusable")
	}

	second()
	third()
}

func TestPublicShareArchiveCapacity(t *testing.T) {
	resources := newPublicShareResourcesWithCapacity(2, 1)

	first, ok := resources.tryAcquireArchive()
	if !ok {
		t.Fatal("first archive slot was rejected")
	}

	if release, ok := resources.tryAcquireArchive(); ok {
		release()
		t.Fatal("archive exceeded configured capacity")
	}

	first()

	second, ok := resources.tryAcquireArchive()
	if !ok {
		t.Fatal("released archive slot was not reusable")
	}
	second()
}

func TestPublicFolderArchiveLimits(t *testing.T) {
	limits := publicFolderArchiveLimits()

	if limits.MaxEntries != publicArchiveMaxEntries {
		t.Fatalf("MaxEntries = %d, want %d", limits.MaxEntries, publicArchiveMaxEntries)
	}
	if limits.MaxBytes != publicArchiveMaxBytes {
		t.Fatalf("MaxBytes = %d, want %d", limits.MaxBytes, publicArchiveMaxBytes)
	}
}
