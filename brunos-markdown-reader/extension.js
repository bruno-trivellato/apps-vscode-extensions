const vscode = require("vscode");
const path = require("path");
const { execFile } = require("child_process");
const MarkdownIt = require("markdown-it");
const { resolveTarget, relTime, parseGitLog } = require("./lib/util");

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

// ---- git "track" info -------------------------------------------------------

function git(args, cwd) {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout) => resolve(err ? null : stdout)
    );
  });
}

// Fetch repo + per-file commit history. Returns null when the file isn't in a
// git repo or has no commits yet.
async function getGitInfo(filePath) {
  const cwd = path.dirname(filePath);
  const top = await git(["rev-parse", "--show-toplevel"], cwd);
  if (!top) return null;
  const repoRoot = top.trim();

  // \x1f = field sep, \x1e = record sep — safe against subjects with newlines.
  const logOut = await git(
    ["log", "-n", "40", "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e", "--", filePath],
    cwd
  );
  if (!logOut) return null;

  const commits = parseGitLog(logOut);
  if (!commits.length) return null; // file not committed yet

  const remote = await git(["config", "--get", "remote.origin.url"], cwd);
  return {
    repoName: path.basename(repoRoot),
    relPath: path.relative(repoRoot, filePath),
    remote: remote ? remote.trim() : "",
    commits,
  };
}

// The built-in Git extension already serves file content at any ref via a
// `git:` URI — reuse it instead of rolling our own content provider.
async function getGitApi() {
  const ext = vscode.extensions.getExtension("vscode.git");
  if (!ext) return null;
  const exports = ext.isActive ? ext.exports : await ext.activate();
  return exports && typeof exports.getAPI === "function" ? exports.getAPI(1) : null;
}

// Turn ```mermaid blocks into <pre class="mermaid"> (which mermaid.js renders),
// instead of <pre><code class="language-mermaid">.
const defaultFence =
  md.renderer.rules.fence ||
  function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };
md.renderer.rules.fence = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  const info = (token.info || "").trim().toLowerCase();
  if (info === "mermaid") {
    return `<pre class="mermaid">${md.utils.escapeHtml(token.content)}</pre>`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

// Wrap the pure resolver into a file Uri. Returns null for pure anchors/queries.
function resolveTargetUri(baseDir, href) {
  const t = resolveTarget(baseDir, href);
  if (!t) return null;
  let uri = vscode.Uri.file(t.filePath);
  if (t.fragment) uri = uri.with({ fragment: t.fragment });
  return { uri, filePart: t.filePart };
}

function openTarget(uri, filePart, columnOrOptions) {
  // vscode.open registers in the editor navigation history (back/forward)
  vscode.commands.executeCommand("vscode.open", uri, columnOrOptions).then(undefined, (err) => {
    vscode.window.showErrorMessage(
      `Could not open link: ${filePart} (${err && err.message ? err.message : err})`
    );
  });
}

/**
 * Custom editor that renders the .md directly (instead of the raw text), with mermaid.
 */
class MarkdownEditorProvider {
  constructor(context) {
    this.context = context;
  }

  async resolveCustomTextEditor(document, webviewPanel, _token) {
    const webview = webviewPanel.webview;
    webview.options = { enableScripts: true };

    const mermaidUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "mermaid.min.js")
    );

    const docDir = path.dirname(document.uri.fsPath);
    // git info changes only on commit, not on unsaved edits → fetch once, cache,
    // and reuse across re-renders. Header stays hidden until it resolves.
    let gitInfo = null;
    const render = () => {
      webview.html = this.buildHtml(document.getText(), webview, mermaidUri, docDir, gitInfo);
    };

    render();
    getGitInfo(document.uri.fsPath).then((info) => {
      if (info) {
        gitInfo = info;
        render();
      }
    });

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        render();
      }
    });

    // double-click on the page → reopen the file in the text editor (edit mode)
    const msgSub = webview.onDidReceiveMessage((msg) => {
      if (!msg) return;
      if (msg.type === "edit") {
        // arm the double-Esc-to-preview shortcut for this specific doc only
        editedFromPreview.add(document.uri.toString());
        vscode.commands
          .executeCommand("vscode.openWith", document.uri, "default")
          .then(updateEscapeContext);
        return;
      }
      // click on a relative/local link → resolve against this file's dir and
      // open it via vscode.open (so VSCode back/forward navigation works)
      if (msg.type === "open" && typeof msg.href === "string") {
        this.openLink(document, msg.href, !!msg.newTab);
        return;
      }
      // click a commit → diff the file: parent version (left) vs that commit (right)
      if (msg.type === "diff" && typeof msg.hash === "string") {
        this.openDiff(document, msg.hash);
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      msgSub.dispose();
    });
  }

  async openDiff(document, hash) {
    const api = await getGitApi();
    if (!api || typeof api.toGitUri !== "function") {
      vscode.window.showErrorMessage(
        "Bruno's Markdown Reader: the built-in Git extension is unavailable."
      );
      return;
    }
    const cwd = path.dirname(document.uri.fsPath);
    const name = path.basename(document.uri.fsPath);
    const short = hash.slice(0, 7);
    const right = api.toGitUri(document.uri, hash); // file as of this commit

    // Resolve the actual parent SHA (root commits have none). `:./name` checks
    // whether the file already existed at the parent (git returns "" vs null).
    const parentOut = await git(["rev-parse", "-q", "--verify", `${hash}^`], cwd);
    const parent = parentOut ? parentOut.trim() : null;
    const parentHasFile =
      parent && (await git(["cat-file", "-e", `${parent}:./${name}`], cwd)) !== null;

    if (parent && parentHasFile) {
      // normal case → what this commit changed: parent (left) vs commit (right)
      const left = api.toGitUri(document.uri, parent);
      vscode.commands.executeCommand("vscode.diff", left, right, `${name} @ ${short} (changes in this commit)`, {
        preview: false,
      });
    } else {
      // file was added in this commit (or it's the root commit) → no "before";
      // show this version vs the current file instead of erroring out.
      vscode.commands.executeCommand("vscode.diff", right, document.uri, `${name} @ ${short} ↔ current (added in this commit)`, {
        preview: false,
      });
    }
  }

  openLink(document, href, newTab) {
    const t = resolveTargetUri(path.dirname(document.uri.fsPath), href);
    if (!t) return;
    // newTab → force a permanent (non-preview) tab in the active group
    openTarget(t.uri, t.filePart, newTab ? { preview: false } : undefined);
  }

  buildHeader(git) {
    if (!git || !git.commits.length) return "";
    const esc = (s) => md.utils.escapeHtml(s || "");
    const last = git.commits[0];
    const rows = git.commits
      .map(
        (c) =>
          `<div class="git-row" data-hash="${esc(c.hash)}" title="Show changes in this commit">` +
          `<span class="git-date">${esc(relTime(c.date))}</span>` +
          `<span class="git-author">${esc(c.author)}</span>` +
          `<span class="git-subject">${esc(c.subject)}</span>` +
          `<span class="git-hash" data-hash="${esc(c.hash)}" title="Show changes in this commit">${esc(
            c.shortHash
          )}</span>` +
          `</div>`
      )
      .join("");
    return (
      `<div class="git-header">` +
      `<div class="git-summary">` +
      `<span class="git-icon">📝</span>` +
      `<span>Updated ${esc(relTime(last.date))} by <strong>${esc(last.author)}</strong></span>` +
      `<span class="git-subject-inline">${esc(last.subject)}</span>` +
      `<button class="git-toggle" id="git-toggle" title="Toggle file history">History ▾</button>` +
      `</div>` +
      `<div class="git-history" id="git-history" hidden>${rows}</div>` +
      `</div>`
    );
  }

  buildHtml(source, webview, mermaidUri, docDir, gitInfo) {
    const body = md.render(source);
    const header = this.buildHeader(gitInfo);
    const cspSource = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline'; font-src ${cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    line-height: 1.6;
    max-width: 860px;
    margin: 0 auto;
    padding: 24px 32px 64px;
    color: var(--vscode-editor-foreground);
  }
  h1, h2 { border-bottom: 1px solid var(--vscode-panel-border, #8884); padding-bottom: .3em; }
  code {
    background: var(--vscode-textCodeBlock-background, #8882);
    padding: .15em .35em; border-radius: 4px;
    font-family: "SF Mono", Menlo, Consolas, monospace;
  }
  pre { background: var(--vscode-textCodeBlock-background, #8882); padding: 14px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  pre.mermaid { background: none; padding: 0; text-align: center; }
  blockquote { border-left: 4px solid var(--vscode-panel-border, #8884); margin: 0; padding-left: 1em; opacity: .85; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid var(--vscode-panel-border, #8884); padding: 6px 12px; }
  a { color: var(--vscode-textLink-foreground); }
  img { max-width: 100%; }

  /* git "track" header */
  .git-header {
    font-size: 12px; opacity: .85;
    margin: -8px 0 18px; padding-bottom: 8px;
    border-bottom: 1px solid var(--vscode-panel-border, #8884);
  }
  .git-summary { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .git-icon { opacity: .8; }
  .git-subject-inline { opacity: .7; font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40ch; }
  .git-repo { opacity: .55; }
  .git-hash {
    font-family: "SF Mono", Menlo, Consolas, monospace;
    opacity: .7; cursor: pointer; padding: 0 2px; border-radius: 3px;
  }
  .git-hash:hover { opacity: 1; background: var(--vscode-textCodeBlock-background, #8882); }
  .git-toggle {
    margin-left: auto; cursor: pointer; font-size: 11px;
    background: transparent; color: inherit;
    border: 1px solid var(--vscode-panel-border, #8884);
    border-radius: 4px; padding: 1px 8px;
  }
  .git-toggle:hover { background: var(--vscode-textCodeBlock-background, #8882); }
  .git-history {
    margin-top: 8px; display: flex; flex-direction: column; gap: 3px;
    max-height: 220px; overflow-y: auto; padding-right: 4px;
    border: 1px solid var(--vscode-panel-border, #8884); border-radius: 6px; padding: 6px;
  }
  .git-history[hidden] { display: none; }
  .git-row {
    display: grid; grid-template-columns: 10em 12em 1fr auto;
    gap: 12px; font-size: 11px; opacity: .85; align-items: baseline;
    cursor: pointer; padding: 2px 4px; border-radius: 4px;
  }
  .git-row:hover { opacity: 1; background: var(--vscode-list-hoverBackground, #8881); }
  .git-row .git-date { opacity: .7; }
  .git-row .git-subject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* wrapper + expand button shown on diagram hover */
  .mermaid-wrap { position: relative; display: block; text-align: center; margin: 1em 0; }
  .mermaid-wrap svg { width: 100%; max-width: 100% !important; height: auto; }
  .mermaid-wrap .expand-btn {
    position: absolute; top: 8px; right: 8px;
    opacity: 0; transition: opacity .15s, background .15s;
    width: 26px; height: 26px; padding: 0;
    display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--vscode-editor-foreground, #888) 12%, transparent);
    color: var(--vscode-editor-foreground, #ccc);
    border: none; border-radius: 5px; cursor: pointer;
    font-size: 14px; line-height: 1;
  }
  .mermaid-wrap:hover .expand-btn { opacity: .55; }
  .mermaid-wrap .expand-btn:hover { opacity: 1; background: color-mix(in srgb, var(--vscode-editor-foreground, #888) 22%, transparent); }

  /* modal fullscreen com pan/zoom */
  .mermaid-modal {
    position: fixed; inset: 0; z-index: 9999;
    background: var(--vscode-editor-background, #1e1e1e);
    overflow: hidden;
  }
  .mermaid-modal.panning { cursor: grabbing; }
  .mermaid-stage { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
  .mermaid-stage svg { max-width: none !important; height: auto; display: block; }
  .mermaid-toolbar {
    position: fixed; top: 14px; right: 14px; z-index: 10000;
    display: flex; gap: 6px;
  }
  .mermaid-toolbar button {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #fff);
    border: 1px solid var(--vscode-panel-border, #8884);
    border-radius: 6px; cursor: pointer;
    min-width: 34px; height: 30px; font-size: 15px; line-height: 1;
  }
  .mermaid-toolbar button:hover { background: var(--vscode-button-background, #0e639c); }
  .mermaid-hint {
    position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%);
    z-index: 10000; font-size: 12px; opacity: .6;
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background, #1e1e1e);
    padding: 4px 10px; border-radius: 6px;
    border: 1px solid var(--vscode-panel-border, #8884);
  }
</style>
</head>
<body>
${header}
${body}
<script src="${mermaidUri}"></script>
<script>
  const vscodeApi = acquireVsCodeApi();
  const DOC_DIR = ${JSON.stringify(docDir)};

  // Is this a local/relative link (not an in-page anchor or external scheme)?
  function isLocalHref(href) {
    return !!href && !href.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(href);
  }

  // Tag local links so right-click shows the native VSCode context menu
  // (contributed via package.json > menus > webview/context).
  function tagLinks() {
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (!isLocalHref(href)) return;
      a.dataset.vscodeContext = JSON.stringify({
        webviewSection: 'link',
        preventDefaultContextMenuItems: true,
        href: href,
        baseDir: DOC_DIR,
      });
    });
  }
  tagLinks();

  // git header: toggle history panel + copy commit hash on click
  (function wireGitHeader() {
    const toggle = document.getElementById('git-toggle');
    const history = document.getElementById('git-history');
    if (toggle && history) {
      toggle.addEventListener('click', () => {
        const hidden = history.hasAttribute('hidden');
        if (hidden) history.removeAttribute('hidden');
        else history.setAttribute('hidden', '');
        toggle.textContent = hidden ? 'History ▴' : 'History ▾';
      });
    }
    // click any commit hash (header) or history row → open the diff for it
    document.querySelectorAll('[data-hash]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation(); // hash inside a row shouldn't fire the row too
        vscodeApi.postMessage({ type: 'diff', hash: el.dataset.hash });
      });
    });
  })();

  const isDark = document.body.classList.contains('vscode-dark') ||
    document.querySelector('body')?.dataset?.vscodeThemeKind?.includes('dark');

  let modalOpen = false;

  // single-click on a link → let the extension resolve & open local/relative
  // paths through VSCode (so back/forward navigation works). External schemes
  // (http:, https:, mailto:, vscode:, …) and in-page #anchors keep default behavior.
  document.addEventListener('click', (e) => {
    if (modalOpen) return;
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!isLocalHref(href)) return; // in-page anchor or external scheme → default
    e.preventDefault();
    // Cmd (mac) / Ctrl (win/linux) + click → force a new (non-preview) tab
    const newTab = e.metaKey || e.ctrlKey;
    vscodeApi.postMessage({ type: 'open', href, newTab });
  });

  // double-click on the page (outside a diagram/link/modal) → back to the text editor
  document.addEventListener('dblclick', (e) => {
    if (modalOpen) return;
    if (e.target.closest('a')) return;
    if (e.target.closest('.mermaid-wrap')) return; // diagrams are interactive
    if (e.target.closest('.git-header')) return;    // header controls are interactive
    vscodeApi.postMessage({ type: 'edit' });
  });

  // add the expand button to each already-rendered diagram
  function decorate() {
    document.querySelectorAll('pre.mermaid[data-processed="true"]').forEach((el) => {
      if (el.parentElement.classList.contains('mermaid-wrap')) return;
      const wrap = document.createElement('div');
      wrap.className = 'mermaid-wrap';
      el.parentNode.insertBefore(wrap, el);
      wrap.appendChild(el);
      const btn = document.createElement('button');
      btn.className = 'expand-btn';
      btn.title = 'Open fullscreen (pan + zoom)';
      btn.textContent = '⛶';
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const svg = el.querySelector('svg');
        if (svg) openFullscreen(svg);
      });
      wrap.appendChild(btn);
    });
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function openFullscreen(svgEl) {
    modalOpen = true;
    const modal = document.createElement('div');
    modal.className = 'mermaid-modal';
    const stage = document.createElement('div');
    stage.className = 'mermaid-stage';
    stage.appendChild(svgEl.cloneNode(true));
    modal.appendChild(stage);

    const bar = document.createElement('div');
    bar.className = 'mermaid-toolbar';
    const mk = (label, title, fn) => {
      const b = document.createElement('button');
      b.textContent = label; b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      bar.appendChild(b);
      return b;
    };
    modal.appendChild(bar);

    const hint = document.createElement('div');
    hint.className = 'mermaid-hint';
    hint.textContent = 'Middle button (hold) to pan · scroll to zoom · Esc to close';
    modal.appendChild(hint);

    document.body.appendChild(modal);

    let scale = 1, tx = 0, ty = 0;
    const applyT = () => { stage.style.transform =
      'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; };

    function fit() {
      scale = 1; tx = 0; ty = 0; applyT();
      const svg = stage.querySelector('svg');
      const r = svg.getBoundingClientRect();
      const W = modal.clientWidth, H = modal.clientHeight;
      const pad = 60;
      scale = clamp(Math.min((W - pad) / r.width, (H - pad) / r.height), 0.1, 4);
      tx = (W - r.width * scale) / 2;
      ty = (H - r.height * scale) / 2;
      applyT();
    }

    function zoomAt(mx, my, factor) {
      const ns = clamp(scale * factor, 0.1, 12);
      tx = mx - (mx - tx) * (ns / scale);
      ty = my - (my - ty) * (ns / scale);
      scale = ns; applyT();
    }

    mk('+', 'Zoom in', () => { const r = modal.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.25); });
    mk('−', 'Zoom out', () => { const r = modal.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 0.8); });
    mk('⤢', 'Fit to screen', fit);
    mk('✕', 'Fechar (Esc)', close);

    // scroll wheel = zoom centered on the cursor
    modal.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = modal.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    // middle button (wheel) hold + drag = pan · left button stays free to select
    let dragging = false, lx = 0, ly = 0;
    modal.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      if (e.target.closest('.mermaid-toolbar')) return;
      e.preventDefault();
      dragging = true; lx = e.clientX; ly = e.clientY;
      modal.classList.add('panning');
    });
    modal.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
    window.addEventListener('mousemove', onMove);
    function onMove(e) {
      if (!dragging) return;
      tx += e.clientX - lx; ty += e.clientY - ly;
      lx = e.clientX; ly = e.clientY; applyT();
    }
    window.addEventListener('mouseup', onUp);
    function onUp() { if (dragging) { dragging = false; modal.classList.remove('panning'); } }

    function onKey(e) { if (e.key === 'Escape') close(); }
    window.addEventListener('keydown', onKey);

    function close() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
      modal.remove();
      modalOpen = false;
    }

    fit();
  }

  try {
    mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default' });
    mermaid.run({ querySelector: 'pre.mermaid' }).then(decorate).catch((e) => {
      console.error('mermaid run failed', e);
    });
  } catch (e) {
    console.error('mermaid init failed', e);
  }
</script>
</body>
</html>`;
  }
}

// Commands backing the right-click (webview/context) menu on links.
// The menu item passes the element's data-vscode-context as the first arg.
function openFromContext(ctx, columnOrOptions) {
  if (!ctx || typeof ctx.baseDir !== "string" || typeof ctx.href !== "string") return;
  const t = resolveTargetUri(ctx.baseDir, ctx.href);
  if (t) openTarget(t.uri, t.filePart, columnOrOptions);
}

// "Press Esc again to go back to preview" — a double-tap confirm while editing
// the raw text, so a stray Esc doesn't yank you out of edit mode.
//
// IMPORTANT: this only applies to docs that reached edit mode FROM our preview
// (via the webview's double-click). A .md you opened directly in the text editor
// to write is NOT armed — Esc behaves normally there.
const ESC_WINDOW_MS = 1200;
let pendingEscape = null; // { uriStr, timer, hint }
const editedFromPreview = new Set(); // uriStrings that entered edit mode via preview

// Drives the keybinding's `when` (brunosMarkdownReader.canEscapeToPreview):
// true only when the active text editor is an armed doc.
function updateEscapeContext() {
  const editor = vscode.window.activeTextEditor;
  const armed = !!(editor && editedFromPreview.has(editor.document.uri.toString()));
  vscode.commands.executeCommand("setContext", "brunosMarkdownReader.canEscapeToPreview", armed);
}

function clearPendingEscape() {
  if (!pendingEscape) return;
  clearTimeout(pendingEscape.timer);
  if (pendingEscape.hint) pendingEscape.hint.dispose();
  pendingEscape = null;
}

function escapeToPreview() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const uri = editor.document.uri;
  const uriStr = uri.toString();

  // only armed if this edit session originated from our preview
  if (!editedFromPreview.has(uriStr)) return;

  // second Esc on the same file within the window → back to the reader
  if (pendingEscape && pendingEscape.uriStr === uriStr) {
    clearPendingEscape();
    editedFromPreview.delete(uriStr);
    updateEscapeContext();
    vscode.commands.executeCommand("vscode.openWith", uri, "brunosMarkdownReader.editor");
    return;
  }

  // first Esc → flash a hint and arm the window
  clearPendingEscape();
  const hint = vscode.window.setStatusBarMessage(
    "$(eye) Press Esc again to return to preview",
    ESC_WINDOW_MS
  );
  const timer = setTimeout(() => {
    pendingEscape = null;
  }, ESC_WINDOW_MS);
  pendingEscape = { uriStr, timer, hint };
}

function activate(context) {
  const provider = new MarkdownEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider("brunosMarkdownReader.editor", provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand("brunosMarkdownReader.openLink", (ctx) =>
      openFromContext(ctx, undefined)
    ),
    vscode.commands.registerCommand("brunosMarkdownReader.openLinkToSide", (ctx) =>
      openFromContext(ctx, vscode.ViewColumn.Beside)
    ),
    vscode.commands.registerCommand("brunosMarkdownReader.copyLinkPath", (ctx) => {
      if (!ctx || typeof ctx.baseDir !== "string" || typeof ctx.href !== "string") return;
      const t = resolveTargetUri(ctx.baseDir, ctx.href);
      if (t) vscode.env.clipboard.writeText(t.uri.fsPath);
    }),
    vscode.commands.registerCommand("brunosMarkdownReader.escapeToPreview", escapeToPreview),
    // keep the keybinding's context in sync with the active editor
    vscode.window.onDidChangeActiveTextEditor(() => updateEscapeContext()),
    // a closed text doc is no longer an armed edit session
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (editedFromPreview.delete(doc.uri.toString())) updateEscapeContext();
    })
  );
  updateEscapeContext(); // default to disarmed
}

function deactivate() {}

module.exports = { activate, deactivate };
