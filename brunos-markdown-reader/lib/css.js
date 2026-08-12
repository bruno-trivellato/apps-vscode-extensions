// Style fragments shared with the tests. Kept out of extension.js so mocha can
// require them without pulling in the `vscode` module, which only exists inside
// the host. Anything asserted in test/css.test.js belongs here.

// Reader tables. Every rule below fixes a bug seen in the wild, so read
// test/css.test.js before "tidying" any of it.
//
// The failure it replaced: a 4-column table with long routes could not fit the
// 860px prose column, so the browser starved the narrowest column until
// `/v1/categories` wrapped as "/v1/ca" / "tegori" / "es".
const TABLE_CSS = `
  table {
    /* block, not table, so the element can own a horizontal scrollbar instead
       of crushing its columns to fit */
    display: block;
    /* size to the content, so a narrow table stays narrow */
    width: max-content;
    max-width: 94vw;
    margin: 1em 0;
    /* Break out of the prose column and grow from the centre in both
       directions: the left edge lands on the page centre, then the transform
       pulls it back by half its own width. */
    margin-left: 50%;
    transform: translateX(-50%);
    overflow-x: auto;
    border-collapse: collapse;
  }
  th, td {
    border: 1px solid var(--vscode-panel-border, #8884);
    padding: 6px 12px;
    /* short cells used to sit mid-row, adrift from the key they belong to */
    vertical-align: top;
  }
  th { text-align: left; }
  /* Routes and ids stay whole. Without this a squeezed cell breaks them at
     arbitrary characters, which is the original bug. */
  th code, td code { white-space: nowrap; }`;

// Edit mode (Vditor) tables. Same two symptoms as the reader, but the cause is
// Vditor's own stylesheet rather than the absence of rules, so this is written
// as a set of targeted undos. Line numbers are from vditor 3.11.2 dist/index.css.
//
//   :947  .vditor-reset table { width: 100% }
//         pins the table to the container, so it can never grow to its content.
//   :981  .vditor-reset code:not(.hljs):not(.highlight-chroma) {
//           word-break: break-word; white-space: pre-wrap }
//         beats the cell's own `white-space: nowrap` (:960) because it targets
//         the code element directly. This is what shreds `/v1/categories`.
//
// Our <style> is emitted after Vditor's <link>, so equal specificity wins on
// order. The code selector below deliberately repeats Vditor's :not() chain to
// out-specify it (0,3,3 against 0,3,1) instead of reaching for !important.
const EDIT_TABLE_CSS = `
  .vditor-reset table {
    /* Vditor already sets display:block + overflow:auto, so it can scroll.
       These let it size to content and grow from the centre, as in the reader. */
    width: max-content;
    max-width: 94vw;
    margin-left: 50%;
    transform: translateX(-50%);
  }
  .vditor-reset table td code:not(.hljs):not(.highlight-chroma),
  .vditor-reset table th code:not(.hljs):not(.highlight-chroma) {
    word-break: normal;
    white-space: nowrap;
  }
  .vditor-reset table td, .vditor-reset table th { vertical-align: top; }
  .vditor-reset table th { text-align: left; }`;

module.exports = { TABLE_CSS, EDIT_TABLE_CSS };
