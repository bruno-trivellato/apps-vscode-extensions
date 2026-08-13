// Both webview pages are assembled from template literals. An undefined
// identifier inside an inline <script> is invisible to `node -c`, because to
// Node the whole thing is just a string; it only explodes in the webview, at
// which point the page silently does nothing. This builds the real pages and
// parses every script in them.
//
// `vscode` is stubbed, so this runs in plain mocha with no VSCode present.

const assert = require("assert");
const Module = require("module");

// Deep-permissive stub: any property is another stub, so we never have to
// enumerate the API surface the renderer touches.
const stub = () =>
  new Proxy(function () {}, {
    get: (_t, prop) => (prop === "then" ? undefined : stub()),
    apply: () => stub(),
    construct: () => stub(),
  });

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") return stub();
  return realLoad.call(this, request, parent, isMain);
};

const { MarkdownEditorProvider } = require("../renderers/markdown");
const { THEMES } = require("../lib/css");

const webview = { cspSource: "vscode-resource://test", asWebviewUri: (u) => u };

const SOURCE = [
  "# Title",
  "",
  "```mermaid",
  "graph TD; A-->B;",
  "```",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "[a link](./other.md) and ![img](./pic.png)",
].join("\n");

const GIT = {
  repoName: "repo",
  relPath: "x.md",
  remote: "git@github.com:x/y.git",
  commits: [
    { hash: "a".repeat(40), shortHash: "aaaaaaa", author: "Bruno", email: "b@x", date: "2026-08-01T10:00:00Z", subject: "first" },
  ],
};

const baseConfig = {
  showGitHeader: true,
  historyExpanded: false,
  doubleEscToPreview: true,
  editMode: false,
  collapsibleHeadings: true,
  resizableColumns: true,
  maxColumnWidth: 420,
  tableOverflow: "center",
  theme: "auto",
};

const provider = new MarkdownEditorProvider({ extensionUri: stub() });

const readerPage = (over = {}) =>
  provider.buildHtml(SOURCE, webview, "mermaid.js", "vditor", "/docs", "vscode-resource://docs", GIT, {
    ...baseConfig,
    ...over,
  });

const editPage = (over = {}) =>
  provider.buildEditHtml(SOURCE, webview, "vditor", "/docs", "vscode-resource://docs", GIT, {
    ...baseConfig,
    editMode: true,
    ...over,
  });

const scriptsOf = (html) =>
  [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    // <script src=...> tags carry no inline body to parse
    .filter((m) => !/\bsrc\s*=/i.test(m[1]))
    .map((m) => m[2]);

function assertParses(html, label) {
  const scripts = scriptsOf(html);
  assert.ok(scripts.length > 0, `${label}: expected at least one inline script`);
  scripts.forEach((src, i) => {
    assert.doesNotThrow(
      () => new Function(src),
      `${label}: inline <script> #${i + 1} does not parse`
    );
  });
  return scripts;
}

describe("webview pages", () => {
  it("reader page parses", () => assertParses(readerPage(), "reader"));
  it("edit mode page parses", () => assertParses(editPage(), "edit"));

  // Every toggle changes what gets interpolated, so a broken branch can hide
  // behind the defaults.
  const variants = {
    "git header off": { showGitHeader: false },
    "history expanded": { historyExpanded: true },
    "no collapsible headings": { collapsibleHeadings: false },
    "no resizable columns": { resizableColumns: false },
    "left table overflow": { tableOverflow: "left" },
    "no column cap": { maxColumnWidth: 0 },
    "double esc off": { doubleEscToPreview: false },
  };
  for (const [name, over] of Object.entries(variants)) {
    it(`reader parses with ${name}`, () => assertParses(readerPage(over), `reader/${name}`));
    it(`edit mode parses with ${name}`, () => assertParses(editPage(over), `edit/${name}`));
  }

  for (const theme of THEMES) {
    it(`reader parses with theme=${theme}`, () => assertParses(readerPage({ theme }), `reader/${theme}`));
    it(`edit mode parses with theme=${theme}`, () => assertParses(editPage({ theme }), `edit/${theme}`));
  }
});

describe("fullscreen diagrams", () => {
  it("ships the shared viewer in both pages", () => {
    for (const [label, html] of [["reader", readerPage()], ["edit", editPage()]]) {
      assert.ok(html.includes("window.bmrZoom"), `${label}: viewer missing`);
      assert.ok(html.includes(".mermaid-modal"), `${label}: modal CSS missing`);
      assert.ok(html.includes(".mermaid-stage"), `${label}: stage CSS missing`);
    }
  });

  it("gives edit mode the floating button, and the reader the in-place one", () => {
    const edit = editPage();
    assert.ok(edit.includes("bmr-dgm-btn"), "edit: floating button missing");
    assert.ok(edit.includes(".language-mermaid"), "edit: does not look for Vditor's diagrams");

    const reader = readerPage();
    assert.ok(reader.includes("mermaid-wrap"), "reader: wrapper missing");
    assert.ok(!reader.includes("bmr-dgm-btn"), "reader should not carry the edit-mode button");
  });

  it("never wraps or rewrites Vditor's diagram DOM", () => {
    // The whole reason edit mode uses a floating button: Lute rebuilds the
    // markdown from this DOM, so restructuring it can corrupt the file.
    const edit = editPage();
    const wiring = edit.slice(edit.indexOf("bmr-dgm-btn"));
    for (const forbidden of ["insertBefore", "appendChild(el)", "mermaid-wrap"]) {
      assert.ok(!wiring.includes(forbidden), `edit mode must not call ${forbidden} on the diagram`);
    }
    assert.ok(edit.includes("document.body.appendChild(btn)"), "button should live in <body>");
  });

  it("closes on Escape without letting the editor see it", () => {
    // Edit mode also listens for Escape (double-Esc back to preview), so the
    // modal has to swallow the one that closes it.
    const html = editPage();
    assert.ok(html.includes("keydown', onKey, true"), "Escape should be captured");
    assert.ok(html.includes("e.stopPropagation();\n      close();"), "Escape should not bubble");
  });

  it("interpolates cleanly, leaving no template placeholders behind", () => {
    for (const [label, html] of [["reader", readerPage()], ["edit", editPage()]]) {
      assert.ok(!html.includes("${"), `${label}: an unexpanded \${...} reached the page`);
      assert.ok(!/\bundefined\b/.test(html.slice(html.indexOf("window.bmrZoom"))), `${label}: undefined leaked into the viewer`);
    }
  });
});
