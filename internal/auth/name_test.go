package auth

import "testing"

func TestNormalizeName(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "trim", input: "  Alice Example  ", want: "Alice Example"},
		{name: "unicode", input: " Nguyễn Văn A ", want: "Nguyễn Văn A"},
		{name: "empty", input: "   ", wantErr: true},
		{name: "too long", input: string(make([]rune, 101)), wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := test.input
			if test.name == "too long" {
				runes := make([]rune, 101)
				for i := range runes {
					runes[i] = 'a'
				}
				input = string(runes)
			}

			got, err := NormalizeName(input)
			if test.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("NormalizeName() error = %v", err)
			}
			if got != test.want {
				t.Fatalf("NormalizeName() = %q, want %q", got, test.want)
			}
		})
	}
}
