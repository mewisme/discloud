-- +goose Up

ALTER TABLE users
ADD COLUMN name text NOT NULL DEFAULT '';

UPDATE users
SET name = username::text
WHERE name = '';

ALTER TABLE users
ADD CONSTRAINT users_name_length CHECK (char_length(name) <= 100);