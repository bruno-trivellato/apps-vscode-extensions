// The webview page. No `vscode` import, so the whole page can be generated and
// asserted on in plain Node — see test/html.test.js.

const { parseDiff, escapeHtml, countChanges } = require("./diff");
const { DIFF_CSS, KIND_CLASS } = require("./css");

// One <div> per line, in the patch's own order. An empty line still needs a
// character or `white-space: pre` collapses the box to zero height.
function renderRows(rows) {
  return rows
    .map(
      (r) =>
        `<div class="bdv-line ${KIND_CLASS[r.kind] || "bdv-ctx"}">${
          r.text ? escapeHtml(r.text) : "&nbsp;"
        }</div>`
    )
    .join("\n");
}

/**
 * Full page for a patch. Read-only: the view carries no script at all, which is
 * why the CSP below can say `script-src 'none'` outright.
 */
function buildHtml({ text, cspSource = "", fileName = "", version = "" }) {
  const rows = parseDiff(text);
  const { added, removed } = countChanges(rows);
  const body = rows.length
    ? `<div class="bdv-diff">\n${renderRows(rows)}\n</div>`
    : `<div class="bdv-empty">Nothing to show — this file is empty.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'none'; img-src 'none'; font-src ${cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>${DIFF_CSS}</style>
</head>
<body>
<div class="bdv-head">
  <span class="bdv-name">${escapeHtml(fileName)}</span>
  <span class="bdv-plus">+${added}</span>
  <span class="bdv-minus">-${removed}</span>
  <span class="bdv-ver">v${escapeHtml(version)}</span>
</div>
${body}
</body>
</html>`;
}

module.exports = { buildHtml, renderRows };
