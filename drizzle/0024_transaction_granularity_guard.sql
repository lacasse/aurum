-- A month's records are kept one way or the other: as a set of month-end
-- totals, or as the individual transactions themselves. Holding both means the
-- same money is counted twice, and it is invisible on the page — the figures
-- look plausible, only larger.
--
-- This happened when a spreadsheet-summarised period was re-imported from bank
-- and card exports. Nothing warned, because nothing knew the two kinds of row
-- were answering the same question.
--
-- The rule lives here rather than in the import code because the import screen
-- is not the only writer. Scripts, one-off maintenance and anything driving the
-- database directly all bypass application checks; a constraint does not care
-- which client opened the connection.

ALTER TABLE transactions
  ADD COLUMN granularity text NOT NULL DEFAULT 'individual';

ALTER TABLE transactions
  ADD CONSTRAINT transactions_granularity_values
  CHECK (granularity IN ('individual', 'monthly'));

-- Rows imported from the monthly spreadsheet: one per category per month, and
-- the account cash flows alongside them. Both carry a month's total, not an
-- event. Everything else is left individual, which is the safe default: a row
-- wrongly called monthly would suppress a real warning, while a row wrongly
-- called individual only risks one that can be read and dismissed.
UPDATE transactions
   SET granularity = 'monthly'
 WHERE id LIKE 'sheet-%' OR id LIKE 'cashflow-%';

-- Plain columns, no expression: date_trunc over a date is only stable, not
-- immutable, so it cannot be indexed. The trigger asks for a date range
-- instead, which this serves directly.
CREATE INDEX transactions_month_kind_idx
  ON transactions (type, granularity, date);

CREATE FUNCTION transactions_one_granularity_per_month() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  opposite    text;
  month_start date;
  clashes     integer;
BEGIN
  opposite := CASE NEW.granularity WHEN 'monthly' THEN 'individual' ELSE 'monthly' END;
  month_start := date_trunc('month', NEW.date)::date;

  SELECT count(*) INTO clashes
    FROM transactions
   WHERE type = NEW.type
     AND granularity = opposite
     AND date >= month_start
     AND date < month_start + interval '1 month'
     AND id <> NEW.id;

  IF clashes > 0 THEN
    RAISE EXCEPTION
      '% for %-% is already recorded as % in % row(s); adding % rows would count the same money twice',
      NEW.type,
      extract(year from NEW.date), lpad(extract(month from NEW.date)::text, 2, '0'),
      opposite, clashes, NEW.granularity
      USING ERRCODE = 'integrity_constraint_violation',
            HINT = 'Remove the existing rows for that month first, or import a period that is not already covered.';
  END IF;

  RETURN NEW;
END;
$$;

-- Deferred to commit: a single import may legitimately write many rows, and
-- the check must judge the finished state rather than the order they arrived
-- in. A restore of a backup taken before this migration will report the
-- conflict instead of silently reinstating it.
CREATE CONSTRAINT TRIGGER transactions_one_granularity_per_month
  AFTER INSERT OR UPDATE ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION transactions_one_granularity_per_month();
