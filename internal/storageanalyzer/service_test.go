package storageanalyzer

import (
	"errors"
	"testing"
)

func TestNormalizeOwnerID(t *testing.T) {
	tests := []struct {
		name      string
		actor     Actor
		requested string
		want      string
		wantErr   error
	}{
		{name: "defaults to actor", actor: Actor{UserID: "self"}, want: "self"},
		{name: "allows self", actor: Actor{UserID: "self"}, requested: "self", want: "self"},
		{name: "admin can select owner", actor: Actor{UserID: "admin", Admin: true}, requested: "other", want: "other"},
		{name: "user cannot select another owner", actor: Actor{UserID: "self"}, requested: "other", wantErr: ErrForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeOwnerID(tt.actor, tt.requested)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("error = %v, want %v", err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("owner = %q, want %q", got, tt.want)
			}
		})
	}
}
