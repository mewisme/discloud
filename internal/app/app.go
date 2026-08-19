package app

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/mewisme/discloud/internal/acl"
	"github.com/mewisme/discloud/internal/adminusers"
	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/discordstore"
	"github.com/mewisme/discloud/internal/files"
	"github.com/mewisme/discloud/internal/folders"
	"github.com/mewisme/discloud/internal/httpapi"
	"github.com/mewisme/discloud/internal/logging"
	"github.com/mewisme/discloud/internal/nodes"
	"github.com/mewisme/discloud/internal/postgres"
	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/internal/setup"
	"github.com/mewisme/discloud/internal/uploads"
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

	tokens := make([]string, len(cfg.Discord.Bots))
	for i, bot := range cfg.Discord.Bots {
		tokens[i] = bot.Token
	}

	blobStore, err := discordstore.New(ctx, cfg.Discord.ChannelID, tokens, nil)
	if err != nil {
		return fmt.Errorf("create Discord blob store: %w", err)
	}

	setupService := setup.New(pool)
	authService := auth.NewWithMFA(pool, cfg.Auth.SessionTTL, cfg.MFA.Issuer, cfg.Encryption.MasterKey)
	adminUserService := adminusers.New(pool)
	aclService := acl.New(pool)
	nodeService := nodes.New(pool)
	uploadService := uploads.New(pool, cfg.Upload.ChunkSizeBytes, cfg.Upload.SessionTTL)
	partUploader := uploads.NewPartUploader(uploadService, blobStore)
	finalizer := uploads.NewFinalizer(uploadService, blobStore)
	fileService := files.New(pool, blobStore)
	folderService := folders.New(pool, fileService)

	go uploads.RunExpiryWorker(ctx, uploadService, logger.With("component", "upload-expiry"))

	handler := httpapi.NewRouter(httpapi.RouterDependencies{
		Ready: pool.Ping, Setup: setupService, Auth: authService, AdminUsers: adminUserService,
		ACL: aclService, Nodes: nodeService, Uploads: uploadService, PartUploader: partUploader,
		Finalizer: finalizer, Files: fileService, Folders: folderService,
	}, cfg.HTTP, cfg.Auth)

	server := httpapi.NewServer(cfg.HTTP, handler)
	logger.Info("HTTP server started", "address", server.Addr)

	if err := runServer(ctx, server, cfg.HTTP.ShutdownTimeout); err != nil {
		return err
	}

	logger.Info("application stopped")
	return nil
}
