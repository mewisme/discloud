package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mewisme/discloud/internal/config"
)

func Open(ctx context.Context, cfg config.DatabaseConfig) (*pgxpool.Pool, error) {
	poolCfg, err := poolConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("parse database config: %w", err)
	}

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("create database pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return pool, nil
}

func poolConfig(cfg config.DatabaseConfig) (*pgxpool.Config, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DSN)
	if err != nil {
		return nil, err
	}

	poolCfg.MinConns = cfg.MinConnections
	poolCfg.MaxConns = cfg.MaxConnections
	poolCfg.MaxConnLifetime = cfg.MaxConnectionLife
	poolCfg.MaxConnIdleTime = cfg.MaxConnectionIdle
	poolCfg.HealthCheckPeriod = cfg.HealthCheckPeriod

	return poolCfg, nil
}
