-- +goose Up

ALTER TABLE login_challenges
ADD COLUMN failed_attempts integer NOT NULL DEFAULT 0
CHECK (failed_attempts >= 0);