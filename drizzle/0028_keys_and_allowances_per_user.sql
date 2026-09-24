-- Market-data keys, and the allowances counted against them, belong to a user.
--
-- A key is tied to somebody's account with the provider, and the provider
-- counts its daily allowance against that key. So both follow the person: each
-- user's keys live in their own settings, and each user's spending is kept in
-- a ledger of its own, `<ledger>:<user id>`.
--
-- What already exists goes to the first account, which is whose it was. Keys
-- saved on the settings page before this move to that account's settings. The
-- ledgers carry today's spending with them, so an upgrade in the middle of the
-- day does not forget calls already made and overrun the provider's limit.
-- The old rows are left in place, unused, rather than deleted as they are
-- copied.
CREATE OR REPLACE FUNCTION pg_temp.first_owner() RETURNS text LANGUAGE sql AS $$
  SELECT "id" FROM "users" ORDER BY ("role" = 'admin') DESC, "created_at" ASC, "id" ASC LIMIT 1
$$;
--> statement-breakpoint
INSERT INTO "user_settings" ("user_id", "key", "value")
SELECT pg_temp.first_owner(), 'api_keys', "value"
  FROM "app_meta"
 WHERE "key" = 'api_keys' AND pg_temp.first_owner() IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "app_meta" ("key", "value")
SELECT "key" || ':' || pg_temp.first_owner(), "value"
  FROM "app_meta"
 WHERE "key" IN ('eodhd_quota', 'twelvedata_quota') AND pg_temp.first_owner() IS NOT NULL
ON CONFLICT DO NOTHING;
