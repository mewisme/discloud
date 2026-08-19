package observability

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
)

const TraceparentHeader = "traceparent"

type traceContextKey struct{}

type TraceContext struct {
	TraceID      string
	SpanID       string
	ParentSpanID string
	Flags        byte
}

func StartTrace(ctx context.Context, traceparent string) (context.Context, TraceContext, error) {
	parent, valid := parseTraceparent(traceparent)

	traceID := parent.TraceID
	flags := parent.Flags & 0x01
	parentSpanID := parent.SpanID

	if !valid {
		var err error
		traceID, err = randomID(16)
		if err != nil {
			return ctx, TraceContext{}, fmt.Errorf("generate trace ID: %w", err)
		}
		flags = 0
		parentSpanID = ""
	}

	spanID, err := randomID(8)
	if err != nil {
		return ctx, TraceContext{}, fmt.Errorf("generate span ID: %w", err)
	}

	trace := TraceContext{
		TraceID:      traceID,
		SpanID:       spanID,
		ParentSpanID: parentSpanID,
		Flags:        flags,
	}
	return context.WithValue(ctx, traceContextKey{}, trace), trace, nil
}

func TraceFromContext(ctx context.Context) (TraceContext, bool) {
	trace, ok := ctx.Value(traceContextKey{}).(TraceContext)
	return trace, ok
}

func TraceID(ctx context.Context) string {
	trace, _ := TraceFromContext(ctx)
	return trace.TraceID
}

func SpanID(ctx context.Context) string {
	trace, _ := TraceFromContext(ctx)
	return trace.SpanID
}

func (t TraceContext) Traceparent() string {
	return fmt.Sprintf("00-%s-%s-%02x", t.TraceID, t.SpanID, t.Flags&0x01)
}

func parseTraceparent(value string) (TraceContext, bool) {
	parts := strings.Split(strings.TrimSpace(value), "-")
	if len(parts) < 4 || len(parts[0]) != 2 {
		return TraceContext{}, false
	}

	version, err := strconv.ParseUint(parts[0], 16, 8)
	if err != nil || version == 0xff {
		return TraceContext{}, false
	}
	if version == 0 && len(parts) != 4 {
		return TraceContext{}, false
	}

	if !validTraceID(parts[1], 16) || !validTraceID(parts[2], 8) || len(parts[3]) != 2 {
		return TraceContext{}, false
	}

	flags, err := strconv.ParseUint(parts[3], 16, 8)
	if err != nil {
		return TraceContext{}, false
	}

	return TraceContext{
		TraceID: parts[1],
		SpanID:  parts[2],
		Flags:   byte(flags),
	}, true
}

func validTraceID(value string, bytes int) bool {
	if len(value) != bytes*2 {
		return false
	}

	decoded, err := hex.DecodeString(value)
	if err != nil {
		return false
	}

	for _, value := range decoded {
		if value != 0 {
			return true
		}
	}
	return false
}

func randomID(size int) (string, error) {
	value := make([]byte, size)

	for {
		if _, err := rand.Read(value); err != nil {
			return "", err
		}

		for _, b := range value {
			if b != 0 {
				return hex.EncodeToString(value), nil
			}
		}
	}
}
