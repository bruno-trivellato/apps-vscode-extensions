const assert = require("assert");
const { tableCss, editTableCss, FOLD_CSS, EDIT_FOLD_CSS, TABLE_OVERFLOW_MODES } = require("../lib/css");

// default mode, so the existing expectations keep describing "center"
const TABLE_CSS = tableCss("center");
const EDIT_TABLE_CSS = editTableCss("center");

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

// The tableOverflow setting. "center" is the default and is covered above;
// these pin down that "left" really is the other behaviour and not a no-op.
describe("tableOverflow setting", () => {
  it("offers exactly the two documented modes", () => {
    assert.deepStrictEqual(TABLE_OVERFLOW_MODES, ["center", "left"]);
  });

  for (const [name, build] of [["reader", tableCss], ["edit mode", editTableCss]]) {
    it(`centres ${name} tables in "center" mode`, () => {
      const css = build("center");
      assert.match(css, /margin-left:\s*50%/);
      assert.match(css, /transform:\s*translateX\(-50%\)/);
    });

    it(`anchors ${name} tables left in "left" mode`, () => {
      const css = build("left");
      // the breakout is what shifts the table; all of it must go together or
      // the table ends up pushed off to one side
      assert.doesNotMatch(css, /margin-left:\s*50%/);
      assert.doesNotMatch(css, /transform:\s*translateX\(-50%\)/);
      assert.doesNotMatch(css, /margin-right:\s*calc\(\s*-/);
    });

    it(`keeps ${name} tables from scrolling the pane sideways in "center" mode`, () => {
      // A transform moves the table on screen but not in layout, so without
      // this the pane measures the table as starting at its centre and grows a
      // horizontal scrollbar into empty space. Measured at 1400px: scrollWidth
      // 2316 against clientWidth 1400.
      assert.match(build("center"), /margin-right:\s*calc\(-50%\s*-\s*94vw\)/);
    });

    it(`cancels exactly what the ${name} breakout pushes out`, () => {
      // The negative margin has to cover margin-left plus the widest the table
      // may get, so the two numbers are tied. Change the cap and this fails.
      const css = build("center");
      const cap = /max-width:\s*(\d+)vw/.exec(css);
      assert.ok(cap, "center mode must cap the width in vw");
      const cancel = /margin-right:\s*calc\(-50%\s*-\s*(\d+)vw\)/.exec(css);
      assert.ok(cancel, "center mode must cancel the breakout");
      assert.strictEqual(cancel[1], cap[1], "the cancellation must match the width cap");
    });

    it(`keeps ${name} tables sized to content in both modes`, () => {
      // only the alignment changes between modes, never the growth itself
      for (const mode of TABLE_OVERFLOW_MODES) {
        assert.match(build(mode), /width:\s*max-content/, `${mode} must still size to content`);
        assert.match(build(mode), /max-width:\s*\S/, `${mode} must still cap at the viewport`);
      }
    });
  }

  it("never shreds inline code, whichever mode is picked", () => {
    // the original bug must not come back through a mode nobody tested
    for (const mode of TABLE_OVERFLOW_MODES) {
      assert.match(tableCss(mode), /th code, td code \{ white-space: nowrap; \}/);
      assert.match(editTableCss(mode), /white-space:\s*nowrap/);
    }
  });
});

describe("collapsible headings CSS", () => {
  it("hides a folded section", () => {
    assert.match(FOLD_CSS, /\[data-bmr-hidden\]\s*\{\s*display:\s*none/);
  });

  it("anchors the arrow against the heading", () => {
    // absolute positioning only works if the heading is a positioned ancestor
    assert.match(FOLD_CSS, /h1, h2, h3, h4, h5, h6 \{ position: relative; \}/);
    assert.match(FOLD_CSS, /\.bmr-fold \{[^}]*position:\s*absolute/);
  });

  it("keeps the arrow visible while its section is folded", () => {
    // otherwise a collapsed section looks like content that simply vanished
    assert.match(FOLD_CSS, /\.bmr-folded \.bmr-fold \{ opacity: \.8; \}/);
  });

  it("clears the kebab so the two buttons do not overlap", () => {
    // kebab sits at right:12px and is 28px wide
    const m = FOLD_CSS.match(/\.bmr-foldall \{([^}]*)\}/);
    assert.ok(m, "no .bmr-foldall rule");
    assert.match(m[1], /right:\s*46px/);
  });
});

// Edit mode folding. The arrows must stay OUT of the contenteditable, since
// anything inside it can be serialized into the user's file.
describe("edit mode fold CSS", () => {
  it("hides folded blocks inside the editor", () => {
    assert.match(EDIT_FOLD_CSS, /\.vditor-reset \[data-bmr-hidden\]\s*\{\s*display:\s*none/);
  });

  it("floats the arrows instead of anchoring them in the heading", () => {
    // position:fixed is what lets the button live on <body>, outside the
    // contenteditable. Making it absolute/relative would imply re-parenting it
    // into the editor, which risks writing a <button> into the markdown.
    const m = EDIT_FOLD_CSS.match(/\.bmr-fold-o \{([^}]*)\}/);
    assert.ok(m, "no .bmr-fold-o rule");
    assert.match(m[1], /position:\s*fixed/);
  });

  it("never scopes the arrow inside .vditor-reset", () => {
    assert.doesNotMatch(EDIT_FOLD_CSS, /\.vditor-reset[^{]*\.bmr-fold-o/);
  });

  it("keeps a folded section's arrow visible", () => {
    assert.match(EDIT_FOLD_CSS, /\.bmr-fold-on/);
  });
});

// The per-column cap. `width: max-content` means "wide enough that nothing
// wraps", so without this one long cell stretches its column across the pane.
describe("maxColumnWidth setting", () => {
  for (const [name, build] of [["reader", tableCss], ["edit mode", editTableCss]]) {
    it(`caps ${name} columns when a width is given`, () => {
      const css = build("center", 420);
      assert.match(css, /max-width:\s*420px/);
    });

    it(`leaves ${name} columns uncapped at 0`, () => {
      const css = build("center", 0);
      assert.doesNotMatch(css, /max-width:\s*0px/);
      assert.doesNotMatch(css, /max-width:\s*\d+px/);
    });

    it(`defaults ${name} to uncapped when no width is passed`, () => {
      assert.doesNotMatch(build("center"), /max-width:\s*\d+px/);
    });
  }

  it("caps the cell, not the table, so the column is what shrinks", () => {
    const decls = rule(tableCss("center", 420), "th, td");
    assert.match(decls, /max-width:\s*420px/);
  });

  it("lets edit-mode cells wrap, or the cap does nothing", () => {
    // vditor index.css:1005 sets white-space:nowrap on the cell itself, so in
    // edit mode nothing in a table ever wrapped: measured min-content 4108px
    // against a 1316px box. The cap is inert until that is undone.
    const decls = rule(editTableCss("center", 420), ".vditor-reset table td, .vditor-reset table th");
    assert.match(decls, /white-space:\s*normal/);
    assert.match(decls, /max-width:\s*420px/);
  });

  it("leaves edit-mode cell wrapping alone when uncapped", () => {
    const decls = rule(editTableCss("center", 0), ".vditor-reset table td, .vditor-reset table th");
    assert.doesNotMatch(decls, /white-space:\s*normal/);
  });

  it("keeps code nowrap even when capped, so routes stay whole", () => {
    // a cap that broke `/v1/categories` into fragments would recreate the
    // original bug the nowrap was added for
    for (const build of [tableCss, editTableCss]) {
      assert.match(build("center", 420), /white-space:\s*nowrap/);
    }
  });
});
