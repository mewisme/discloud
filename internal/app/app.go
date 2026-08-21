package app

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

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

	ctx, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()

	pool, err := postgres.Open(ctx, cfg.Database)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := migrate.Up(
		ctx,
		pool,
		migrations.FS,
		logger.With("component", "migrations"),
	); err != nil {
		return err
	}

	tokens := make([]string, len(cfg.Discord.Bots))
	for i, bot := range cfg.Discord.Bots {
		tokens[i] = bot.Token
	}

	blobStore, err := discordstore.New(
		ctx,
		cfg.Discord.ChannelID,
		tokens,
		nil,
	)
	if err != nil {
		return fmt.Errorf("create Discord blob store: %w", err)
	}

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

	handler := httpapi.NewRouter(
		httpapi.RouterDependencies{
			Ready:        readinessCheck(pool, blobStore),
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

	server := httpapi.NewServer(cfg.HTTP, handler)
	logger.Info("HTTP server started", "address", server.Addr)

	if err := runServer(
		ctx,
		server,
		cfg.HTTP.ShutdownTimeout,
	); err != nil {
		return err
	}

	logger.Info("application stopped")
	return nil
}
