-- Remove the copies migrations 0027 and 0028 left behind.
--
-- When personal settings moved to user_settings and each allowance became
-- per user, the old app_meta rows were kept rather than deleted in the same
-- breath as they were copied. Nothing has read them since, and a second copy
-- of a setting is a second answer to one question waiting to disagree.
--
-- A setting is removed only where user_settings holds the same value, so an
-- installation where the copy never happened keeps its only record. The old
-- installation-wide allowance counters are removed outright: they only count
-- calls, the per-user ledgers replaced them, and nothing writes them any more.
DELETE FROM "app_meta" m
 WHERE m."key" IN ('allocation_targets', 'contribution_limits', 'contribution_deferrals',
                   'expense_settings', 'demo_data_deleted', 'api_keys')
   AND EXISTS (SELECT 1 FROM "user_settings" u WHERE u."key" = m."key" AND u."value" = m."value");
--> statement-breakpoint
DELETE FROM "app_meta" WHERE "key" IN ('eodhd_quota', 'twelvedata_quota');
