-- Who the installation belongs to.
--
-- Until now there was one user and they lived in `.env`, which made an account
-- something only whoever ran the deployment could change, and left every row in
-- this database belonging to the installation rather than to a person. These
-- two tables are the first half of fixing that; the rows gain an owner in the
-- migration after this one.
--
-- Nothing here changes an existing row, and nothing is required at this point:
-- an installation that applies this migration and stops still runs exactly as
-- it did. The first user is created by the app on the next start, from the
-- credentials already in `.env`.
CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY NOT NULL,
  "username" text NOT NULL,
  "password_hash" text NOT NULL,
  "role" text DEFAULT 'member' NOT NULL,
  "created_at" text NOT NULL
);
--> statement-breakpoint
-- Usernames are stored lowercase and compared as stored, so one person cannot
-- end up with two accounts that differ only in capitals.
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_unique" ON "users" ("username");
--> statement-breakpoint
-- Invitations, single use.
--
-- The token is stored hashed for the same reason a password is: this table can
-- be read — from a backup, from the database console — and reading it must not
-- hand anybody an account.
CREATE TABLE IF NOT EXISTS "invites" (
  "id" text PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" text NOT NULL,
  "expires_at" text NOT NULL,
  "accepted_at" text,
  "accepted_by" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invites_token_hash_unique" ON "invites" ("token_hash");
