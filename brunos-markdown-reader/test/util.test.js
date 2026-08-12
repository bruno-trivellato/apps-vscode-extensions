const assert = require("assert");
const path = require("path");
const { resolveTarget, relTime, parseGitLog, diffOps, merge3 } = require("../lib/util");

const BASE = "/repo/docs";

describe("resolveTarget", () => {
  it("resolves a sibling relative path", () => {
    const t = resolveTarget(BASE, "knowledge-base-index.md");
    assert.strictEqual(t.filePath, path.resolve(BASE, "knowledge-base-index.md"));
    assert.strictEqual(t.fragment, "");
    assert.strictEqual(t.filePart, "knowledge-base-index.md");
  });

  it("resolves a parent-relative path", () => {
    const t = resolveTarget(BASE, "../foo/CLAUDE.md");
    assert.strictEqual(t.filePath, path.resolve("/repo", "foo/CLAUDE.md"));
    assert.strictEqual(t.filePart, "../foo/CLAUDE.md");
  });

  it("resolves ./ prefixed paths", () => {
    const t = resolveTarget(BASE, "./sub/a.md");
    assert.strictEqual(t.filePath, path.resolve(BASE, "sub/a.md"));
  });

  it("keeps an absolute path as-is", () => {
    const t = resolveTarget(BASE, "/other/place/b.md");
    assert.strictEqual(t.filePath, path.resolve("/other/place/b.md"));
  });

  it("splits off a #fragment", () => {
    const t = resolveTarget(BASE, "guide.md#section-2");
    assert.strictEqual(t.filePath, path.resolve(BASE, "guide.md"));
    assert.strictEqual(t.fragment, "section-2");
    assert.strictEqual(t.filePart, "guide.md");
  });

  it("splits off a ?query without producing a fragment", () => {
    const t = resolveTarget(BASE, "guide.md?raw=1");
    assert.strictEqual(t.filePath, path.resolve(BASE, "guide.md"));
    assert.strictEqual(t.fragment, "");
    assert.strictEqual(t.filePart, "guide.md");
  });

  it("splits on whichever of #/? comes first", () => {
    const t = resolveTarget(BASE, "guide.md#a?b");
    assert.strictEqual(t.fragment, "a?b");
    assert.strictEqual(t.filePart, "guide.md");
  });

  it("decodes percent-encoding", () => {
    const t = resolveTarget(BASE, "my%20file.md");
    assert.strictEqual(t.filePart, "my file.md");
    assert.strictEqual(t.filePath, path.resolve(BASE, "my file.md"));
  });

  it("leaves invalid percent-encoding untouched", () => {
    const t = resolveTarget(BASE, "100%off.md");
    assert.strictEqual(t.filePart, "100%off.md");
    assert.strictEqual(t.filePath, path.resolve(BASE, "100%off.md"));
  });

  it("returns null for a pure #anchor", () => {
    assert.strictEqual(resolveTarget(BASE, "#somewhere"), null);
  });

  it("returns null for a pure ?query", () => {
    assert.strictEqual(resolveTarget(BASE, "?x=1"), null);
  });

  it("returns null for an empty href", () => {
    assert.strictEqual(resolveTarget(BASE, ""), null);
  });

  it("returns null for a non-string href", () => {
    assert.strictEqual(resolveTarget(BASE, undefined), null);
    assert.strictEqual(resolveTarget(BASE, null), null);
    assert.strictEqual(resolveTarget(BASE, 42), null);
  });

  it("treats a trailing '#' as no fragment", () => {
    const t = resolveTarget(BASE, "guide.md#");
    assert.strictEqual(t.fragment, "");
    assert.strictEqual(t.filePath, path.resolve(BASE, "guide.md"));
  });
});

describe("relTime", () => {
  const NOW = Date.parse("2026-07-27T12:00:00Z");
  const ago = (secs) => new Date(NOW - secs * 1000).toISOString();

  it("says 'just now' under a minute", () => {
    assert.strictEqual(relTime(ago(0), NOW), "just now");
    assert.strictEqual(relTime(ago(59), NOW), "just now");
  });

  it("formats minutes", () => {
    assert.strictEqual(relTime(ago(60), NOW), "1 minute ago");
    assert.strictEqual(relTime(ago(120), NOW), "2 minutes ago");
    assert.strictEqual(relTime(ago(59 * 60), NOW), "59 minutes ago");
  });

  it("formats hours", () => {
    assert.strictEqual(relTime(ago(3600), NOW), "1 hour ago");
    assert.strictEqual(relTime(ago(5 * 3600), NOW), "5 hours ago");
  });

  it("formats days, singular vs plural", () => {
    assert.strictEqual(relTime(ago(86400), NOW), "1 day ago");
    assert.strictEqual(relTime(ago(2 * 86400), NOW), "2 days ago");
    assert.strictEqual(relTime(ago(3 * 86400), NOW), "3 days ago");
  });

  it("formats weeks", () => {
    assert.strictEqual(relTime(ago(604800), NOW), "1 week ago");
    assert.strictEqual(relTime(ago(2 * 604800), NOW), "2 weeks ago");
  });

  it("formats months", () => {
    assert.strictEqual(relTime(ago(2592000), NOW), "1 month ago");
    assert.strictEqual(relTime(ago(3 * 2592000), NOW), "3 months ago");
  });

  it("formats years", () => {
    assert.strictEqual(relTime(ago(31536000), NOW), "1 year ago");
    assert.strictEqual(relTime(ago(2 * 31536000), NOW), "2 years ago");
  });

  it("clamps future dates to 'just now'", () => {
    assert.strictEqual(relTime(ago(-5000), NOW), "just now");
  });

  it("returns '' for an invalid date string", () => {
    assert.strictEqual(relTime("not-a-date", NOW), "");
    assert.strictEqual(relTime("", NOW), "");
    assert.strictEqual(relTime(undefined, NOW), "");
  });

  it("defaults `now` to Date.now()", () => {
    const iso = new Date(Date.now() - 2 * 86400 * 1000).toISOString();
    assert.strictEqual(relTime(iso), "2 days ago");
  });

  it("accepts the git --format=%aI offset form", () => {
    assert.strictEqual(relTime("2026-07-26T14:00:00+02:00", NOW), "1 day ago");
  });
});

describe("parseGitLog", () => {
  const rec = (h, a, e, d, s) => [h, a, e, d, s].join("\x1f") + "\x1e";

  it("parses multiple commits", () => {
    const out =
      rec("a".repeat(40), "Bruno", "b@x.com", "2026-07-26T10:00:00+02:00", "feat: one") +
      rec("b".repeat(40), "Gabi", "g@x.com", "2026-07-20T10:00:00+02:00", "fix: two");
    const commits = parseGitLog(out);
    assert.strictEqual(commits.length, 2);
    assert.deepStrictEqual(commits[0], {
      hash: "a".repeat(40),
      shortHash: "aaaaaaa",
      author: "Bruno",
      email: "b@x.com",
      date: "2026-07-26T10:00:00+02:00",
      subject: "feat: one",
    });
    assert.strictEqual(commits[1].author, "Gabi");
  });

  it("parses a single commit", () => {
    const commits = parseGitLog(
      rec("0123456789abcdef", "A", "a@b.c", "2026-01-01T00:00:00Z", "init")
    );
    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].shortHash, "0123456");
  });

  it("takes shortHash as the first 7 chars", () => {
    const commits = parseGitLog(rec("deadbeefcafe1234", "A", "a@b.c", "d", "s"));
    assert.strictEqual(commits[0].shortHash, "deadbee");
    assert.strictEqual(commits[0].shortHash.length, 7);
  });

  it("returns [] for empty input", () => {
    assert.deepStrictEqual(parseGitLog(""), []);
    assert.deepStrictEqual(parseGitLog("\x1e"), []);
    assert.deepStrictEqual(parseGitLog("\n\n"), []);
  });

  it("returns [] for non-string input", () => {
    assert.deepStrictEqual(parseGitLog(null), []);
    assert.deepStrictEqual(parseGitLog(undefined), []);
  });

  it("ignores the trailing record separator and surrounding newlines", () => {
    const out = rec("f".repeat(40), "A", "a@b.c", "2026-01-01T00:00:00Z", "only") + "\n";
    assert.strictEqual(parseGitLog(out).length, 1);
  });

  it("keeps subjects with spaces and punctuation intact", () => {
    const subject = "chore(markdown-reader): make extension 100% English + keychain support!";
    const commits = parseGitLog(rec("1".repeat(40), "A", "a@b.c", "2026-01-01T00:00:00Z", subject));
    assert.strictEqual(commits[0].subject, subject);
  });

  it("keeps subjects containing newlines (records survive the split)", () => {
    const commits = parseGitLog(
      rec("2".repeat(40), "A", "a@b.c", "2026-01-01T00:00:00Z", "line one\nline two")
    );
    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].subject, "line one\nline two");
  });
});

describe("diffOps", () => {
  const L = (s) => s.split("\n");

  it("returns nothing for identical input", () => {
    assert.deepStrictEqual(diffOps(L("a\nb\nc"), L("a\nb\nc")), []);
  });

  it("isolates a single changed line", () => {
    assert.deepStrictEqual(diffOps(L("a\nb\nc"), L("a\nB\nc")), [
      { start: 1, end: 2, lines: ["B"] },
    ]);
  });

  it("reports two separate edits as two ops", () => {
    const ops = diffOps(L("a\nb\nc\nd\ne"), L("A\nb\nc\nd\nE"));
    assert.strictEqual(ops.length, 2);
    assert.strictEqual(ops[0].start, 0);
    assert.strictEqual(ops[1].end, 5);
  });

  it("handles a pure insertion as a zero-width op", () => {
    assert.deepStrictEqual(diffOps(L("a\nc"), L("a\nb\nc")), [
      { start: 1, end: 1, lines: ["b"] },
    ]);
  });

  it("handles a pure deletion", () => {
    assert.deepStrictEqual(diffOps(L("a\nb\nc"), L("a\nc")), [
      { start: 1, end: 2, lines: [] },
    ]);
  });

  it("round-trips through the ops it reports", () => {
    const a = L("one\ntwo\nthree\nfour\nfive");
    const b = L("one\n2\nthree\nfour\n5\nsix");
    const out = [];
    let at = 0;
    for (const op of diffOps(a, b)) {
      out.push(...a.slice(at, op.start), ...op.lines);
      at = op.end;
    }
    out.push(...a.slice(at));
    assert.deepStrictEqual(out, b);
  });
});

describe("merge3", () => {
  // Lute drops the trailing double-space hard break and re-pads the table.
  const ORIGIN = [
    "# Title",
    "",
    "**Feature:** Multi Category  ",
    "**Scope:** framing only  ",
    "",
    "| # | Invariant |",
    "|---|---|",
    "| 1 | must be 100% |",
  ].join("\n");
  const BASELINE = [
    "# Title",
    "",
    "**Feature:** Multi Category",
    "**Scope:** framing only",
    "",
    "",
    "| # | Invariant   |",
    "| - | ----------- |",
    "| 1 | must be 100% |",
  ].join("\n");

  it("writes the file back untouched when nothing was edited", () => {
    assert.strictEqual(merge3(BASELINE, ORIGIN, BASELINE), ORIGIN);
  });

  it("keeps hard breaks and table padding when an unrelated line changes", () => {
    const next = BASELINE.replace("# Title", "# Renamed");
    const out = merge3(BASELINE, ORIGIN, next);
    assert.ok(out.startsWith("# Renamed"), "the edit landed");
    assert.ok(out.includes("**Feature:** Multi Category  \n"), "hard break survived");
    assert.ok(out.includes("|---|---|"), "table padding survived");
  });

  it("lets the user's edit win where both sides touched the same line", () => {
    const next = BASELINE.replace("| 1 | must be 100% |", "| 1 | must be 50% |");
    const out = merge3(BASELINE, ORIGIN, next);
    assert.ok(out.includes("must be 50%"), "the edit landed");
    assert.ok(out.includes("**Feature:** Multi Category  \n"), "untouched hard break survived");
  });

  it("applies an inserted line without disturbing the rest", () => {
    const next = BASELINE.replace("# Title", "# Title\n\nnew paragraph");
    const out = merge3(BASELINE, ORIGIN, next);
    assert.ok(out.includes("new paragraph"));
    assert.ok(out.includes("**Scope:** framing only  "), "hard break survived");
  });
});
