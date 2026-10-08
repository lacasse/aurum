import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, parseLatestRelease } from "./version";

describe("comparing versions", () => {
  test("orders by major, then minor, then patch", () => {
    assert.ok(compareVersions("2.5.0", "2.6.0") < 0);
    assert.ok(compareVersions("2.10.0", "2.9.9") > 0);
    assert.ok(compareVersions("3.0.0", "2.99.99") > 0);
    assert.equal(compareVersions("v2.6.0", "2.6.0"), 0);
  });

  test("a pre-release comes before its release", () => {
    assert.ok(compareVersions("2.6.0-test.1", "2.6.0") < 0);
    assert.ok(compareVersions("2.6.0", "2.6.0-test.1") > 0);
  });

  test("something that is not a version never reads as behind", () => {
    assert.equal(compareVersions("unknown", "2.6.0"), 0);
    assert.equal(compareVersions("2.6.0", "latest"), 0);
  });
});

describe("reading the latest release", () => {
  const release = {
    tag_name: "v1.2.3",
    html_url: "https://github.com/example/app/releases/tag/v1.2.3",
    draft: false,
    prerelease: false,
  };

  test("takes the tag without its v, and the page", () => {
    assert.deepEqual(parseLatestRelease(release), {
      version: "1.2.3",
      url: "https://github.com/example/app/releases/tag/v1.2.3",
    });
  });

  test("ignores drafts, pre-releases and tags that are not versions", () => {
    assert.equal(parseLatestRelease({ ...release, draft: true }), null);
    assert.equal(parseLatestRelease({ ...release, prerelease: true }), null);
    assert.equal(parseLatestRelease({ ...release, tag_name: "nightly" }), null);
    assert.equal(parseLatestRelease({ message: "Not Found" }), null);
    assert.equal(parseLatestRelease(null), null);
  });
});
