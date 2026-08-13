const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildHtml, renderRows } = require("../lib/html");
const { parseDiff } = require("../lib/diff");

const SAMPLE = fs.readFileSync(path.join(__dirname, "..", "sample.diff"), "utf8");
const page = (over = {}) =>
  buildHtml({ text: SAMPLE, cspSource: "vscode-resource://x", fileName: "sample.diff", version: "0.0.1", ...over });

describe("buildHtml", () => {
  it("paints added lines green and removed lines red", () => {
    const html = renderRows(parseDiff("@@ -1,2 +1,2 @@\n-gone\n+new\n ctx"));
    assert.ok(html.includes('class="bdv-line bdv-del">-gone'));
    assert.ok(html.includes('class="bdv-line bdv-add">+new'));
    assert.ok(html.includes('class="bdv-line bdv-ctx"> ctx'));
  });

  it("gives an empty line a box to fill, so the colour band is unbroken", () => {
    const html = renderRows([{ kind: "add", text: "" }]);
    assert.ok(html.includes("&nbsp;"));
  });

  it("shows the totals in the header", () => {
    const html = page();
    assert.ok(/class="bdv-plus">\+\d+</.test(html));
    assert.ok(/class="bdv-minus">-\d+</.test(html));
    assert.ok(html.includes("sample.diff"));
  });

  it("escapes patch content instead of running it", () => {
    const html = buildHtml({ text: '@@ -1 +1 @@\n+<img onerror="boom">' });
    assert.ok(!html.includes("<img onerror"));
    assert.ok(html.includes("&lt;img onerror="));
  });

  it("escapes the file name too", () => {
    const html = page({ fileName: "<b>x</b>.diff" });
    assert.ok(!html.includes("<b>x</b>.diff"));
    assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;.diff"));
  });

  it("says so when the file is empty rather than rendering a blank page", () => {
    assert.ok(page({ text: "" }).includes("bdv-empty"));
  });

  it("locks the page down in the CSP", () => {
    const html = page();
    assert.ok(html.includes("default-src 'none'"));
    // Read-only view: nothing here needs to execute.
    assert.ok(html.includes("script-src 'none'"));
    assert.ok(html.includes("style-src vscode-resource://x 'unsafe-inline'"));
  });

  it("ships every class the stylesheet defines a rule for", () => {
    const { DIFF_CSS, KIND_CLASS } = require("../lib/css");
    for (const cls of Object.values(KIND_CLASS)) {
      assert.ok(DIFF_CSS.includes("." + cls), `no CSS rule for .${cls}`);
    }
  });
});

// The page is built from template literals, so an undefined identifier inside an
// inline <script> would survive `node -c` and only blow up in the webview. This
// view deliberately carries no script, and this test is what keeps it that way:
// add one and it gets syntax-checked here instead of in the GUI.
describe("inline scripts", () => {
  const scripts = [...page().matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);

  it("has none, matching script-src 'none'", () => {
    assert.strictEqual(scripts.length, 0);
  });

  it("parses whatever inline script the page does emit", () => {
    for (const [i, src] of scripts.entries()) {
      assert.doesNotThrow(() => new Function(src), `inline <script> #${i + 1} does not parse`);
    }
  });
});
