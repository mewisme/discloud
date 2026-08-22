package httpapi

import "github.com/mewisme/discloud/internal/folders"

const (
	publicFileTransferConcurrency       = 16
	publicArchiveConcurrency            = 2
	publicArchiveMaxEntries             = 2000
	publicArchiveMaxBytes         int64 = 2 * 1024 * 1024 * 1024
)

type publicShareResources struct {
	fileSlots    chan struct{}
	archiveSlots chan struct{}
}

func newPublicShareResources() *publicShareResources {
	return newPublicShareResourcesWithCapacity(
		publicFileTransferConcurrency,
		publicArchiveConcurrency,
	)
}

func newPublicShareResourcesWithCapacity(fileCapacity, archiveCapacity int) *publicShareResources {
	return &publicShareResources{
		fileSlots:    make(chan struct{}, fileCapacity),
		archiveSlots: make(chan struct{}, archiveCapacity),
	}
}

func (r *publicShareResources) tryAcquireFile() (func(), bool) {
	if r == nil {
		return nil, false
	}
	return tryAcquirePublicSlot(r.fileSlots)
}

func (r *publicShareResources) tryAcquireArchive() (func(), bool) {
	if r == nil {
		return nil, false
	}
	return tryAcquirePublicSlot(r.archiveSlots)
}

func tryAcquirePublicSlot(slots chan struct{}) (func(), bool) {
	if slots == nil {
		return nil, false
	}

	select {
	case slots <- struct{}{}:
		return func() {
			<-slots
		}, true
	default:
		return nil, false
	}
}

func publicFolderArchiveLimits() folders.ArchiveLimits {
	return folders.ArchiveLimits{
		MaxEntries: publicArchiveMaxEntries,
		MaxBytes:   publicArchiveMaxBytes,
	}
}
