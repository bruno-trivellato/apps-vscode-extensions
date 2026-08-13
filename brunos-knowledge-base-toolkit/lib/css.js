// Style fragments shared with the tests. Kept out of extension.js so mocha can
// require them without pulling in the `vscode` module, which only exists inside
// the host. Anything asserted in test/css.test.js belongs here.

// How a table wider than the text column is allowed to grow.
//   "center" grows it both ways from the page centre
//   "left"   keeps its left edge on the text column and grows right only
const TABLE_OVERFLOW_MODES = ["center", "left"];

// Which palette the reader paints itself with.
//   "auto"  follow VSCode, which itself follows the system theme
//   "light" / "dark" force one, whatever VSCode is set to
const THEMES = ["auto", "light", "dark"];

// Forcing a theme means repainting, not relabelling.
//
// Every colour in this extension is a `var(--vscode-*)` with a fallback, so in
// "auto" we inherit VSCode's own palette and there is nothing to do. Forcing is
// different: those variables are still whatever VSCode set, so telling Vditor
// and mermaid "you are dark now" would leave dark code blocks on a white page.
// So a forced theme redefines the variables the extension actually reads.
//
// Only the 19 variables used anywhere in this codebase are listed. Keep this in
// step with the code: a new `var(--vscode-x)` that is not here falls back to its
// own literal, which is the one colour guaranteed not to match a forced theme.
// `grep -oh -- "--vscode-[a-zA-Z0-9-]*" extension.js lib/*.js | sort -u` lists them.
//
// Values track VSCode's own Dark Modern and Light Modern, so a forced theme
// looks like a theme the user already knows rather than something invented here.
const PALETTES = {
  dark: {
    "editor-background": "#1f1f1f",
    "editor-foreground": "#cccccc",
    "panel-border": "#3c3c3c",
    "textCodeBlock-background": "#2a2a2a",
    "list-hoverBackground": "#2a2d2e",
    "focusBorder": "#0078d4",
    "editorWidget-background": "#202020",
    "descriptionForeground": "#9d9d9d",
    "textLink-foreground": "#4daafc",
    "input-background": "#313131",
    "input-foreground": "#cccccc",
    "input-border": "#3c3c3c",
    "editorHoverWidget-background": "#202020",
    "editorHoverWidget-foreground": "#cccccc",
    "editorHoverWidget-border": "#454545",
    "editorError-foreground": "#f85149",
    "button-background": "#0078d4",
    "button-secondaryBackground": "#313131",
    "button-secondaryForeground": "#cccccc",
  },
  light: {
    "editor-background": "#ffffff",
    "editor-foreground": "#3b3b3b",
    "panel-border": "#d4d4d4",
    "textCodeBlock-background": "#f0f0f0",
    "list-hoverBackground": "#f2f2f2",
    "focusBorder": "#0078d4",
    "editorWidget-background": "#f8f8f8",
    "descriptionForeground": "#767676",
    "textLink-foreground": "#0f6cbd",
    "input-background": "#ffffff",
    "input-foreground": "#3b3b3b",
    "input-border": "#cecece",
    "editorHoverWidget-background": "#f8f8f8",
    "editorHoverWidget-foreground": "#3b3b3b",
    "editorHoverWidget-border": "#cecece",
    "editorError-foreground": "#e51400",
    "button-background": "#0078d4",
    "button-secondaryBackground": "#e5e5e5",
    "button-secondaryForeground": "#3b3b3b",
  },
};

// The override block for a forced theme, empty for "auto".
//
// Emitted on :root, and our <style> comes after the one VSCode injects, so
// equal specificity resolves on order and ours wins. `color-scheme` is what
// stops the browser painting white scrollbars and form controls on a dark page.
function themeCss(theme) {
  const palette = PALETTES[theme];
  if (!palette) return "";
  const vars = Object.entries(palette)
    .map(([k, v]) => `    --vscode-${k}: ${v};`)
    .join("\n");
  return `
  :root {
    color-scheme: ${theme};
${vars}
  }
  /* VSCode paints the webview's body itself. Redefining the variable only helps
     if its own rule reads the variable rather than an inlined colour, so set
     both here and do not depend on which it does. */
  body {
    background-color: ${palette["editor-background"]};
    color: ${palette["editor-foreground"]};
  }`;
}

// Whether a resolved theme paints dark. "auto" has no answer here: only the
// webview knows what VSCode is, so it is decided in the page. Returns null so a
// caller cannot mistake "follow VSCode" for "light".
function isDarkTheme(theme) {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return null;
}

// margin-left:50% puts the left edge on the centre of the containing block,
// then the transform pulls it back by half its own width. Both are needed:
// margin-left alone just shoves the table right.
//
// The negative margin-right is what stops that trick leaking. A transform moves
// the table on screen but NOT in layout, so the box still measures as if it
// started at the centre, and the pane it lives in grows a horizontal scrollbar
// into empty space. Measured on a 7-column table at a 1400px viewport: the
// editor pane reported scrollWidth 2316 against clientWidth 1400, so 916px of
// nothing you could scroll to the right of a table that already fitted.
//
// Pulling the end of the box back by the same distance the start was pushed
// out (50%) plus the widest the table may ever be (94vw, the cap below) leaves
// the layout footprint no bigger than the pane. Over-cancelling is harmless:
// margins do not feed into a used width that is already max-content. Unlike
// symmetric negative margins, which do the same job, this keeps a table
// narrower than the page centred rather than pinning it to the left gutter.
function breakout(overflow) {
  return overflow === "left"
    ? ""
    : `
    margin-left: 50%;
    margin-right: calc(-50% - 94vw);
    transform: translateX(-50%);`;
}

// How wide the table may get before it scrolls internally.
// "center" is symmetric around the page centre, so 94vw stays on screen by
// construction. "left" starts at the text column's left edge instead, so the
// same 94vw would run off the right and get clipped. The reader's column is
// 860px wide with 32px padding, which puts that left edge at 50vw - 398px, so
// the room remaining to the right is 50vw + 398px. 12px is left as a gutter.
function maxWidth(overflow, edge) {
  return overflow === "left" ? edge : "94vw";
}

// How wide any single column may get before its text wraps.
//
// `width: max-content` on the table means "wide enough that nothing wraps", so
// one long cell stretches its column as far as it needs. Measured on a
// two-column table whose second cell holds a sentence: the column came out
// 1257px wide, one line of text across the whole pane. A cap of 420px brings it
// to 447 and wraps it over three lines.
//
// A cap cannot shrink a column below its min-content, and `code` keeps its
// nowrap below, so a single inline route longer than the cap widens its column
// past it rather than spilling out of the cell. That is the intended trade: a
// route stays whole, a sentence wraps.
//
// 0 means no cap.
function columnCap(px) {
  return px > 0 ? `\n    max-width: ${px}px;` : "";
}

// Reader tables. Every rule below fixes a bug seen in the wild, so read
// test/css.test.js before "tidying" any of it.
//
// The failure it replaced: a 4-column table with long routes could not fit the
// 860px prose column, so the browser starved the narrowest column until
// `/v1/categories` wrapped as "/v1/ca" / "tegori" / "es".
function tableCss(overflow, maxColumnWidth = 0) {
  return `
  table {
    /* block, not table, so the element can own a horizontal scrollbar instead
       of crushing its columns to fit */
    display: block;
    /* size to the content, so a narrow table stays narrow */
    width: max-content;
    max-width: ${maxWidth(overflow, "calc(50vw + 386px)")};
    margin: 1em 0;${breakout(overflow)}
    overflow-x: auto;
    border-collapse: collapse;
  }
  th, td {
    border: 1px solid var(--vscode-panel-border, #8884);
    padding: 6px 12px;
    /* short cells used to sit mid-row, adrift from the key they belong to */
    vertical-align: top;${columnCap(maxColumnWidth)}
  }
  th { text-align: left; }
  /* Routes and ids stay whole. Without this a squeezed cell breaks them at
     arbitrary characters, which is the original bug. */
  th code, td code { white-space: nowrap; }`;
}

// Edit mode (Vditor) tables. Same two symptoms as the reader, but the cause is
// Vditor's own stylesheet rather than the absence of rules, so this is written
// as a set of targeted undos. Line numbers are from vditor 3.11.3 dist/index.css.
//
//   :986  .vditor-reset table { ... width: 100% (:994) }
//         pins the table to the container, so it can never grow to its content.
//   :1020 .vditor-reset code:not(.hljs):not(.highlight-chroma) {
//           word-break: break-word (:1026); white-space: pre-wrap (:1028) }
//         beats the cell's own `white-space: nowrap` (:1005) because it targets
//         the code element directly. This is what shreds `/v1/categories`.
//
// Our <style> is emitted after Vditor's <link>, so equal specificity wins on
// order. The code selector below deliberately repeats Vditor's :not() chain to
// out-specify it (0,3,3 against 0,3,1) instead of reaching for !important.
function editTableCss(overflow, maxColumnWidth = 0) {
  return `
  .vditor-reset table {
    /* Vditor already sets display:block + overflow:auto, so it can scroll.
       These let it size to content and grow as the reader's tables do. */
    width: max-content;
    /* edit mode has no fixed prose column: the editor already fills the panel */
    max-width: ${maxWidth(overflow, "100%")};${breakout(overflow)}
  }
  .vditor-reset table td code:not(.hljs):not(.highlight-chroma),
  .vditor-reset table th code:not(.hljs):not(.highlight-chroma) {
    word-break: normal;
    white-space: nowrap;
  }
  .vditor-reset table td, .vditor-reset table th {
    vertical-align: top;${maxColumnWidth > 0 ? `
    /* Vditor's index.css:1005 puts white-space:nowrap on the CELL, not just on
       code, so in edit mode nothing in a table ever wrapped and a cell grew to
       whatever one line needed. Measured on a 7-column table: min-content 4108px
       against a 1316px box, and the widest column alone was 1317px. Undoing it
       is what makes the cap below mean anything, and it brings that table down
       to 1447px. Equal specificity to Vditor's rule, and we come later. */
    white-space: normal;${columnCap(maxColumnWidth)}` : ""}
  }
  .vditor-reset table th { text-align: left; }`;
}

// Collapsible headings, reader only. The fold arrow lives inside the heading
// and is only revealed on hover, unless its section is folded, so a document
// nobody folds looks exactly as it did before.
const FOLD_CSS = `
  h1, h2, h3, h4, h5, h6 { position: relative; }
  .bmr-fold {
    position: absolute; left: -.95em; top: 50%; transform: translateY(-50%);
    width: .8em; height: .8em; padding: 0; border: none; background: none;
    display: flex; align-items: center; justify-content: center;
    font-size: .75em; line-height: 1; cursor: pointer;
    color: var(--vscode-descriptionForeground, #999);
    opacity: 0; transition: opacity .12s;
  }
  h1:hover .bmr-fold, h2:hover .bmr-fold, h3:hover .bmr-fold,
  h4:hover .bmr-fold, h5:hover .bmr-fold, h6:hover .bmr-fold { opacity: .8; }
  .bmr-fold:hover { opacity: 1 !important; }
  /* a folded section keeps its arrow visible, else the content looks lost */
  .bmr-folded .bmr-fold { opacity: .8; }
  [data-bmr-hidden] { display: none; }

  /* expand/collapse all, sits left of the kebab */
  .bmr-foldall {
    position: fixed; top: 10px; right: 46px; z-index: 50;
    height: 28px; padding: 0 9px; border-radius: 6px; cursor: pointer;
    font-size: 11px; line-height: 1;
    display: flex; align-items: center; gap: 5px;
    background: color-mix(in srgb, var(--vscode-editor-foreground, #888) 10%, transparent);
    color: var(--vscode-editor-foreground, #ccc);
    border: 1px solid var(--vscode-panel-border, #8884);
    opacity: .45; transition: opacity .15s, background .15s;
  }
  .bmr-foldall:hover { opacity: 1; background: color-mix(in srgb, var(--vscode-editor-foreground, #888) 20%, transparent); }`;

// Collapsible headings in edit mode. The arrows CANNOT live inside the
// heading here: the editor is a contenteditable that Vditor serializes back to
// the file, so any element we inject risks ending up in the markdown. They are
// free-floating buttons instead, positioned over each heading from its
// bounding rect and re-measured on scroll.
//
// Hiding is a data-bmr-hidden attribute on the folded blocks. Verified inert:
// Lute's vditorIRDOM2Md ignores it, and it survives SpinVditorIRDOM, the round
// trip that runs on every keystroke.
const EDIT_FOLD_CSS = `
  .vditor-reset [data-bmr-hidden] { display: none; }
  .bmr-fold-o {
    position: fixed; z-index: 40;
    width: 15px; height: 15px; padding: 0; border: none; background: none;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; line-height: 1; cursor: pointer;
    color: var(--vscode-descriptionForeground, #999);
    opacity: 0; transition: opacity .12s;
  }
  .bmr-fold-o.bmr-fold-near, .bmr-fold-o.bmr-fold-on { opacity: .75; }
  .bmr-fold-o:hover { opacity: 1; }
  .bmr-fold-o[hidden] { display: none; }`;

// Pictures written as a raw <img> tag rather than as markdown. Vditor's IR mode
// shows inline HTML as its own source, on purpose, so you can edit it: the tag
// becomes a span[data-type="html-inline"] wrapping a <code> of the literal text.
// No Lute option renders it, and swapping in a real <img> is not allowed here,
// because the editor serializes this DOM back into the file.
//
// So the span keeps its source text and gets the picture as a background, which
// is styling only and therefore inert. The size is written as an inline style
// once the image reports its own dimensions.
//
// Vditor marks the node the caret is inside with .vditor-ir__node--expand. That
// is the cue to hand the tag back: the picture drops away and the source shows,
// so the width can still be edited. !important beats our own inline styles.
const EDIT_IMG_CSS = `
  .vditor-reset [data-bmr-img] {
    display: inline-block;
    vertical-align: text-bottom;
    max-width: 100%;
    background-repeat: no-repeat;
    background-size: contain;
    background-position: left top;
  }
  /* the tag text stays in the DOM for Lute, it just stops taking up space */
  .vditor-reset [data-bmr-img]:not(.vditor-ir__node--expand) > code {
    font-size: 0 !important;
    padding: 0 !important;
    background: none !important;
  }
  .vditor-reset [data-bmr-img].vditor-ir__node--expand {
    background-image: none !important;
    width: auto !important;
    height: auto !important;
  }`;

// A markdown table cell cannot hold a real list, so the only way to write one
// is raw HTML: <ul><li>a</li><li>b</li></ul>. Lute does not render that inside
// a cell either. It splits the tags into html-inline marker spans and leaves
// each item's text as a bare text node between them, and Vditor hides markers
// unless the caret is in the node, so every item runs into the next.
//
// The spans ARE the document, same as with the pictures: Lute rebuilds the
// markdown from them, so none of them may be moved, wrapped or dropped. The
// list is therefore drawn entirely here, off the data-bmr-list name the webview
// puts on each span:
//
//   <ul>, </ul>, </li>   a zero-height block, which breaks the cell's inline
//                        flow into one anonymous block per item — that is the
//                        line break, without a single element being added
//   <li>                 carries the bullet as a ::before, so it is painted
//                        rather than inserted, and stays out of textContent
//
// The caret entering a node gets the raw tag back, via .vditor-ir__node--expand,
// so the HTML is still editable in place.
const EDIT_LIST_CSS = `
  .vditor-reset [data-bmr-list]:not(.vditor-ir__node--expand) > code {
    font-size: 0 !important;
    padding: 0 !important;
    background: none !important;
  }
  .vditor-reset [data-bmr-list="ul-open"]:not(.vditor-ir__node--expand),
  .vditor-reset [data-bmr-list="ul-close"]:not(.vditor-ir__node--expand),
  .vditor-reset [data-bmr-list="li-close"]:not(.vditor-ir__node--expand) {
    display: block;
    height: 0;
  }
  .vditor-reset [data-bmr-list="li-open"]:not(.vditor-ir__node--expand)::before {
    content: "•";
    display: inline-block;
    width: 1.1em;
    opacity: .7;
  }`;

// Drag a column edge to set its width by hand. Shared by both views, because
// the handles have to work the same way in each: they are free-floating
// elements on <body>, positioned over each header cell's right edge from its
// rect, never inside the table. In edit mode that is not a preference, it is
// the rule, since anything inside the editor is serialized into the file.
//
// The widths themselves are applied through a single stylesheet in <head>, for
// the same reason: no attribute or element is ever put on the table.
const RESIZE_CSS = `
  .bmr-colh {
    position: fixed; z-index: 45;
    width: 9px; margin-left: -4px; padding: 0;
    border: none; background: none;
    cursor: col-resize;
    opacity: 0; transition: opacity .12s;
  }
  /* the visible hairline, inset so the hit area stays comfortably wider */
  .bmr-colh::after {
    content: ""; position: absolute; top: 0; bottom: 0; left: 4px;
    width: 1px; background: var(--vscode-focusBorder, #4a9eff);
  }
  .bmr-colh.bmr-colh-near { opacity: .35; }
  .bmr-colh:hover, .bmr-colh.bmr-colh-live { opacity: 1; }
  .bmr-colh[hidden] { display: none; }
  /* while dragging, stop the pointer selecting text under the cursor */
  body.bmr-colh-dragging { user-select: none; cursor: col-resize; }`;

module.exports = { tableCss, editTableCss, FOLD_CSS, EDIT_FOLD_CSS, EDIT_IMG_CSS, EDIT_LIST_CSS, RESIZE_CSS, TABLE_OVERFLOW_MODES, THEMES, PALETTES, themeCss, isDarkTheme };
