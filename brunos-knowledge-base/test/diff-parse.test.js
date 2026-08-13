const assert = require("assert");
const { parseDiff, parseHunkHeader, escapeHtml, countChanges } = require("../lib/diff-parse");

const kinds = (text) => parseDiff(text).map((r) => r.kind);

describe("parseHunkHeader", () => {
  it("reads both counts", () => {
    assert.deepStrictEqual(parseHunkHeader("@@ -1,8 +1,10 @@"), { oldLines: 8, newLines: 10 });
  });

  it("treats a missing count as one line", () => {
    assert.deepStrictEqual(parseHunkHeader("@@ -3 +3 @@"), { oldLines: 1, newLines: 1 });
  });

  it("keeps trailing context out of the counts", () => {
    assert.deepStrictEqual(parseHunkHeader("@@ -12,7 +12,9 @@ function build() {"), {
      oldLines: 7,
      newLines: 9,
    });
  });

  it("sums the old sides of a combined diff", () => {
    assert.deepStrictEqual(parseHunkHeader("@@@ -1,5 -1,6 +1,7 @@@"), {
      oldLines: 11,
      newLines: 7,
    });
  });

  it("rejects a line that only looks like a hunk header", () => {
    assert.strictEqual(parseHunkHeader("@@ not a hunk @@"), null);
    assert.strictEqual(parseHunkHeader("-  const x = 1;"), null);
  });
});

describe("parseDiff", () => {
  it("colours adds, removes and context", () => {
    const patch = ["@@ -1,2 +1,2 @@", " keep me", "-drop me", "+add me"].join("\n");
    assert.deepStrictEqual(kinds(patch), ["hunk", "ctx", "del", "add"]);
  });

  it("treats the ---/+++ pair as headers, not as a remove and an add", () => {
    const patch = [
      "diff --git a/x.js b/x.js",
      "index 111..222 100644",
      "--- a/x.js",
      "+++ b/x.js",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");
    assert.deepStrictEqual(kinds(patch), [
      "meta",
      "meta",
      "file",
      "file",
      "hunk",
      "del",
      "add",
    ]);
  });

  it("keeps ---/+++ content inside a hunk coloured as content", () => {
    // The whole reason parseDiff tracks the hunk counts: on text alone these
    // two lines are indistinguishable from a file header pair.
    const patch = ["@@ -1,1 +1,1 @@", "--- a dash line I removed", "+++ a plus line I added"].join(
      "\n"
    );
    assert.deepStrictEqual(kinds(patch), ["hunk", "del", "add"]);
  });

  it("ends the hunk once both counts run out", () => {
    const patch = [
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "--- a/next.js", // back outside a hunk → header again
      "+++ b/next.js",
    ].join("\n");
    assert.deepStrictEqual(kinds(patch), ["hunk", "del", "add", "file", "file"]);
  });

  it("does not let the no-newline marker eat a content line", () => {
    const patch = ["@@ -1,1 +1,1 @@", "-old", "\\ No newline at end of file", "+new"].join("\n");
    assert.deepStrictEqual(kinds(patch), ["hunk", "del", "meta", "add"]);
  });

  it("reads an empty line inside a hunk as context", () => {
    const patch = ["@@ -1,3 +1,3 @@", " a", "", " c"].join("\n");
    assert.deepStrictEqual(kinds(patch), ["hunk", "ctx", "ctx", "ctx"]);
  });

  it("handles several files in one patch", () => {
    const patch = [
      "diff --git a/a.js b/a.js",
      "--- a/a.js",
      "+++ b/a.js",
      "@@ -1 +1 @@",
      "-a",
      "+A",
      "diff --git a/b.js b/b.js",
      "--- a/b.js",
      "+++ b/b.js",
      "@@ -1 +1 @@",
      "-b",
      "+B",
    ].join("\n");
    assert.deepStrictEqual(kinds(patch), [
      "meta", "file", "file", "hunk", "del", "add",
      "meta", "file", "file", "hunk", "del", "add",
    ]);
  });

  it("marks mode, rename and binary lines as meta", () => {
    const patch = [
      "diff --git a/x b/y",
      "similarity index 95%",
      "rename from x",
      "rename to y",
      "old mode 100644",
      "new mode 100755",
      "Binary files a/z.png and b/z.png differ",
    ].join("\n");
    assert.deepStrictEqual(kinds(patch), Array(7).fill("meta"));
  });

  it("does not invent a trailing line from the final newline", () => {
    assert.strictEqual(parseDiff("@@ -1 +1 @@\n+x\n").length, 2);
  });

  it("survives junk input", () => {
    assert.deepStrictEqual(parseDiff(""), []);
    assert.deepStrictEqual(parseDiff(null), []);
    assert.deepStrictEqual(parseDiff(undefined), []);
    assert.deepStrictEqual(kinds("just some prose\nwith no patch in it"), ["ctx", "ctx"]);
  });

  it("keeps the line text byte-for-byte, prefix included", () => {
    const rows = parseDiff("@@ -1 +1 @@\n-  const x = 1;");
    assert.strictEqual(rows[1].text, "-  const x = 1;");
  });
});

describe("countChanges", () => {
  it("counts only content lines", () => {
    const rows = parseDiff(
      ["--- a/x", "+++ b/x", "@@ -1,2 +1,3 @@", " ctx", "-gone", "+new", "+also new"].join("\n")
    );
    assert.deepStrictEqual(countChanges(rows), { added: 2, removed: 1 });
  });
});

describe("escapeHtml", () => {
  it("neutralises markup in patch content", () => {
    assert.strictEqual(escapeHtml('+<script>alert("x")</script>'), '+&lt;script&gt;alert("x")&lt;/script&gt;');
  });

  it("escapes ampersands first, so entities are not double-decoded", () => {
    assert.strictEqual(escapeHtml("&lt;"), "&amp;lt;");
  });
});
