-- +goose Up

SELECT pg_advisory_xact_lock(hashtextextended('discloud:extensions', 0));

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;