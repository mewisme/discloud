package migrations

import (
	"io/fs"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
)

var migrationNamePattern = regexp.MustCompile(
	`^(\d{6})_[a-z0-9][a-z0-9_]*\.sql$`,
)

func TestMigrationSequence(t *testing.T) {
	names, err := fs.Glob(FS, "*.sql")
	if err != nil {
		t.Fatalf("list migrations: %v", err)
	}
	if len(names) == 0 {
		t.Fatal("no migrations found")
	}

	sort.Strings(names)

	for index, name := range names {
		match := migrationNamePattern.FindStringSubmatch(name)
		if match == nil {
			t.Fatalf(
				"migration %q does not match NNNNNN_name.sql",
				name,
			)
		}

		version, err := strconv.Atoi(match[1])
		if err != nil {
			t.Fatalf(
				"parse migration version %q: %v",
				name,
				err,
			)
		}

		want := index + 1
		if version != want {
			t.Fatalf(
				"migration %q has version %d, want %06d",
				name,
				version,
				want,
			)
		}
	}
}

func TestMigrationsAreForwardOnlyAndExplicit(t *testing.T) {
	names, err := fs.Glob(FS, "*.sql")
	if err != nil {
		t.Fatalf("list migrations: %v", err)
	}

	for _, name := range names {
		name := name

		t.Run(name, func(t *testing.T) {
			content, err := fs.ReadFile(FS, name)
			if err != nil {
				t.Fatalf("read migration: %v", err)
			}

			sql := strings.TrimSpace(string(content))
			if !strings.HasPrefix(sql, "-- +goose Up") {
				t.Fatal("migration must begin with -- +goose Up")
			}

			if strings.Contains(sql, "-- +goose Down") {
				t.Fatal(
					"DisCloud migrations are forward-only; " +
						"do not add Down migrations",
				)
			}

			if strings.Contains(
				sql,
				"-- discloud: allow-destructive",
			) {
				return
			}

			executable := migrationExecutableSQL(sql)

			for _, keyword := range []string{
				"DROP TABLE",
				"DROP COLUMN",
				"TRUNCATE TABLE",
			} {
				if strings.Contains(executable, keyword) {
					t.Fatalf(
						"destructive migration contains %q; "+
							"add an explicit "+
							"-- discloud: allow-destructive "+
							"review marker if intentional",
						keyword,
					)
				}
			}
		})
	}
}

func migrationExecutableSQL(value string) string {
	var result strings.Builder

	for _, line := range strings.Split(value, "\n") {
		if index := strings.Index(line, "--"); index >= 0 {
			line = line[:index]
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		result.WriteString(strings.ToUpper(line))
		result.WriteByte(' ')
	}

	return result.String()
}
