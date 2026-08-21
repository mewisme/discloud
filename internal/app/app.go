package app

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mewisme/discloud/internal/acl"
	"github.com/mewisme/discloud/internal/adminops"
	"github.com/mewisme/discloud/internal/adminusers"
	"github.com/mewisme/discloud/internal/auth"
	"github.com/mewisme/discloud/internal/avatars"
	"github.com/mewisme/discloud/internal/collections"
	"github.com/mewisme/discloud/internal/config"
	"github.com/mewisme/discloud/internal/discordstore"
	"github.com/mewisme/discloud/internal/files"
	"github.com/mewisme/discloud/internal/folders"
	"github.com/mewisme/discloud/internal/httpapi"
	"github.com/mewisme/discloud/internal/jobs"
	"github.com/mewisme/discloud/internal/logging"
	"github.com/mewisme/discloud/internal/nodes"
	"github.com/mewisme/discloud/internal/objects"
	"github.com/mewisme/discloud/internal/observability"
	"github.com/mewisme/discloud/internal/orphangc"
	"github.com/mewisme/discloud/internal/postgres"
	"github.com/mewisme/discloud/internal/postgres/migrate"
	"github.com/mewisme/discloud/internal/search"
	"github.com/mewisme/discloud/internal/settings"
	"github.com/mewisme/discloud/internal/setup"
	"github.com/mewisme/discloud/internal/shares"
	"github.com/mewisme/discloud/internal/thumbnails"
	"github.com/mewisme/discloud/internal/uploads"
	"github.com/mewisme/discloud/migrations"
)

func Run() error {
	startedAt := time.Now()

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

	appLogger := logger.With("component", "app")
	appLogger.Info(
		"application starting",
		"listen_address", cfg.HTTP.ListenAddress,
		"log_level", cfg.Log.Level,
		"discord_bots", len(cfg.Discord.Bots),
		"job_workers", cfg.Jobs.WorkerCount,
		"upload_chunk_size_bytes", cfg.Upload.ChunkSizeBytes,
		"media_chunk_size_bytes", cfg.Upload.MediaChunkSizeBytes,
		"upload_session_ttl", cfg.Upload.SessionTTL.String(),
	)

	ctx, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()

	dbLogger := logger.With("component", "database")
	dbStartedAt := time.Now()

	pool, err := postgres.Open(ctx, cfg.Database)
	if err != nil {
		return err
	}
	defer pool.Close()

	dbLogger.Info(
		"database connected",
		"min_connections", cfg.Database.MinConnections,
		"max_connections", cfg.Database.MaxConnections,
		"duration_ms", time.Since(dbStartedAt).Milliseconds(),
	)

	migrationStartedAt := time.Now()

	if err := migrate.Up(
		ctx,
		pool,
		migrations.FS,
		logger.With("component", "migrations"),
	); err != nil {
		return err
	}

	dbLogger.Info(
		"database migrations ready",
		"duration_ms", time.Since(migrationStartedAt).Milliseconds(),
	)

	tokens := make([]string, len(cfg.Discord.Bots))
	for i, bot := range cfg.Discord.Bots {
		tokens[i] = bot.Token
	}

	discordStartedAt := time.Now()

	blobStore, err := discordstore.New(
		ctx,
		cfg.Discord.ChannelID,
		tokens,
		nil,
	)
	if err != nil {
		return fmt.Errorf("create Discord blob store: %w", err)
	}

	logDiscordStartup(
		logger.With("component", "discord"),
		blobStore.RuntimeSnapshot(),
		time.Since(discordStartedAt),
	)

	setupService := setup.New(pool)
	authService := auth.NewWithMFA(
		pool,
		cfg.Auth.SessionTTL,
		cfg.MFA.Issuer,
		cfg.Encryption.MasterKey,
	)
	adminUserService := adminusers.New(pool)
	adminOpsService := adminops.New(pool)
	metrics := observability.NewMetrics(pool)
	aclService := acl.New(pool)
	nodeService := nodes.New(pool)
	uploadService := uploads.NewWithChunkSizes(
		pool,
		cfg.Upload.ChunkSizeBytes,
		cfg.Upload.MediaChunkSizeBytes,
		cfg.Upload.SessionTTL,
		blobStore,
	)
	partUploader := uploads.NewPartUploader(uploadService, blobStore)
	finalizer := uploads.NewFinalizer(uploadService, blobStore)
	fileService := files.New(pool, blobStore)
	folderService := folders.New(pool, fileService)
	collectionService := collections.New(pool)
	shareService := shares.New(pool, collectionService)
	searchService := search.New(pool)
	settingsService := settings.New(pool)
	objectService := objects.New(pool, blobStore, objects.DefaultMaxSize)
	avatarService := avatars.New(pool, objectService)
	thumbnailService := thumbnails.New(pool, fileService, objectService)
	metadataProcessor := files.NewMetadataProcessor(fileService)
	orphanCleaner := orphangc.New(
		pool,
		blobStore,
		logger.With("component", "orphan-gc"),
	)

	appLogger.Info("application services initialized")

	go uploads.RunExpiryWorker(
		ctx,
		uploadService,
		logger.With("component", "upload-expiry"),
	)
	go orphanCleaner.Run(ctx)
	go objectService.RunGC(ctx, logger.With("component", "object-gc"))

	jobWorker := jobs.NewWorker(
		pool,
		logger.With("component", "jobs"),
		map[string]jobs.Handler{
			"file.metadata":  metadataProcessor.Handle,
			"file.thumbnail": thumbnailService.Handle,
		},
	)

	for i := range cfg.Jobs.WorkerCount {
		go jobWorker.Run(
			ctx,
			fmt.Sprintf("job-worker-%d", i+1),
		)
	}

	logger.Info(
		"background workers started",
		"component", "workers",
		"job_workers", cfg.Jobs.WorkerCount,
		"upload_expiry", true,
		"orphan_gc", true,
		"object_gc", true,
	)

	readyCheck := readinessCheck(pool, blobStore)

	handler := httpapi.NewRouter(
		httpapi.RouterDependencies{
			Ready:        readyCheck,
			Setup:        setupService,
			Auth:         authService,
			Avatars:      avatarService,
			AdminUsers:   adminUserService,
			AdminOps:     adminOpsService,
			BotRuntime:   blobStore,
			Metrics:      metrics,
			ACL:          aclService,
			Nodes:        nodeService,
			Uploads:      uploadService,
			PartUploader: partUploader,
			Finalizer:    finalizer,
			Files:        fileService,
			Thumbnails:   thumbnailService,
			Folders:      folderService,
			Collections:  collectionService,
			Shares:       shareService,
			Search:       searchService,
			Settings:     settingsService,
		},
		cfg.HTTP,
		cfg.Auth,
	)

	if err := readyCheck(ctx); err != nil {
		appLogger.Warn(
			"startup readiness check failed",
			"error", err,
			"startup_duration_ms", time.Since(startedAt).Milliseconds(),
		)
	} else {
		appLogger.Info(
			"startup readiness check passed",
			"startup_duration_ms", time.Since(startedAt).Milliseconds(),
		)
	}

	server := httpapi.NewServer(cfg.HTTP, handler)
	httpLogger := logger.With("component", "http", "address", server.Addr)

	if cfg.HTTP.PublicBaseURL != nil {
		httpLogger.Info(
			"HTTP server starting",
			"public_base_url", cfg.HTTP.PublicBaseURL.String(),
		)
	} else {
		httpLogger.Info("HTTP server starting")
	}

	if err := runServer(
		ctx,
		server,
		cfg.HTTP.ShutdownTimeout,
	); err != nil {
		return err
	}

	appLogger.Info(
		"application stopped",
		"uptime_ms", time.Since(startedAt).Milliseconds(),
	)

	return nil
}

func logDiscordStartup(
	logger *slog.Logger,
	snapshot discordstore.BotRuntimeSnapshot,
	duration time.Duration,
) {
	for _, bot := range snapshot.Bots {
		if !bot.Resolved {
			logger.Warn(
				"Discord bot unresolved",
				"config_index", bot.ConfigIndex,
				"error_class", bot.ResolveErrorClass,
				"error", bot.ResolveErrorMessage,
			)
			continue
		}

		logger.Info(
			"Discord bot loaded",
			"config_index", bot.ConfigIndex,
			"user_id", bot.UserID,
			"username", bot.Username,
			"display_name", bot.DisplayName,
			"state", bot.State,
		)
	}

	args := []any{
		"configured", snapshot.Capacity.Configured,
		"resolved", snapshot.Resolved,
		"unresolved", snapshot.Unresolved,
		"effective_capacity", snapshot.Capacity.Effective,
		"available", snapshot.Capacity.Available,
		"duration_ms", duration.Milliseconds(),
	}

	if snapshot.Unresolved > 0 || snapshot.Capacity.Effective < 1 {
		logger.Warn("Discord storage initialized in degraded mode", args...)
		return
	}

	logger.Info("Discord storage ready", args...)
}
