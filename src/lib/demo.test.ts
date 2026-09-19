import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_STORAGE_KEY,
  clearDemo,
  demoFromCookies,
  demoSettingKey,
  readDemo,
  readDemoSetting,
  writeDemo,
  writeDemoSetting,
  type DemoRecord,
  type KeyValueStore,
} from "./demo";

/* ALL-FIXTURES-INVENTED */

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  };
}

const record = (): DemoRecord => ({
  accounts: [],
  transactions: [],
  holdings: [],
  budgets: [],
  categories: ["Groceries"],
  recurring: [],
  merchantRules: { "example market": "Groceries" },
  snapshots: [],
});

describe("recognising the demo cookie", () => {
  test("on its own and among others", () => {
    assert.equal(demoFromCookies("aurum_demo=1"), true);
    assert.equal(demoFromCookies("theme=dark; aurum_demo=1; other=x"), true);
  });

  test("not when cleared, absent, or only a lookalike", () => {
    assert.equal(demoFromCookies("aurum_demo="), false);
    assert.equal(demoFromCookies("aurum_demo=0"), false);
    assert.equal(demoFromCookies("not_aurum_demo=1"), false);
    assert.equal(demoFromCookies(""), false);
    assert.equal(demoFromCookies(undefined), false);
  });
});

describe("keeping the demo in the browser", () => {
  test("what was saved comes back", () => {
    const store = memory();
    assert.equal(writeDemo(store, record()), true);
    assert.deepEqual(readDemo(store), record());
  });

  test("nothing saved means start fresh", () => {
    assert.equal(readDemo(memory()), null);
    assert.equal(readDemo(null), null);
  });

  test("a demo saved by another version starts fresh rather than half-loading", () => {
    const store = memory();
    store.setItem(DEMO_STORAGE_KEY, JSON.stringify({ version: 2, record: record() }));
    assert.equal(readDemo(store), null);
  });

  test("anything unreadable starts fresh rather than breaking the app", () => {
    const store = memory();
    store.setItem(DEMO_STORAGE_KEY, "{not json");
    assert.equal(readDemo(store), null);
    store.setItem(DEMO_STORAGE_KEY, JSON.stringify({ version: 1, record: { accounts: "no" } }));
    assert.equal(readDemo(store), null);
  });

  test("a full or blocked storage loses the save, not the page", () => {
    const full: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    assert.equal(writeDemo(full, record()), false);
    assert.doesNotThrow(() => writeDemoSetting(full, "expense-settings", { groups: {} }));
  });
});

describe("settings kept beside the record", () => {
  test("a partial save merges over what was there, as the server's does", () => {
    const store = memory();
    writeDemoSetting(store, "contribution-limits", { limits: { a: 1 }, deferrals: { b: 2 } });
    writeDemoSetting(store, "contribution-limits", { limits: { a: 3 } });
    assert.deepEqual(readDemoSetting(store, "contribution-limits"), {
      limits: { a: 3 },
      deferrals: { b: 2 },
    });
  });

  test("each setting has its own key, so one never overwrites the record", () => {
    const store = memory();
    writeDemo(store, record());
    writeDemoSetting(store, "expense-settings", { groups: { Groceries: "necessity" } });
    assert.deepEqual(readDemo(store), record());
    assert.notEqual(demoSettingKey("expense-settings"), DEMO_STORAGE_KEY);
  });

  test("resetting forgets the record and every setting", () => {
    const store = memory();
    writeDemo(store, record());
    writeDemoSetting(store, "expense-settings", { groups: {} });
    writeDemoSetting(store, "contribution-limits", { limits: {} });
    clearDemo(store);
    assert.equal(store.data.size, 0);
  });
});
