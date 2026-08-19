package files

import (
	"errors"
	"strconv"
	"strings"
)

var (
	ErrInvalidRange       = errors.New("invalid byte range")
	ErrUnsatisfiableRange = errors.New("unsatisfiable byte range")
)

type ByteRange struct {
	Start int64
	End   int64
}

func (r ByteRange) Length() int64 {
	return r.End - r.Start + 1
}

func ParseRange(header string, size int64) (*ByteRange, error) {
	header = strings.TrimSpace(header)
	if header == "" {
		return nil, nil
	}
	if size < 0 {
		return nil, ErrInvalidRange
	}

	unit, spec, ok := strings.Cut(header, "=")
	if !ok || !strings.EqualFold(strings.TrimSpace(unit), "bytes") || spec == "" || strings.Contains(spec, ",") {
		return nil, ErrInvalidRange
	}

	startText, endText, ok := strings.Cut(spec, "-")
	if !ok {
		return nil, ErrInvalidRange
	}

	if startText == "" {
		suffix, err := strconv.ParseInt(endText, 10, 64)
		if err != nil || suffix <= 0 {
			return nil, ErrInvalidRange
		}
		if size == 0 {
			return nil, ErrUnsatisfiableRange
		}
		if suffix > size {
			suffix = size
		}
		return &ByteRange{Start: size - suffix, End: size - 1}, nil
	}

	start, err := strconv.ParseInt(startText, 10, 64)
	if err != nil || start < 0 {
		return nil, ErrInvalidRange
	}
	if size == 0 || start >= size {
		return nil, ErrUnsatisfiableRange
	}

	end := size - 1
	if endText != "" {
		end, err = strconv.ParseInt(endText, 10, 64)
		if err != nil || end < start {
			return nil, ErrInvalidRange
		}
		if end >= size {
			end = size - 1
		}
	}

	return &ByteRange{Start: start, End: end}, nil
}
