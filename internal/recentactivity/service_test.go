package recentactivity

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestNormalizeOwnerID(t *testing.T) {
	tests := []struct {
		name            string
		actor           Actor
		requested, want string
		wantErr         error
	}{
		{name: "defaults to actor", actor: Actor{UserID: "self"}, want: "self"},
		{name: "self allowed", actor: Actor{UserID: "self"}, requested: "self", want: "self"},
		{name: "foreign denied", actor: Actor{UserID: "self"}, requested: "other", wantErr: ErrForbidden},
		{name: "admin foreign allowed", actor: Actor{UserID: "admin", Admin: true}, requested: "other", want: "other"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := normalizeOwnerID(test.actor, test.requested)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("error = %v, want %v", err, test.wantErr)
			}
			if got != test.want {
				t.Fatalf("owner = %q, want %q", got, test.want)
			}
		})
	}
}

func TestNormalizeSyncItemDoesNotExposeLocalPath(t *testing.T) {
	metadata := json.RawMessage(`{"remoteFolderId":"folder-1","remoteFolderName":"Photos","localPath":"C:/secret","result":{"uploaded":2,"downloaded":1}}`)
	item := normalizeItem(rawItem{ID: "event", Action: "sync.run", Metadata: metadata})
	if item.Target.ID != "folder-1" || item.Target.Name != "Photos" {
		t.Fatalf("unexpected target: %#v", item.Target)
	}
	encoded, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) == "" || contains(string(encoded), "C:/secret") {
		t.Fatalf("local path leaked: %s", encoded)
	}
}

func TestNormalizeItemKinds(t *testing.T) {
	tests := []struct {
		action, wantKind string
		admin            bool
	}{
		{action: "file.create", wantKind: "upload"},
		{action: "file.version.create", wantKind: "upload"},
		{action: "node.rename", wantKind: "rename"},
		{action: "node.move", wantKind: "move"},
		{action: "node.trash", wantKind: "trash"},
		{action: "node.restore", wantKind: "restore"},
		{action: "share.create", wantKind: "share"},
		{action: "share.update", wantKind: "share"},
		{action: "share.revoke", wantKind: "share"},
		{action: "sync.run", wantKind: "sync"},
		{action: "user.update", wantKind: "admin", admin: true},
	}
	for _, test := range tests {
		t.Run(test.action, func(t *testing.T) {
			raw := rawItem{Action: test.action, NodeID: "node", NodeName: "File", NodeKind: "file", ShareNodeID: "node", ShareNodeName: "File", ShareNodeKind: "file", ResourceUserID: "user", ResourceUsername: "target"}
			item := normalizeItem(raw)
			if item.Kind != test.wantKind || item.AdminOnly != test.admin {
				t.Fatalf("kind/admin = %q/%v, want %q/%v", item.Kind, item.AdminOnly, test.wantKind, test.admin)
			}
			if test.admin && item.Target.Name != "target" {
				t.Fatalf("admin target name = %q, want target", item.Target.Name)
			}
		})
	}
}

func contains(value, needle string) bool {
	return len(needle) > 0 && len(value) >= len(needle) && func() bool {
		for i := 0; i+len(needle) <= len(value); i++ {
			if value[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	}()
}
