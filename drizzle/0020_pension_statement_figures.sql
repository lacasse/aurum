-- What the plan's own statement says, beside what it is worth to leave.
--
-- The transfer value answers "what if I left"; these answer "what if I
-- stay" — the pension earned so far, as an annual figure, and the service
-- it was earned by. Neither can be derived from anything the app holds, so
-- both are entered by hand from the annual statement and both are optional:
-- an account with nothing entered simply does not show them.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "pension_annual" numeric(18, 2);
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "pension_service" numeric(8, 2);
