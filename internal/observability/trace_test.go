package observability

import (
	"context"
	"strings"
	"testing"
)

func TestStartTraceContinuesIncomingTrace(t *testing.T) {
	const incoming = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"

	ctx, trace, err := StartTrace(context.Background(), incoming)
	if err != nil {
		t.Fatalf("StartTrace(): %v", err)
	}

	if trace.TraceID != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Fatalf("TraceID = %q", trace.TraceID)
	}
	if trace.ParentSpanID != "00f067aa0ba902b7" {
		t.Fatalf("ParentSpanID = %q", trace.ParentSpanID)
	}
	if trace.SpanID == trace.ParentSpanID || len(trace.SpanID) != 16 {
		t.Fatalf("SpanID = %q", trace.SpanID)
	}
	if trace.Flags != 1 {
		t.Fatalf("Flags = %d", trace.Flags)
	}

	stored, ok := TraceFromContext(ctx)
	if !ok || stored != trace {
		t.Fatalf("stored trace = %+v", stored)
	}

	if !strings.HasPrefix(
		trace.Traceparent(),
		"00-4bf92f3577b34da6a3ce929d0e0e4736-",
	) {
		t.Fatalf("traceparent = %q", trace.Traceparent())
	}
}

func TestStartTraceReplacesInvalidTraceparent(t *testing.T) {
	_, trace, err := StartTrace(
		context.Background(),
		"00-00000000000000000000000000000000-0000000000000000-01",
	)
	if err != nil {
		t.Fatalf("StartTrace(): %v", err)
	}

	if len(trace.TraceID) != 32 || len(trace.SpanID) != 16 {
		t.Fatalf("trace = %+v", trace)
	}
	if trace.ParentSpanID != "" {
		t.Fatalf("ParentSpanID = %q", trace.ParentSpanID)
	}
	if trace.Flags != 0 {
		t.Fatalf("Flags = %d", trace.Flags)
	}
}
