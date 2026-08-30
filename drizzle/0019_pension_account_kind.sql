-- A defined benefit pension is not an account that holds money.
--
-- It was recorded as an investment account, so every balance-sheet figure
-- added its transfer value to cash: on this record that made $3,628 of
-- spendable money read as $41,118, nine tenths of it a pension that cannot
-- be drawn on until the plan is left. The new kind is what lets it be valued
-- in net worth and still be kept out of "assets".
--
-- The value stays exactly as recorded — it is already the transfer value,
-- entered by hand each month end — so only the kind changes.
UPDATE "accounts" SET "kind" = 'pension'
WHERE "kind" = 'investment' AND "registration" = 'Pension';
