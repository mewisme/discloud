package nodes

import (
	"testing"

	"github.com/mewisme/discloud/internal/acl"
)

func TestEffectiveBrowserAccess(t *testing.T) {
	tests := []struct {
		name      string
		inherited acl.Level
		direct    string
		owner     bool
		want      acl.Level
		wantErr   bool
	}{
		{name: "inherits view", inherited: acl.View, want: acl.View},
		{name: "inherits edit", inherited: acl.Edit, want: acl.Edit},
		{name: "direct raises access", inherited: acl.View, direct: "full", want: acl.Full},
		{name: "direct cannot lower inherited access", inherited: acl.Full, direct: "view", want: acl.Full},
		{name: "owner always full", inherited: acl.View, direct: "view", owner: true, want: acl.Full},
		{name: "invalid stored level", inherited: acl.View, direct: "invalid", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := effectiveBrowserAccess(test.inherited, test.direct, test.owner)
			if test.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("effectiveBrowserAccess: %v", err)
			}
			if got != test.want {
				t.Fatalf("level = %v, want %v", got, test.want)
			}
		})
	}
}
