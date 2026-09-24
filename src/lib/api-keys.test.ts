import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveKey,
  hint,
  invalidReason,
  noKeysAtAll,
  stateOf,
  type KeyStates,
} from "./api-keys";

/* ALL-FIXTURES-INVENTED */

const ACCOUNT_KEY = "abcd1234efgh5678";
const ENV_KEY = "zyxw9876vuts5432";

describe("what the browser is told about a key", () => {
  test("never the key itself, only its last four", () => {
    const state = stateOf(ACCOUNT_KEY, "");
    assert.equal(state.hint, "••••5678");
    assert.ok(!JSON.stringify(state).includes(ACCOUNT_KEY));
  });

  test("a short key gives up nothing at all", () => {
    assert.equal(hint("short"), "••••");
    assert.equal(hint(""), null);
  });

  test("where the key came from is part of the answer", () => {
    assert.equal(stateOf(ACCOUNT_KEY, ENV_KEY).source, "account");
    assert.equal(stateOf("", ENV_KEY).source, "environment");
    assert.deepEqual(stateOf("", ""), { set: false, source: null, hint: null });
    assert.deepEqual(stateOf(undefined, undefined), { set: false, source: null, hint: null });
  });

  test("whitespace is not a key", () => {
    assert.equal(stateOf("   ", "").set, false);
  });
});

describe("which key is used", () => {
  test("a key saved in settings takes over from the deployment's own", () => {
    assert.equal(effectiveKey(ACCOUNT_KEY, ENV_KEY), ACCOUNT_KEY);
  });

  test("an installation that only ever had an environment key keeps working", () => {
    assert.equal(effectiveKey("", ENV_KEY), ENV_KEY);
    assert.equal(effectiveKey(undefined, ENV_KEY), ENV_KEY);
  });

  test("clearing the saved key falls back rather than turning prices off", () => {
    assert.equal(effectiveKey("  ", ENV_KEY), ENV_KEY);
  });

  test("nothing anywhere is nothing", () => {
    assert.equal(effectiveKey("", ""), "");
  });
});

describe("refusing what cannot be a key", () => {
  test("an empty value clears the key rather than failing", () => {
    assert.equal(invalidReason(""), null);
    assert.equal(invalidReason("   "), null);
  });

  test("a plausible key passes, whatever shape the provider uses", () => {
    assert.equal(invalidReason(ACCOUNT_KEY), null);
    assert.equal(invalidReason("demo.key-with_punctuation.1234"), null);
  });

  test("what cannot be a key is named", () => {
    assert.match(invalidReason("abc") ?? "", /too short/);
    assert.match(invalidReason("abcd1234 efgh5678") ?? "", /no spaces/);
    assert.match(invalidReason("https://example.com/api/token") ?? "", /web address/);
    assert.match(invalidReason("x".repeat(201)) ?? "", /longer than/);
  });
});

describe("having no keys at all", () => {
  const none: KeyStates = {
    twelvedata: { set: false, source: null, hint: null },
    eodhd: { set: false, source: null, hint: null },
  };

  test("is what the investments page has to say out loud", () => {
    assert.equal(noKeysAtAll(none), true);
  });

  test("one key is enough not to say it", () => {
    assert.equal(
      noKeysAtAll({ ...none, eodhd: { set: true, source: "account", hint: "••••5678" } }),
      false,
    );
  });
});
