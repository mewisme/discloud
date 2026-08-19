package app

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/mewisme/discloud/internal/adminusers"
	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/httpapi"
	"github.com/mewisme/discloud/internal/logging"
	"github.com/mewisme/discloud/internal/postgres"
	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/internal/setup"
	"github.com/mewisme/discloud/migrations"
)

func Run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	if err := cfg.Validate(); err != nil {
		return fmt.Errorf("validate config: %w", err)
	}

	logger, err := logging.New(os.Stdout, cfg.Log)
	if err != nil {
		return fmt.Errorf("create logger: %w", err)
	}
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := postgres.Open(ctx, cfg.Database)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := migrate.Up(ctx, pool, migrations.FS, logger.With("component", "migrations")); err != nil {
		return err
	}

	setupService := setup.New(pool)
	authService := auth.NewWithMFA(pool, cfg.Auth.SessionTTL, cfg.MFA.Issuer, cfg.Encryption.MasterKey)
	adminUserService := adminusers.New(pool)

	handler := httpapi.NewRouter(
		httpapi.RouterDependencies{
			Ready:      pool.Ping,
			Setup:      setupService,
			Auth:       authService,
			AdminUsers: adminUserService,
		},
		cfg.HTTP,
		cfg.Auth,
	)

	server := httpapi.NewServer(cfg.HTTP, handler)

	logger.Info("HTTP server started", "address", server.Addr)

	if err := runServer(ctx, server, cfg.HTTP.ShutdownTimeout); err != nil {
		return err
	}

	logger.Info("application stopped")
	return nil
}
