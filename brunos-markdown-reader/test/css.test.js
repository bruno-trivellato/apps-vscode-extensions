const assert = require("assert");
const { TABLE_CSS, EDIT_TABLE_CSS } = require("../lib/css");

// These guard real bugs, not taste. Each case names the symptom it prevents so
// a future change that "simplifies" the CSS fails here with a readable reason.
//
// Original report: a 4-column table of API routes rendered with the Route
// column starved so narrow that `/v1/categories` broke as "/v1/ca" / "tegori" /
// "es", while the Purpose column kept its full width.

// crude but sufficient: pull the declarations of one selector out of the block
function rule(css, selector) {
  const re = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  assert.ok(m, `no rule found for selector "${selector}"`);
  return m[2];
}

describe("reader table CSS", () => {
  it("keeps inline code in cells on one line", () => {
    // The actual reported bug: routes shredded mid-token inside table cells.
    const decls = rule(TABLE_CSS, "th code, td code");
    assert.match(decls, /white-space:\s*nowrap/);
  });

  it("never lets a cell break code at arbitrary characters", () => {
    // break-all/anywhere would reintroduce the shredding even with nowrap gone.
    assert.doesNotMatch(TABLE_CSS, /word-break:\s*break-all/);
    assert.doesNotMatch(TABLE_CSS, /overflow-wrap:\s*anywhere/);
  });

  it("gives a wide table its own scrollbar instead of crushing columns", () => {
    const decls = rule(TABLE_CSS, "table");
    // display:block is what makes overflow-x apply to a table element at all,
    // so the two must travel together.
    assert.match(decls, /display:\s*block/);
    assert.match(decls, /overflow-x:\s*auto/);
  });

  it("sizes the table to its content rather than stretching it", () => {
    const decls = rule(TABLE_CSS, "table");
    assert.match(decls, /width:\s*max-content/);
    assert.match(decls, /max-width:\s*\d+vw/);
  });

  it("grows the table from the centre in both directions", () => {
    // margin-left:50% alone would push the table right; the transform is what
    // pulls it back by half its width. Removing either one breaks centring.
    const decls = rule(TABLE_CSS, "table");
    assert.match(decls, /margin-left:\s*50%/);
    assert.match(decls, /transform:\s*translateX\(-50%\)/);
  });

  it("top-aligns cells so short values stay next to their key", () => {
    assert.match(rule(TABLE_CSS, "th, td"), /vertical-align:\s*top/);
  });

  it("left-aligns headers to match the cells under them", () => {
    assert.match(rule(TABLE_CSS, "th"), /text-align:\s*left/);
  });

  it("still draws cell borders", () => {
    const decls = rule(TABLE_CSS, "th, td");
    assert.match(decls, /border:\s*1px solid/);
    assert.match(rule(TABLE_CSS, "table"), /border-collapse:\s*collapse/);
  });
});

// Edit mode is Vditor, which ships its own table CSS. These fix the same two
// symptoms as the reader, but by undoing specific vditor 3.11.2 rules, so they
// are far more fragile: a vditor upgrade can silently re-break them.
describe("edit mode (Vditor) table CSS", () => {
  it("stops Vditor shredding inline code inside cells", () => {
    // vditor index.css:981 sets word-break:break-word + white-space:pre-wrap on
    // code, which beats the cell's own nowrap. Both must be undone.
    // grouped selector spans two lines, so match the block directly
    const m = EDIT_TABLE_CSS.match(/table th code[^{]*\{([^}]*)\}/);
    assert.ok(m, "no rule found for code inside table cells");
    assert.match(m[1], /word-break:\s*normal/);
    assert.match(m[1], /white-space:\s*nowrap/);
  });

  it("keeps the :not() chain that makes the code override win", () => {
    // Vditor's selector scores (0,3,1). Dropping either :not() drops ours to
    // (0,2,3) or lower and the rule silently stops applying. No test would
    // notice except this one.
    const m = EDIT_TABLE_CSS.match(/table (?:td|th) code:not\(\.hljs\):not\(\.highlight-chroma\)/g);
    assert.ok(m && m.length === 2, "both td and th code selectors must keep :not(.hljs):not(.highlight-chroma)");
  });

  it("lets the table size to its content instead of the container", () => {
    // vditor index.css:947 sets width:100%, which is why the table never grew.
    const decls = rule(EDIT_TABLE_CSS, ".vditor-reset table");
    assert.match(decls, /width:\s*max-content/);
    assert.doesNotMatch(decls, /width:\s*100%/);
  });

  it("grows the table from the centre, as the reader does", () => {
    const decls = rule(EDIT_TABLE_CSS, ".vditor-reset table");
    assert.match(decls, /margin-left:\s*50%/);
    assert.match(decls, /transform:\s*translateX\(-50%\)/);
  });

  it("top-aligns cells and left-aligns headers", () => {
    assert.match(rule(EDIT_TABLE_CSS, ".vditor-reset table td, .vditor-reset table th"), /vertical-align:\s*top/);
    assert.match(rule(EDIT_TABLE_CSS, ".vditor-reset table th"), /text-align:\s*left/);
  });
});
