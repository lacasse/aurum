-- Key/value facts about the deployment itself, separate from the user's
-- finances. The first key is `demo_data_deleted`, written when the user
-- deletes the seeded sample rows: without it, emptying the database would
-- look identical to a first run and the demo data would be seeded again.
CREATE TABLE IF NOT EXISTS "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
