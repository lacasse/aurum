-- A counter that ends a user's sessions when it moves.
--
-- Sessions are signed with the installation's secret, so the cookie alone
-- cannot know that its user's password has since changed. The counter goes
-- into the cookie when it is issued, and the routes compare it with this
-- column: raising it — on a password change, or when a user is removed — makes
-- every cookie that user holds stop working, and nobody else's.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "session_epoch" integer DEFAULT 0 NOT NULL;
