const assert = require("assert");

// Lute is the markdown engine inside Vditor, shipped as a browser bundle. It
// only needs `window`/`self` to exist, so it loads in plain node.
global.window = global;
global.self = global;
require("../media/vditor/dist/js/lute/lute.min.js");
const lute = global.Lute.New();

// Round-trip a single table cell the way edit mode does: markdown -> IR DOM
// (what you see) -> markdown (what gets written back).
function cell(content) {
  const md = "| # | Need |\n|---|------|\n| a | " + content + " |\n";
  const row = lute.VditorIRDOM2Md(lute.Md2VditorIRDOM(md)).trim().split("\n")[2];
  return (row.split("|")[2] || "").trim();
}

// vditor 3.11.2 dropped the whitespace before the FIRST inline node of a table
// cell, for every inline type, in the DOM and in the markdown written back.
// "Transaction has **zero**" became "Transaction has**zero**" on save.
// Fixed in 3.11.3. These guard against a downgrade or a bad re-vendor.
describe("lute table cells", () => {
  const cases = [
    ["bold", "x **b** y"],
    ["emphasis", "x *i* y"],
    ["code", "x `c` y"],
    ["link", "x [l](u) y"],
    ["strikethrough", "x ~~s~~ y"],
    ["inline at end of cell", "x **b**"],
    ["second inline in the same cell", "x **b** y **b2** z"],
    ["the original report", 'Transaction has **zero** allocations, so FE renders'],
  ];

  for (const [name, input] of cases) {
    it("keeps the space before " + name, () => {
      assert.strictEqual(cell(input), input);
    });
  }

  it("still parses a cell that opens with an inline node", () => {
    assert.strictEqual(cell("**b** y"), "**b** y");
  });
});

// Edit mode shows local pictures by rewriting img src and by hanging a
// background on the span that IR mode uses to display a raw <img> as its own
// source. Both are edits to a contenteditable that gets serialized back into
// the user's file, so the whole approach rests on Lute ignoring them: it
// rebuilds the markdown from its marker spans instead. If that ever stops being
// true, local images start writing vscode-webview:// URLs into the document.
describe("lute ignores our image decoration", () => {
  const docs = {
    "markdown image": "![alt](images/01.png)\n",
    "raw img on its own line": '<img src="images/01.png" width="200">\n',
    "raw img in a table cell": '| Screen | Note |\n|---|---|\n| <img src="images/01.png" width="200"> | hi |\n',
  };

  // what the webview does to the rendered DOM, as a string rewrite
  const decorate = (dom) =>
    dom
      .replace(/src="images\//g, 'src="vscode-webview://abc/images/')
      .replace(/<span data-type="html-inline"/g,
        '<span data-bmr-img="" style="background-image:url(vscode-webview://abc/i.png);width:200px" data-type="html-inline"');

  for (const [name, md] of Object.entries(docs)) {
    it("writes the original markdown back for a " + name, () => {
      const dom = lute.Md2VditorIRDOM(md);
      const expected = lute.VditorIRDOM2Md(dom);
      assert.strictEqual(lute.VditorIRDOM2Md(decorate(dom)), expected);
    });

    it("survives the keystroke round trip for a " + name, () => {
      const dom = lute.Md2VditorIRDOM(md);
      const expected = lute.VditorIRDOM2Md(dom);
      assert.strictEqual(lute.VditorIRDOM2Md(lute.SpinVditorIRDOM(decorate(dom))), expected);
    });
  }

  it("keeps the raw tag reconstructable from the marker, not from src", () => {
    const dom = lute.Md2VditorIRDOM(docs["raw img in a table cell"]);
    const out = lute.VditorIRDOM2Md(decorate(dom));
    assert.ok(out.includes('src="images/01.png"'), "original relative path written back");
    assert.ok(!out.includes("vscode-webview://"), "webview URL never reaches the file");
  });
});
