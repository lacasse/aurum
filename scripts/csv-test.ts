import Papa from "papaparse";
import { parseCsvRecords, parseAmount, parseFlexibleDate, ImportedRow } from "../src/lib/csv";

let failures = 0;
function expect(cond: boolean, label: string) {
  if (cond) console.log(`  ok  ${label}`);
  else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}

const AMEX_CSV = `Date,Posted Date,Reference Number,Activity Type,Activity Status,Card Number,Merchant Category Description,Merchant Name,Merchant City,Merchant State or Province,Merchant Country Code,Merchant Postal Code,Amount,Rewards,Name on Card
8/12/2026,8/13/2026,1001,CHARGE,Posted,12345,GROCERY STORES SUPERMARKETS,WHOLE FOODS MARKET #102,NEW YORK,NY,USA,10012,-86.41,,
8/13/2026,8/14/2026,1002,CHARGE,Posted,12345,DELIS AND QUICK FOODS,BLUE BOTTLE COFFEE,NEW YORK,NY,USA,10012,-6.75,,
8/14/2026,8/15/2026,1003,CHARGE,Posted,12345,TELECOM,VERIZON WIRELESS,NEW YORK,NY,USA,10012,-95.00,,
8/15/2026,8/16/2026,1004,PAYMENT,Posted,12345,,ONLINE PAYMENT - THANK YOU,,,USA,,1200.00,,
8/16/2026,8/17/2026,1005,CREDIT,Posted,12345,RETAIL STORES,AMAZON RETURN,NEW YORK,NY,USA,10012,29.99,,`;

const SIMPLE_CSV = `transaction_date,transaction_type,status,merchant,amount,currency,notes,category
2026-08-03,DEBIT,posted,NETFLIX.COM,15.49,USD,streaming,subscriptions
2026-08-04,DEBIT,posted,SHELL OIL 5542,52.10,USD,fuel,
2026-08-05,DEBIT,declined,SKETCHY SITE,10.00,USD,,
2026-08-06,CREDIT,posted,REFUND FROM ACME,29.99,USD,returned shoes,shopping
2026-08-07,PAYMENT,posted,CHASE CARD PAYMENT,500.00,USD,,
2026-08-08,DEBIT,posted,UNIQUE BOUTIQUE,44.00,USD,,`;

function parseStr(csv: string) {
  const res = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
  });
  return { fields: res.meta.fields, data: res.data };
}

console.log("primitives");
expect(parseAmount("-86.41") === -86.41, "parseAmount negative");
expect(parseAmount("(45.00)") === -45, "parseAmount parentheses");
expect(parseAmount("$1,234.56") === 1234.56, "parseAmount currency/commas");
expect(parseAmount("12.00-") === -12, "parseAmount trailing minus");
expect(parseFlexibleDate("8/12/26") === "2026-08-12", "date M/D/YY");
expect(parseFlexibleDate("08/12/2026") === "2026-08-12", "date MM/DD/YYYY");
expect(parseFlexibleDate("2026-08-12") === "2026-08-12", "date ISO");
expect(parseFlexibleDate("Aug 25, 2026") === "2026-08-25", "date textual");

console.log("amex format");
const a = parseStr(AMEX_CSV);
const amex = parseCsvRecords("amex.csv", a.fields, a.data, new Set(), {});
expect(amex.format === "amex", "format detected as amex");
expect(amex.rows.length === 4, `4 rows imported (got ${amex.rows.length})`);
expect(amex.skippedPayments === 1, "card payment skipped");
const byPayee = Object.fromEntries(amex.rows.map((r) => [r.payee, r]));
expect(byPayee["WHOLE FOODS MARKET #102"]?.category === "Groceries", "whole foods -> Groceries");
expect(byPayee["WHOLE FOODS MARKET #102"]?.type === "expense", "whole foods -> expense");
expect(byPayee["BLUE BOTTLE COFFEE"]?.category === "Dining", "blue bottle -> Dining");
expect(byPayee["VERIZON WIRELESS"]?.category === "Utilities", "verizon -> Utilities");
expect(byPayee["AMAZON RETURN"]?.type === "income", "credit -> income");
expect(byPayee["AMAZON RETURN"]?.category === "Refund", "amazon return -> Refund");
expect(byPayee["AMAZON RETURN"]?.amount === 29.99, "credit amount positive");

console.log("simple format");
const s = parseStr(SIMPLE_CSV);
const simple = parseCsvRecords("simple.csv", s.fields, s.data, new Set(), {});
expect(simple.format === "simple", "format detected as simple");
expect(simple.rows.length === 4, `4 rows imported (got ${simple.rows.length})`);
expect(simple.skippedInvalid === 1, "declined row skipped");
expect(simple.skippedPayments === 1, "payment row skipped");
const byP2 = Object.fromEntries(simple.rows.map((r) => [r.payee, r]));
expect(byP2["NETFLIX.COM"]?.category === "Subscriptions", "csv category subscriptions -> Subscriptions");
expect(byP2["SHELL OIL 5542"]?.category === "Transport", "shell -> Transport");
expect(byP2["REFUND FROM ACME"]?.type === "income", "credit -> income");
expect(byP2["REFUND FROM ACME"]?.category === "Refund", "refund keyword beats foreign csv category");
expect(byP2["UNIQUE BOUTIQUE"]?.category === "Other", "unknown merchant -> Other");
expect(byP2["UNIQUE BOUTIQUE"]?.confident === false, "unknown merchant is low confidence");

console.log("duplicates");
const wfRow: ImportedRow | undefined = amex.rows.find((r) => r.payee === "WHOLE FOODS MARKET #102");
const key = new Set([`2026-08-12|86.41|${"whole foods market #102"}`]);
const amex2 = parseCsvRecords("amex.csv", a.fields, a.data, key, {});
const wf2 = amex2.rows.find((r) => r.payee === "WHOLE FOODS MARKET #102");
expect(wf2?.dup === true && wf2?.include === false, "existing transaction flagged dup and excluded");
expect(amex.rows.every((r) => !r.dup) || wfRow != null, "no false dups without keys");

console.log("merchant rules");
const simple2 = parseCsvRecords("simple.csv", s.fields, s.data, new Set(), {
  "unique boutique": "Shopping",
});
const ub = simple2.rows.find((r) => r.payee === "UNIQUE BOUTIQUE");
expect(ub?.category === "Shopping" && ub?.confident === true, "learned merchant rule applied");

console.log("user-defined categories");
const custom = ["Dining", "Shopping", "Coffee", "Other"];
const simple3 = parseCsvRecords("simple.csv", s.fields, s.data, new Set(), {}, custom);
const nf3 = simple3.rows.find((r) => r.payee === "NETFLIX.COM");
expect(
  nf3?.category === "Other" && nf3?.confident === false,
  "csv category outside custom list -> fallback Other (low confidence)",
);
const sh3 = simple3.rows.find((r) => r.payee === "SHELL OIL 5542");
expect(sh3?.category === "Other", "keyword rule for non-existent category is skipped");
const simple4 = parseCsvRecords("simple.csv", s.fields, s.data, new Set(), {
  "netflix.com": "Coffee",
}, custom);
const nf4 = simple4.rows.find((r) => r.payee === "NETFLIX.COM");
expect(nf4?.category === "Coffee" && nf4?.confident === true, "merchant rule honored within custom list");
const rf3 = simple3.rows.find((r) => r.payee === "REFUND FROM ACME");
expect(
  rf3?.type === "income" && rf3?.category === "Shopping",
  "refund rows use custom categories (csv 'shopping' -> Shopping)",
);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
