package thumbnails

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/mewisme/discloud/internal/files"
)

const (
	videoThumbnailConcurrency         = 2
	videoThumbnailTimeout             = 45 * time.Second
	videoThumbnailReadBudget    int64 = 128 * 1024 * 1024
	videoThumbnailHeaderTimeout       = 5 * time.Second
	videoThumbnailIdleTimeout         = 5 * time.Second
)

var (
	errVideoThumbnailReadBudget = errors.New("video thumbnail read budget exceeded")
	errVideoThumbnailTimeout    = errors.New("video thumbnail processing timed out")
)

type storedRangeOpener interface {
	OpenStored(context.Context, string, int64, int64) (files.File, io.ReadCloser, error)
}

type videoRangeSource struct {
	server   *http.Server
	done     chan error
	url      string
	budget   *readBudget
	limitHit *atomic.Bool
}

type videoRangeHandler struct {
	path     string
	opener   storedRangeOpener
	file     files.File
	budget   *readBudget
	limitHit *atomic.Bool
}

type videoRangeSeeker struct {
	ctx      context.Context
	opener   storedRangeOpener
	file     files.File
	budget   *readBudget
	limitHit *atomic.Bool
	position int64
	current  io.ReadCloser
}

type readBudget struct {
	remaining atomic.Int64
}

func newVideoRangeSource(ctx context.Context, opener storedRangeOpener, file files.File, budgetBytes int64) (*videoRangeSource, error) {
	if opener == nil {
		return nil, errors.New("video range opener is unavailable")
	}
	if strings.TrimSpace(file.ID) == "" || file.SizeBytes <= 0 {
		return nil, errors.New("video range source is invalid")
	}
	if budgetBytes <= 0 {
		return nil, errors.New("video range read budget must be greater than zero")
	}

	token, err := randomRangeToken()
	if err != nil {
		return nil, err
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listen for video range source: %w", err)
	}

	budget := newReadBudget(budgetBytes)
	limitHit := &atomic.Bool{}
	sourcePath := "/" + token
	handler := &videoRangeHandler{
		path:     sourcePath,
		opener:   opener,
		file:     file,
		budget:   budget,
		limitHit: limitHit,
	}

	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: videoThumbnailHeaderTimeout,
		IdleTimeout:       videoThumbnailIdleTimeout,
		MaxHeaderBytes:    8 * 1024,
		BaseContext: func(net.Listener) context.Context {
			return ctx
		},
	}

	source := &videoRangeSource{
		server:   server,
		done:     make(chan error, 1),
		url:      "http://" + listener.Addr().String() + sourcePath,
		budget:   budget,
		limitHit: limitHit,
	}

	go func() {
		err := server.Serve(listener)
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		source.done <- err
		close(source.done)
	}()

	return source, nil
}

func (s *videoRangeSource) URL() string {
	if s == nil {
		return ""
	}
	return s.url
}

func (s *videoRangeSource) LimitHit() bool {
	if s == nil || s.budget == nil || s.limitHit == nil {
		return false
	}
	return s.limitHit.Load() || s.budget.remaining.Load() <= 0
}

func (s *videoRangeSource) Close() error {
	if s == nil || s.server == nil {
		return nil
	}

	closeErr := s.server.Close()
	serveErr := <-s.done
	if closeErr != nil {
		return closeErr
	}
	return serveErr
}

func (h *videoRangeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != h.path {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	mimeType := strings.TrimSpace(h.file.MIMEType)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Accept-Ranges", "bytes")

	seeker := &videoRangeSeeker{
		ctx:      r.Context(),
		opener:   h.opener,
		file:     h.file,
		budget:   h.budget,
		limitHit: h.limitHit,
	}
	defer seeker.Close()

	http.ServeContent(w, r, h.file.Name, h.file.UpdatedAt, seeker)
}

func (s *videoRangeSeeker) Read(buffer []byte) (int, error) {
	if len(buffer) == 0 {
		return 0, nil
	}
	if err := s.ctx.Err(); err != nil {
		return 0, err
	}
	if s.position >= s.file.SizeBytes {
		return 0, io.EOF
	}

	length := int64(len(buffer))
	if remaining := s.file.SizeBytes - s.position; length > remaining {
		length = remaining
	}

	reserved := s.budget.reserve(length)
	if reserved <= 0 {
		s.limitHit.Store(true)
		return 0, errVideoThumbnailReadBudget
	}

	if s.current == nil {
		_, reader, err := s.opener.OpenStored(
			s.ctx,
			s.file.ID,
			s.position,
			s.file.SizeBytes-s.position,
		)
		if err != nil {
			s.budget.release(reserved)
			return 0, err
		}
		s.current = reader
	}

	n, err := s.current.Read(buffer[:int(reserved)])
	s.position += int64(n)

	if unused := reserved - int64(n); unused > 0 {
		s.budget.release(unused)
	}

	if err != nil {
		closeErr := s.current.Close()
		s.current = nil
		if err == nil {
			err = closeErr
		}
	}

	if n == 0 && err == nil {
		return 0, io.ErrNoProgress
	}
	return n, err
}

func (s *videoRangeSeeker) Seek(offset int64, whence int) (int64, error) {
	var position int64

	switch whence {
	case io.SeekStart:
		position = offset
	case io.SeekCurrent:
		position = s.position + offset
	case io.SeekEnd:
		position = s.file.SizeBytes + offset
	default:
		return s.position, errors.New("invalid video range seek mode")
	}

	if position < 0 || position > s.file.SizeBytes {
		return s.position, errors.New("invalid video range seek offset")
	}
	if position == s.position {
		return position, nil
	}

	if err := s.closeCurrent(); err != nil {
		return s.position, err
	}

	s.position = position
	return position, nil
}

func (s *videoRangeSeeker) Close() error {
	return s.closeCurrent()
}

func (s *videoRangeSeeker) closeCurrent() error {
	if s.current == nil {
		return nil
	}

	err := s.current.Close()
	s.current = nil
	return err
}

func newReadBudget(limit int64) *readBudget {
	budget := &readBudget{}
	budget.remaining.Store(limit)
	return budget
}

func (b *readBudget) reserve(length int64) int64 {
	if b == nil || length <= 0 {
		return 0
	}

	for {
		remaining := b.remaining.Load()
		if remaining <= 0 {
			return 0
		}

		reserved := length
		if reserved > remaining {
			reserved = remaining
		}

		if b.remaining.CompareAndSwap(remaining, remaining-reserved) {
			return reserved
		}
	}
}

func (b *readBudget) release(length int64) {
	if b != nil && length > 0 {
		b.remaining.Add(length)
	}
}

func randomRangeToken() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate video range token: %w", err)
	}
	return hex.EncodeToString(value), nil
}
