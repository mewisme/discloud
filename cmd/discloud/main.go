package main

import (
	"fmt"
	"os"

	"github.com/mewisme/discloud/internal/app"
)

func main() {
	if err := app.Run(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
