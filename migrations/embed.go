package migrations

import "embed"

// FS contains all database migration sources compiled into the server binary.
//
//go:embed *
var FS embed.FS
