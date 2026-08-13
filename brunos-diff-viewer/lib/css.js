// Webview styles. Kept out of extension.js so they can be asserted on in tests
// without pulling in the `vscode` module.

// Colours come from the theme's own diff palette, so light and dark both work
// and a custom theme is respected. The literal rgba() at the end of each chain
// is only a floor for themes that leave the variable unset — VSCode's built-in
// diff editor greens/reds, at the alpha it uses for whole-line backgrounds.
const DIFF_CSS = `
  :root {
    --bdv-add-bg: var(--vscode-diffEditor-insertedLineBackground,
                  var(--vscode-diffEditor-insertedTextBackground, rgba(70, 149, 74, 0.22)));
    --bdv-del-bg: var(--vscode-diffEditor-removedLineBackground,
                  var(--vscode-diffEditor-removedTextBackground, rgba(203, 54, 60, 0.22)));
    --bdv-add-edge: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
    --bdv-del-edge: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
    --bdv-border: var(--vscode-panel-border, #8884);
  }

  html, body { margin: 0; padding: 0; }
  body {
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-editor-font-family, "SF Mono", Menlo, Consolas, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    line-height: 1.5;
  }

  /* The whole patch is one block so the coloured backgrounds line up, and it
     scrolls sideways as a unit rather than per line. */
  .bdv-diff {
    display: block;
    min-width: max-content;
    padding: 8px 0 60vh; /* room to scroll the last hunk up off the bottom */
  }

  .bdv-line {
    display: block;
    white-space: pre;
    padding: 0 16px 0 12px;
    border-left: 4px solid transparent;
    tab-size: 4;
  }

  .bdv-add { background: var(--bdv-add-bg); border-left-color: var(--bdv-add-edge); }
  .bdv-del { background: var(--bdv-del-bg); border-left-color: var(--bdv-del-edge); }
  .bdv-ctx { opacity: .85; }

  /* Headers: no green/red, since they are not content. The "--- a/x" pair reads
     as a removal otherwise, which is exactly the confusion this view exists to
     remove. */
  .bdv-file {
    font-weight: 600;
    opacity: .9;
    background: var(--vscode-editor-background);
  }
  .bdv-meta { opacity: .6; }

  .bdv-hunk {
    color: var(--vscode-descriptionForeground, #8b949e);
    background: var(--vscode-editorWidget-background, #8881);
    border-top: 1px solid var(--bdv-border);
    border-bottom: 1px solid var(--bdv-border);
    margin: 10px 0 2px;
  }
  .bdv-diff > .bdv-hunk:first-child { margin-top: 0; }

  /* Summary bar, sticky so the +/- totals stay visible while scrolling. */
  .bdv-head {
    position: sticky; top: 0; z-index: 2;
    display: flex; align-items: center; gap: 10px;
    padding: 6px 16px;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--bdv-border);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 12px;
  }
  .bdv-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .75; }
  .bdv-plus { color: var(--bdv-add-edge); font-weight: 600; }
  .bdv-minus { color: var(--bdv-del-edge); font-weight: 600; }
  .bdv-ver { opacity: .45; font-size: 10px; }

  .bdv-empty { padding: 24px 16px; opacity: .6; font-style: italic; }
`;

// The kind reported by parseDiff maps 1:1 onto a class name.
const KIND_CLASS = {
  add: "bdv-add",
  del: "bdv-del",
  ctx: "bdv-ctx",
  hunk: "bdv-hunk",
  file: "bdv-file",
  meta: "bdv-meta",
};

module.exports = { DIFF_CSS, KIND_CLASS };
