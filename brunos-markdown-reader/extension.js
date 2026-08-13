const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const MarkdownIt = require("markdown-it");
const { resolveTarget, relTime, parseGitLog, merge3, resolveImgSrc } = require("./lib/util");
const { tableCss, editTableCss, FOLD_CSS, EDIT_FOLD_CSS, EDIT_IMG_CSS, RESIZE_CSS, TABLE_OVERFLOW_MODES, THEMES, themeCss, isDarkTheme } = require("./lib/css");

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

function getConfig() {
  const c = vscode.workspace.getConfiguration("brunosMarkdownReader");
  return {
    showGitHeader: c.get("showGitHeader", true),
    historyExpanded: c.get("historyExpanded", false),
    doubleEscToPreview: c.get("doubleEscToPreview", true),
    editMode: c.get("editMode", false),
    collapsibleHeadings: c.get("collapsibleHeadings", true),
    resizableColumns: c.get("resizableColumns", true),
    tableOverflow: TABLE_OVERFLOW_MODES.includes(c.get("tableOverflow", "center"))
      ? c.get("tableOverflow", "center")
      : "center",
    // 0 disables the cap. Anything smaller than a cap that could hold a word is
    // noise, so a positive value is floored rather than trusted.
    maxColumnWidth: Math.max(0, Math.round(Number(c.get("maxColumnWidth", 420)) || 0)),
    // "auto" follows VSCode, which follows the system theme. An unknown value
    // falls back to auto rather than to a hardcoded side.
    theme: THEMES.includes(c.get("theme", "auto")) ? c.get("theme", "auto") : "auto",
  };
}

const MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=brunotrivellato.brunos-markdown-reader";

// straight from the manifest, so the menu can never drift from the real version
const { version: VERSION } = require("./package.json");

// Footer of the kebab menu. buildMenu is shared by both views, so the styles
// are too, unlike the rest of the menu CSS which each view carries itself.
const MENU_FOOT_CSS = `
  .bmr-menu-foot {
    display: flex; align-items: center; gap: 8px;
    margin-top: 4px; padding: 6px 8px 2px;
    border-top: 1px solid var(--vscode-panel-border, #8884);
    font-size: 11px; opacity: .6;
    color: var(--vscode-editor-foreground);
  }
  .bmr-menu-name { flex: 1; min-width: 0; white-space: nowrap; }
  .bmr-menu-ver { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 10px; opacity: .8; }
  .bmr-menu-info {
    flex: none; width: 17px; height: 17px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 600; font-style: italic;
    text-decoration: none; cursor: pointer;
    color: var(--vscode-editor-foreground);
    border: 1px solid var(--vscode-panel-border, #8886);
  }
  .bmr-menu-info:hover {
    opacity: 1;
    background: var(--vscode-list-hoverBackground, #8881);
    border-color: var(--vscode-focusBorder, #8888);
  }
  /* A number row, for the settings a checkbox cannot express. The label takes
     the slack so every input in the menu lines up on the right edge. */
  .bmr-menu-num { cursor: default; }
  .bmr-menu-num > span { flex: 1; min-width: 0; }
  .bmr-menu-num input {
    flex: none; width: 56px; cursor: text;
    padding: 1px 4px; font: inherit; font-size: 12px;
    color: var(--vscode-input-foreground, inherit);
    background: var(--vscode-input-background, #8882);
    border: 1px solid var(--vscode-input-border, #8886);
    border-radius: 3px;
  }
  .bmr-menu-num input:focus { outline: 1px solid var(--vscode-focusBorder, #8888); }
  /* A select row, for a setting with more than two values. Shares the number
     row's geometry so the controls stay in one column down the right edge. */
  .bmr-menu-sel select {
    flex: none; width: 84px; cursor: pointer;
    padding: 1px 4px; font: inherit; font-size: 12px;
    color: var(--vscode-input-foreground, inherit);
    background: var(--vscode-input-background, #8882);
    border: 1px solid var(--vscode-input-border, #8886);
    border-radius: 3px;
  }
  .bmr-menu-sel select:focus { outline: 1px solid var(--vscode-focusBorder, #8888); }`;

// ---- link hover tooltip -----------------------------------------------------
// Shared by the reader and edit mode. They locate links differently, so each
// passes its own `linkAt(target)`, but the tooltip itself behaves the same.

const LINK_TOOLTIP_CSS = `
  .bmr-tip {
    position: fixed; z-index: 9998;
    max-width: min(70vw, 640px);
    padding: 6px 9px; border-radius: 6px;
    font-size: 11.5px; line-height: 1.45;
    font-family: "SF Mono", Menlo, Consolas, monospace;
    color: var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground, #ccc));
    background: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background, #252526));
    border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-panel-border, #8884));
    box-shadow: 0 3px 12px #0005;
    word-break: break-all;
    pointer-events: none; /* never let the tooltip eat a hover or a click */
    opacity: 0; transition: opacity .12s;
  }
  .bmr-tip[hidden] { display: none; }
  .bmr-tip--on { opacity: 1; }
  .bmr-tip-missing { color: var(--vscode-editorError-foreground, #f14c4c); }`;

// ---- manual column widths ---------------------------------------------------
// Shared by both views. `rootFor` is the only difference between them: the
// reader hands back the body, edit mode the Vditor content element.
//
// Widths are inline styles on the table and its header cells. That is verified
// inert: Lute rebuilds the markdown from cell contents and ignores the style
// attribute, through both vditorIRDOM2Md and SpinVditorIRDOM, so a resized
// table is never a changed file. Tests cover it. Spin does wipe the styles as
// you type, which is why the widths are kept here and reapplied after input.
//
// Only the dragged column changes size, so the table grows or shrinks with it.
// Shrinking is the useful direction: a column narrower than its content makes
// the cells wrap instead of the table running off the side.
const RESIZE_JS = `
  function installColumnResize(rootFor) {
    const MIN = 44;               // narrower than this and a column is unusable
    const widths = new Map();     // table index -> px per column, null = untouched
    const totals = new Map();     // table index -> px for the table as a whole
    let handles = [];             // { btn, table, ti, ci }

    const tablesOf = () => {
      const r = rootFor();
      return r ? Array.prototype.slice.call(r.querySelectorAll('table')) : [];
    };

    // The header row drives the columns. Fall back to the first row for a table
    // written without one.
    function headOf(t) {
      const row = t.querySelector('thead tr') || t.querySelector('tr');
      return row ? Array.prototype.slice.call(row.children) : [];
    }

    // Only columns you actually dragged get a width; the rest stay null and keep
    // sizing themselves. Pinning every column and the table total looks tidier
    // but behaves badly: a column cannot go below its longest word, so the total
    // no longer adds up and the browser takes the difference out of the
    // neighbours, shrinking columns nobody touched.
    function applyTo(t, ti) {
      const w = widths.get(ti);
      if (!w) return;
      const cells = headOf(t);
      // the document changed shape under us, so the remembered widths are junk
      if (cells.length !== w.length) { widths.delete(ti); return; }
      // A resized table stops sizing to its content. While it is max-content it
      // is by definition wide enough for nothing to wrap, so narrowing a column
      // only narrows the table and the text still runs on one line. The total
      // follows the drag instead, which is what lets cells actually wrap.
      const total = totals.get(ti);
      if (total != null) {
        t.style.width = total + 'px';
        t.style.maxWidth = 'none';
        // The centre breakout offsets the table by margin-left:50% and pulls it
        // back with a transform, which eats half the room it has to grow into.
        // A table sized by hand gives that up and sits on the text column.
        // margin-right goes back to 0 with it: that negative margin exists only
        // to cancel the breakout's phantom scroll, and left in place it would
        // stop the pane scrolling to a table dragged wider than the pane.
        t.style.marginLeft = '0';
        t.style.marginRight = '0';
        t.style.transform = 'none';
      }

      // Every cell in the column, not just the header. Auto table layout takes
      // a column's preferred width from the widest cell in it, so styling the
      // header alone leaves the body cells free to keep pushing it wider.
      const rows = t.querySelectorAll('tr');
      for (let i = 0; i < w.length; i++) {
        if (w[i] == null) continue;
        const px = w[i] + 'px';
        cells[i].style.width = px;
        for (const row of rows) {
          const cell = row.children[i];
          if (cell) { cell.style.width = px; cell.style.maxWidth = px; }
        }
      }
    }

    function place() {
      const r = rootFor();
      if (!r) return;
      const box = r.getBoundingClientRect();
      const top = Math.max(0, box.top);
      const bottom = Math.min(window.innerHeight, box.bottom);
      for (const h of handles) {
        const cells = headOf(h.table);
        const cell = cells[h.ci];
        if (!cell) { h.btn.hidden = true; continue; }
        const c = cell.getBoundingClientRect();
        const t = h.table.getBoundingClientRect();
        // hide once the table leaves the viewport, or once this particular edge
        // scrolls out of the table's own horizontal scroller
        const visible = t.bottom > top && t.top < bottom &&
          c.right > t.left - 1 && c.right < t.right + 1;
        if (!visible) { h.btn.hidden = true; continue; }
        h.btn.hidden = false;
        h.btn.style.left = c.right + 'px';
        h.btn.style.top = Math.max(t.top, top) + 'px';
        h.btn.style.height = Math.max(0, Math.min(t.bottom, bottom) - Math.max(t.top, top)) + 'px';
      }
    }

    function startDrag(e, h) {
      e.preventDefault();
      e.stopPropagation();
      const cells = headOf(h.table);
      if (!widths.has(h.ti)) widths.set(h.ti, cells.map(() => null));
      const start = widths.get(h.ti).slice();
      const from = Math.round(cells[h.ci].getBoundingClientRect().width);
      const total0 = Math.round(h.table.getBoundingClientRect().width);
      const floor = MIN * cells.length;
      const x0 = e.clientX;
      document.body.classList.add('bmr-colh-dragging');
      h.btn.classList.add('bmr-colh-live');

      const move = (ev) => {
        const dx = ev.clientX - x0;
        const next = start.slice();
        next[h.ci] = Math.max(MIN, from + dx);
        widths.set(h.ti, next);
        // only this column changes, so the table moves by the same amount
        totals.set(h.ti, Math.max(floor, total0 + dx));
        applyTo(h.table, h.ti);
        place();
      };
      const up = () => {
        document.body.classList.remove('bmr-colh-dragging');
        h.btn.classList.remove('bmr-colh-live');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        // A column cannot go below its longest unbreakable word, so the browser
        // may not have given us what we asked for. Adopt what it settled on for
        // this column, else the handle drifts off the edge it is meant to sit
        // on. The untouched columns stay null and keep sizing themselves.
        const settled = widths.get(h.ti).slice();
        const now = headOf(h.table)[h.ci];
        if (now) settled[h.ci] = Math.round(now.getBoundingClientRect().width);
        widths.set(h.ti, settled);
        totals.set(h.ti, Math.round(h.table.getBoundingClientRect().width));
        applyTo(h.table, h.ti);
        place();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    function rebuild() {
      for (const h of handles) h.btn.remove();
      handles = [];
      const list = tablesOf();
      for (let ti = 0; ti < list.length; ti++) {
        const table = list[ti];
        applyTo(table, ti);
        const cells = headOf(table);
        // the last edge has no column to its right, so there is nothing to drag
        for (let ci = 0; ci < cells.length - 1; ci++) {
          const btn = document.createElement('div');
          btn.className = 'bmr-colh';
          btn.title = 'Drag to resize this column';
          const h = { btn: btn, table: table, ti: ti, ci: ci };
          btn.addEventListener('pointerdown', (e) => startDrag(e, h));
          document.body.appendChild(btn);
          handles.push(h);
        }
      }
      place();
    }

    // Reveal only the handles of the table under the pointer, so a page of
    // tables does not light up all at once.
    document.addEventListener('mousemove', (e) => {
      const over = e.target && e.target.closest ? e.target.closest('table') : null;
      for (const h of handles) {
        h.btn.classList.toggle('bmr-colh-near', !!over && over === h.table);
      }
    });
    document.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);

    // Widths only, no handle churn. Spin wipes the inline widths on every
    // keystroke, and a resized table that snaps back to its content width and
    // then in again is the same flicker the pictures caused, so edit mode calls
    // this in the keystroke's own tick and leaves the handles to the debounce.
    rebuild.reapply = function () {
      const list = tablesOf();
      for (let ti = 0; ti < list.length; ti++) applyTo(list[ti], ti);
    };
    return rebuild;
  }
`;

const LINK_TOOLTIP_JS = `
  // Show a link's resolved absolute path on hover. The extension does the
  // resolving (it owns the path logic), we cache each answer per href.
  function installLinkTooltip(linkAt) {
    const tip = document.createElement('div');
    tip.className = 'bmr-tip';
    tip.hidden = true;
    document.body.appendChild(tip);

    const resolved = new Map(); // href -> { path, missing }
    let hoverHref = null, timer = null, mx = 0, my = 0;

    function hide() {
      if (timer) { clearTimeout(timer); timer = null; }
      hoverHref = null;
      tip.classList.remove('bmr-tip--on');
      tip.hidden = true;
    }

    // measure first, then keep the box inside the viewport
    function place() {
      tip.style.left = '0px';
      tip.style.top = '0px';
      const r = tip.getBoundingClientRect();
      const pad = 10;
      let left = mx + 14, top = my + 20;
      if (left + r.width > window.innerWidth - pad) left = window.innerWidth - pad - r.width;
      if (top + r.height > window.innerHeight - pad) top = my - r.height - 14;
      tip.style.left = Math.max(pad, left) + 'px';
      tip.style.top = Math.max(pad, top) + 'px';
    }

    function paint(href) {
      if (href !== hoverHref) return; // pointer moved on while we waited
      const info = resolved.get(href);
      if (!info || !info.path) return;
      tip.textContent = info.path;
      if (info.missing) {
        const tag = document.createElement('span');
        tag.className = 'bmr-tip-missing';
        tag.textContent = '  (not found)';
        tip.appendChild(tag);
      }
      tip.hidden = false;
      place();
      tip.classList.add('bmr-tip--on');
    }

    document.addEventListener('mousemove', (e) => {
      mx = e.clientX; my = e.clientY;
      const link = linkAt(e.target);
      const href = link ? link.href : null;
      if (href === hoverHref) {
        if (href && !tip.hidden) place(); // same link, just follow the cursor
        return;
      }
      hide();
      if (!href) return;
      hoverHref = href;
      if (isLocalHref(href)) {
        if (!resolved.has(href)) vscodeApi.postMessage({ type: 'resolveLink', href });
      } else {
        resolved.set(href, { path: href, missing: false }); // external URL, as-is
      }
      timer = setTimeout(() => { timer = null; paint(href); }, 250);
    });

    document.addEventListener('mouseleave', hide);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (!msg || msg.type !== 'linkPath' || typeof msg.href !== 'string') return;
      resolved.set(msg.href, { path: msg.path, missing: !!msg.missing });
      if (!timer) paint(msg.href); // the hover delay already elapsed
    });
  }`;

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
    // Pictures live next to the document, so the document's folder has to be a
    // permitted root or the webview refuses to load them. Naming any root at all
    // replaces the default (the extension folder), so that has to be repeated
    // here or the vendored Vditor and mermaid assets stop loading.
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        vscode.Uri.file(path.dirname(document.uri.fsPath)),
      ],
    };

    const mermaidUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "mermaid.min.js")
    );
    // SPIKE (edit mode): the folder that CONTAINS dist/. Vditor resolves every
    // sub-asset as `${cdn}/dist/...`, so this points it at the vendored copy.
    const vditorBase = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "vditor")
    );

    const docDir = path.dirname(document.uri.fsPath);
    // Relative image paths are written relative to the document, but the webview
    // resolves them against vscode-webview://, where they mean nothing. This is
    // the same folder as a URI the webview will actually serve, so a relative
    // src can be joined onto it.
    const docBase = webview.asWebviewUri(vscode.Uri.file(docDir)).toString();
    // set while we push Vditor's markdown back into the TextDocument, so the
    // resulting onDidChangeTextDocument doesn't re-render (and kill Vditor).
    let applyingFromWebview = false;
    // git info changes only on commit, not on unsaved edits → fetch once, cache,
    // and reuse across re-renders. Header stays hidden until it resolves.
    let gitInfo = null;
    const render = () => {
      webview.html = this.buildHtml(
        document.getText(),
        webview,
        mermaidUri,
        vditorBase,
        docDir,
        docBase,
        gitInfo,
        getConfig()
      );
    };

    render();
    getGitInfo(document.uri.fsPath).then((info) => {
      if (!info) return;
      gitInfo = info;
      const cfg = getConfig();
      if (!cfg.editMode) {
        render();
        return;
      }
      // edit mode: patch the header into the live page. A re-render here would
      // throw away the Vditor instance (and the cursor) a second after opening.
      webview.postMessage({
        type: "gitHeader",
        html: cfg.showGitHeader ? this.buildHeader(gitInfo, cfg.historyExpanded) : "",
      });
    });

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      // In edit mode Vditor owns the content: our own round-trip edit (and any
      // keystroke) must NOT rebuild the webview, or we'd lose the instance and
      // the cursor. Only a change of the editMode setting re-renders (cfgSub).
      if (applyingFromWebview || getConfig().editMode) return;
      render();
    });

    const cfgSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("brunosMarkdownReader")) render();
    });

    // double-click on the page → reopen the file in the text editor (edit mode)
    const msgSub = webview.onDidReceiveMessage((msg) => {
      if (!msg) return;
      if (msg.type === "edit") {
        // arm the double-Esc-to-preview shortcut for this doc only (if enabled)
        if (getConfig().doubleEscToPreview) {
          editedFromPreview.add(document.uri.toString());
        }
        vscode.commands
          .executeCommand("vscode.openWith", document.uri, "default")
          .then(updateEscapeContext);
        return;
      }
      // kebab menu → persist a setting (re-render happens via config change)
      if (msg.type === "setConfig" && typeof msg.key === "string") {
        vscode.workspace
          .getConfiguration("brunosMarkdownReader")
          .update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
        return;
      }
      // SPIKE (edit mode): Vditor sends back the whole markdown, but that text
      // is Lute reprinting the parse tree, so it has lost the file's hard
      // breaks and table padding everywhere, not just where the user typed.
      // Merge over msg.baseline (Lute's view of the file when the editor
      // opened) so only genuinely edited lines move. See merge3 in lib/util.
      if (msg.type === "save" && typeof msg.text === "string") {
        const current = document.getText();
        const merged = typeof msg.baseline === "string"
          ? merge3(msg.baseline, current, msg.text)
          : msg.text;
        if (merged === current) return;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(document.positionAt(0), document.positionAt(current.length)),
          merged
        );
        applyingFromWebview = true;
        const done = () => {
          applyingFromWebview = false;
        };
        vscode.workspace.applyEdit(edit).then(done, done);
        return;
      }
      // external link from edit mode (see openHref) → let VSCode open it
      if (msg.type === "openExternal" && typeof msg.href === "string") {
        vscode.env.openExternal(vscode.Uri.parse(msg.href, true)).then(undefined, (err) => {
          vscode.window.showErrorMessage(
            `Could not open link: ${msg.href} (${err && err.message ? err.message : err})`
          );
        });
        return;
      }
      // hover on a link → hand back the resolved absolute path for the tooltip,
      // plus whether the file is actually there (handy for spotting link rot)
      if (msg.type === "resolveLink" && typeof msg.href === "string") {
        const t = resolveTarget(docDir, msg.href);
        let display = "";
        let missing = false;
        if (t) {
          display = t.filePath + (t.fragment ? `#${t.fragment}` : "");
          missing = !fs.existsSync(t.filePath);
        }
        webview.postMessage({ type: "linkPath", href: msg.href, path: display, missing });
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
      cfgSub.dispose();
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

  buildMenu(config) {
    const cb = (key, label, checked) =>
      `<label class="bmr-menu-item"><input type="checkbox" data-key="${key}"${
        checked ? " checked" : ""
      }><span>${label}</span></label>`;
    return (
      `<button class="bmr-menu-btn" id="bmr-menu-btn" title="Options">⋯</button>` +
      `<div class="bmr-menu" id="bmr-menu" hidden>` +
      cb("showGitHeader", "Show git header", config.showGitHeader) +
      cb("historyExpanded", "History expanded by default", config.historyExpanded) +
      cb("doubleEscToPreview", "Double-Esc back to preview", config.doubleEscToPreview) +
      cb("collapsibleHeadings", "Collapsible headings (reader)", config.collapsibleHeadings) +
      cb("resizableColumns", "Drag to resize table columns", config.resizableColumns) +
      cb("editMode", "Notion-like experience (beta)", config.editMode) +
      // not a checkbox: three-state would be a lie, so flip between the two modes
      `<label class="bmr-menu-item"><input type="checkbox" data-key="tableOverflow" data-on="center" data-off="left"${
        config.tableOverflow === "center" ? " checked" : ""
      }><span>Wide tables grow from centre</span></label>` +
      // not a checkbox either: this one is a pixel count. 0 turns the cap off,
      // which is why the row reads as a width and not as an on/off.
      `<label class="bmr-menu-item bmr-menu-num" title="How wide a table column may get before its text wraps. 0 turns the cap off.">` +
      `<span>Max column width</span>` +
      `<input type="number" data-key="maxColumnWidth" min="0" step="20" value="${config.maxColumnWidth}">` +
      `</label>` +
      // three values, so neither a checkbox nor a number: Auto follows VSCode,
      // the other two force a palette whatever VSCode is set to
      `<label class="bmr-menu-item bmr-menu-sel" title="Auto follows VSCode, which follows your system theme.">` +
      `<span>Theme</span>` +
      `<select data-key="theme">` +
      THEMES.map(
        (t) =>
          `<option value="${t}"${config.theme === t ? " selected" : ""}>${
            t.charAt(0).toUpperCase() + t.slice(1)
          }</option>`
      ).join("") +
      `</select>` +
      `</label>` +
      // an external https anchor: webviews hand these to the browser themselves,
      // and our click handlers deliberately ignore non-local hrefs
      `<div class="bmr-menu-foot">` +
      `<span class="bmr-menu-name">Bruno's Markdown Reader <span class="bmr-menu-ver">v${VERSION}</span></span>` +
      `<a class="bmr-menu-info" href="${MARKETPLACE_URL}" title="About this extension">i</a>` +
      `</div>` +
      `</div>`
    );
  }

  buildHeader(git, expanded) {
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
      `<button class="git-toggle" id="git-toggle" title="Toggle file history">History ${
        expanded ? "▴" : "▾"
      }</button>` +
      `</div>` +
      `<div class="git-history" id="git-history"${expanded ? "" : " hidden"}>${rows}</div>` +
      `</div>`
    );
  }

  // SPIKE: experimental instant-render editor (Vditor "ir" mode). Fully
  // self-contained so the reader below stays untouched when editMode is off.
  buildEditHtml(source, webview, vditorBase, docDir, docBase, gitInfo, config) {
    const menu = this.buildMenu(config);
    const header = config.showGitHeader ? this.buildHeader(gitInfo, config.historyExpanded) : "";
    const cspSource = webview.cspSource;
    // no trailing slash: Vditor concatenates "/dist/..." onto this
    const cdn = vditorBase.toString().replace(/\/+$/, "");
    // CSP, relative to the reader's, is relaxed for the vendored Vditor:
    //  'unsafe-eval'        → mermaid/markmap bundled with Vditor use new Function()
    //  script-src blob:     → the graphviz renderer runs viz.js from a Blob worker
    //  worker-src blob:     → same Blob worker
    //  font-src data:       → katex ships base64 @font-face fallbacks
    //  img-src data: blob:  → emoji sprites + rendered diagram/image previews
    //  connect-src          → sub-asset fetches (katex css, mathjax, viz.js wasm)
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${cspSource} https: data: blob:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline' 'unsafe-eval' blob:; font-src ${cspSource} data:; worker-src ${cspSource} blob:; child-src blob:; connect-src ${cspSource} blob: data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${cdn}/dist/index.css">
<style>
  /* first, so a forced theme's palette is in place before anything reads it */
${themeCss(config.theme)}
  html, body { height: 100%; margin: 0; }
  /* our header on top, the editor taking whatever is left */
  body {
    padding: 0; color: var(--vscode-editor-foreground);
    display: flex; flex-direction: column; height: 100vh; overflow: hidden;
  }
  #bmr-head { flex: none; padding: 10px 16px 0; }
  #bmr-vditor { flex: 1 1 0; min-height: 0; border: none; }
${editTableCss(config.tableOverflow, config.maxColumnWidth)}
${EDIT_IMG_CSS}
${config.resizableColumns ? RESIZE_CSS : ""}
${config.collapsibleHeadings ? EDIT_FOLD_CSS : ""}

  /* Vditor ships .vditor-reset at 16px, noticeably bigger than the reader.
     Scale it down and borrow the reader's font stack so both views match.
     Headings and code are em/%-relative, so they follow along. Our <style>
     comes after Vditor's <link>, so these win. */
  .vditor-reset {
    font-size: 14px;
    line-height: 1.6;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }

  /* Vditor paints the editing surface #fafbfc once it has focus, so clicking
     the page turned it grey. Follow VSCode's editor background instead, which
     keeps the reader's white in a light theme and works in dark too. */
  .vditor, .vditor--dark { --textarea-background-color: var(--vscode-editor-background, #fff); }

  /* Scroll past the last line, so the end of a file can sit mid screen instead
     of being stuck at the bottom edge. !important on purpose: Vditor writes an
     inline "padding: 10px Xpx" shorthand on this element and recomputes it on
     resize, which would otherwise reset our padding-bottom every time. */
  .vditor-ir pre.vditor-reset { padding-bottom: 50vh !important; }

  /* Vditor labels every heading with a grey "H1".."H6" in the left gutter.
     Drop it, the heading size already says the level. content:none removes the
     pseudo-element outright, so its -29px gutter goes away with it. We leave
     the link-ref/footnote block labels alone, those actually tell you something. */
  .vditor-ir .vditor-reset > h1:before,
  .vditor-ir .vditor-reset > h2:before,
  .vditor-ir .vditor-reset > h3:before,
  .vditor-ir .vditor-reset > h4:before,
  .vditor-ir .vditor-reset > h5:before,
  .vditor-ir .vditor-reset > h6:before { content: none; }

  /* Vditor's toolbar lives under our "Formatting" button, hidden by default.
     Items float, so block is the display value to restore. */
  .vditor-toolbar { display: none; }
  body.bmr-fmt .vditor-toolbar { display: block; }

  /* our header: git info on the left, the formatting toggle pinned right */
  .bmr-head-row { display: flex; align-items: flex-start; gap: 10px; }
  .bmr-head-git { flex: 1; min-width: 0; }
  .bmr-fmt-btn {
    flex: none; cursor: pointer; font-size: 11px;
    display: flex; align-items: center; gap: 5px;
    background: transparent; color: inherit;
    border: 1px solid var(--vscode-panel-border, #8884);
    border-radius: 4px; padding: 2px 8px; margin-right: 34px;
    opacity: .7; transition: opacity .15s, background .15s;
  }
  .bmr-fmt-btn:hover { opacity: 1; background: var(--vscode-textCodeBlock-background, #8882); }
  .bmr-fmt-btn[aria-pressed="true"] {
    opacity: 1;
    background: var(--vscode-textCodeBlock-background, #8882);
    border-color: var(--vscode-focusBorder, #8886);
  }

  /* git "track" header (same look as the reader) */
  .git-header {
    font-size: 12px; opacity: .85;
    margin: 0 0 8px; padding-bottom: 8px;
    border-bottom: 1px solid var(--vscode-panel-border, #8884);
  }
  .git-summary { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .git-icon { opacity: .8; }
  .git-subject-inline { opacity: .7; font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40ch; }
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

  /* options kebab menu, above Vditor's toolbar (z-index 1) and fullscreen (90) */
  .bmr-menu-btn {
    position: fixed; top: 8px; right: 10px; z-index: 200;
    width: 26px; height: 26px; padding: 0; border-radius: 6px; cursor: pointer;
    font-size: 15px; line-height: 1;
    display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--vscode-editor-foreground, #888) 10%, transparent);
    color: var(--vscode-editor-foreground, #ccc);
    border: 1px solid var(--vscode-panel-border, #8884);
    opacity: .45; transition: opacity .15s;
  }
  .bmr-menu-btn:hover { opacity: 1; }
  .bmr-menu {
    position: fixed; top: 40px; right: 10px; z-index: 200;
    min-width: 230px; padding: 6px;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background, #252526));
    border: 1px solid var(--vscode-panel-border, #8884); border-radius: 8px;
    box-shadow: 0 4px 16px #0006;
    display: flex; flex-direction: column; gap: 2px;
  }
  .bmr-menu[hidden] { display: none; }
  .bmr-menu-item {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; padding: 5px 8px; border-radius: 5px; cursor: pointer;
    color: var(--vscode-editor-foreground);
  }
  .bmr-menu-item:hover { background: var(--vscode-list-hoverBackground, #8881); }
  .bmr-menu-item input { cursor: pointer; margin: 0; }
${MENU_FOOT_CSS}
${LINK_TOOLTIP_CSS}
</style>
</head>
<body>
${menu}
<div id="bmr-head">
  <div class="bmr-head-row">
    <div class="bmr-head-git" id="bmr-git">${header}</div>
    ${config.collapsibleHeadings
      ? `<button class="bmr-fmt-btn" id="bmr-foldall" title="Collapse every section"><span>\u25BE</span><span>All</span></button>`
      : ""}
    <button class="bmr-fmt-btn" id="bmr-fmt-btn" aria-pressed="false"
      title="Show/hide the formatting toolbar"><span>¶</span><span>Formatting</span></button>
  </div>
</div>
<div id="bmr-vditor"></div>
<!-- Icon sprite, pre-loaded on purpose: Vditor's own icon loader uses a
     SYNCHRONOUS XHR, which fails behind the webview's resource service worker,
     so the toolbar came up as blank buttons. Both of its loaders bail out when
     an element with this id already exists, so ours wins. Must sit in <body>:
     the sprite injects itself via document.body.insertAdjacentHTML. -->
<script id="vditorIconScript" src="${cdn}/dist/js/icons/material.js"></script>
<script src="${cdn}/dist/index.min.js"></script>
<script>
  const vscodeApi = acquireVsCodeApi();
  const CDN = ${JSON.stringify(cdn)};
  const INITIAL = ${JSON.stringify(source)};
  const DOC_DIR = ${JSON.stringify(docDir)};
  const DOC_BASE = ${JSON.stringify(docBase)};
  // null means "auto": ask VSCode. A forced theme has already repainted the
  // palette in CSS, so this is what tells Vditor, hljs and mermaid to match it.
  const FORCED_DARK = ${JSON.stringify(isDarkTheme(config.theme))};
  const isDark = FORCED_DARK !== null ? FORCED_DARK
    : document.body.classList.contains('vscode-dark') ||
      document.body.classList.contains('vscode-high-contrast');

  let ready = false;
  let saveTimer = null;
  // Last text we know the document holds, as Vditor serializes it. getValue()
  // is Lute's re-render of the DOM, not the file, so it normalizes hard breaks
  // and table padding. Writing it back when nothing was edited rewrites the
  // file just for clicking around, so flush() compares against this first.
  let lastSaved = null;

  // ---- link navigation (same deal as the reader) ---------------------------

  // Is this a local/relative link (not an in-page anchor or external scheme)?
  function isLocalHref(href) {
    return !!href && !href.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(href);
  }

  // Vditor hands its link.click callback two different shapes: an <a> in the
  // preview panel, but in IR mode a collapsed link is a <span data-type="a">
  // and we get its .vditor-ir__marker--link child, whose text IS the URL.
  function hrefOfVditorLink(el) {
    if (!el) return '';
    if (el.tagName === 'A') return el.getAttribute('href') || '';
    return (el.textContent || '').trim();
  }

  // Same walk, but starting from an arbitrary event target (for right-click).
  function linkAt(target) {
    if (!target || !target.closest) return null;
    const a = target.closest('a[href]');
    if (a) return { el: a, href: a.getAttribute('href') || '' };
    const node = target.closest('[data-type="a"]');
    if (!node) return null;
    const marker = node.querySelector(':scope > .vditor-ir__marker--link');
    return marker ? { el: node, href: (marker.textContent || '').trim() } : null;
  }

  function openHref(href, newTab) {
    if (!href || href.startsWith('#')) return; // in-page anchor: nothing to do
    if (isLocalHref(href)) {
      vscodeApi.postMessage({ type: 'open', href, newTab: !!newTab });
    } else {
      // window.open is a no-op inside a webview, and IR links are spans rather
      // than real <a>, so there is no default navigation to fall back on.
      // Hand http(s)/mailto/etc to the extension and let VSCode open it.
      vscodeApi.postMessage({ type: 'openExternal', href });
    }
  }

${LINK_TOOLTIP_JS}
  installLinkTooltip(linkAt);

  // link.click gets no event, so remember the modifiers from the capture phase,
  // which always runs before Vditor's own listener on the content element.
  let newTabClick = false;
  document.addEventListener('click', (e) => {
    newTabClick = e.metaKey || e.ctrlKey;
  }, true);

  // Right-click: tag the element so VSCode shows our webview/context menu
  // (Open, Open to the Side, Copy Link Path). The reader can tag every link up
  // front, but here the DOM is a live contenteditable, so we tag one element on
  // mousedown (which always precedes contextmenu) and drop the attribute again
  // before anything reads the document back, keeping it out of getValue().
  let taggedLink = null;
  function clearLinkTag() {
    if (!taggedLink) return;
    taggedLink.removeAttribute('data-vscode-context');
    taggedLink = null;
  }
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
    clearLinkTag();
    const link = linkAt(e.target);
    if (!link || !isLocalHref(link.href)) return;
    link.el.setAttribute('data-vscode-context', JSON.stringify({
      webviewSection: 'link',
      preventDefaultContextMenuItems: true,
      href: link.href,
      baseDir: DOC_DIR,
    }));
    taggedLink = link.el;
  }, true);

  // push the current markdown to the extension (which applies a WorkspaceEdit)
  function flush(editor) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!ready || !editor) return;
    clearLinkTag();
    const text = editor.getValue();
    if (text === lastSaved) return; // nothing actually changed, leave the file alone
    // lastSaved is also the merge ancestor: the write-back never touches the
    // DOM, so it stays exactly what getValue() returned for the saved file.
    const baseline = lastSaved;
    lastSaved = text;
    vscodeApi.postMessage({ type: 'save', text, baseline });
  }

  // "Formatting" button: reveals Vditor's own toolbar under our header
  (function wireFormatting() {
    const btn = document.getElementById('bmr-fmt-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const on = document.body.classList.toggle('bmr-fmt');
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  })();

  // git header: toggle the history panel, click a commit to open its diff.
  // Re-run after the header is injected, since it arrives async.
  function wireGitHeader() {
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
    document.querySelectorAll('#bmr-git [data-hash]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        vscodeApi.postMessage({ type: 'diff', hash: el.dataset.hash });
      });
    });
  }
  wireGitHeader();

  // git info resolves after the first paint. Patch the header in place instead
  // of re-rendering, which would throw away the editor and the cursor.
  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || msg.type !== 'gitHeader') return;
    const slot = document.getElementById('bmr-git');
    if (!slot) return;
    slot.innerHTML = msg.html;
    wireGitHeader();
  });

  // options kebab menu: toggle popover, persist checkbox changes. Flush first,
  // since toggling a setting re-renders the webview and would drop a pending save.
  function wireMenu(getEditor) {
    const btn = document.getElementById('bmr-menu-btn');
    const menu = document.getElementById('bmr-menu');
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.hasAttribute('hidden')) menu.removeAttribute('hidden');
      else menu.setAttribute('hidden', '');
    });
    document.addEventListener('click', (e) => {
      if (!menu.hasAttribute('hidden') && !menu.contains(e.target) && e.target !== btn) {
        menu.setAttribute('hidden', '');
      }
    });
    menu.querySelectorAll('input[type="checkbox"][data-key]').forEach((box) => {
      box.addEventListener('change', () => {
        flush(getEditor());
        // data-on/data-off turn a checkbox into a two-value setting (tableOverflow)
        const value = box.dataset.on
          ? (box.checked ? box.dataset.on : box.dataset.off)
          : box.checked;
        vscodeApi.postMessage({ type: 'setConfig', key: box.dataset.key, value });
      });
    });
    // 'change', not 'input': input fires per keystroke, and each save re-renders
    // the whole webview, so typing "420" would fire on 4, then 42, then 420.
    menu.querySelectorAll('input[type="number"][data-key]').forEach((box) => {
      box.addEventListener('change', () => {
        const value = Math.max(0, Math.round(Number(box.value) || 0));
        box.value = value;
        flush(getEditor());
        vscodeApi.postMessage({ type: 'setConfig', key: box.dataset.key, value });
      });
    });
    menu.querySelectorAll('select[data-key]').forEach((sel) => {
      sel.addEventListener('change', () => {
        flush(getEditor());
        vscodeApi.postMessage({ type: 'setConfig', key: sel.dataset.key, value: sel.value });
      });
    });
  }

  let vditor = null;
  wireMenu(() => vditor);

  try {
    vditor = new Vditor('bmr-vditor', {
      cdn: CDN,
      mode: 'ir',
      lang: 'en_US',
      icon: 'material',
      theme: isDark ? 'dark' : 'classic',
      height: '100%',
      cache: { enable: false },
      // curated instead of the default 30-odd items: drops upload/record (no
      // backend here) and the devtools/help clutter. Hover shows each name.
      toolbar: [
        'headings', 'bold', 'italic', 'strike', '|',
        'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
        'quote', 'code', 'inline-code', 'link', 'table', 'line', '|',
        'undo', 'redo', '|',
        'outline', 'preview', 'fullscreen', 'edit-mode',
      ],
      toolbarConfig: { pin: true },
      preview: {
        theme: { current: isDark ? 'dark' : 'light' },
        hljs: { style: isDark ? 'github-dark' : 'github', lineNumber: true },
      },
      // isOpen would window.open() the URL. Route local paths through VSCode
      // instead, so back/forward works like it does in the reader. Only fires
      // for a collapsed link: once you are editing one it behaves as text.
      link: {
        isOpen: false,
        click: function (el) { openHref(hrefOfVditorLink(el), newTabClick); },
      },
      after: function () {
        vditor.setValue(INITIAL, true); // true → also clears the undo stack
        // Baseline is what Vditor makes of the file, not the file itself, so a
        // no-op session compares equal even though the two differ on disk.
        lastSaved = vditor.getValue();
        ready = true;
      },
      input: function () {
        if (!ready) return;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(function () { flush(vditor); }, 300);
      },
      blur: function () { flush(vditor); },
    });
  } catch (e) {
    console.error('vditor init failed', e);
    document.getElementById('bmr-vditor').textContent = 'Vditor failed to load: ' + e;
  }

  // ---- pictures ------------------------------------------------------------
  // A relative src means "next to the document", but the webview resolves it
  // against vscode-webview://, where it means nothing, so every one is rebased
  // onto DOC_BASE. Two shapes need it:
  //
  //   real <img> elements   markdown images, and raw <img> on its own line,
  //                         which Lute does render
  //   html-inline spans     a raw <img> mid-sentence or in a table cell, which
  //                         IR mode deliberately shows as its own source text
  //
  // Neither edit reaches the file. Lute rebuilds the markdown from its marker
  // spans, not from src or from anything we add, and SpinVditorIRDOM discards
  // all of it on the next keystroke, which is why this re-runs after input.
  //
  // That re-run has to happen in the SAME TICK as the keystroke. Left on a
  // timer, every keypress blanked the pictures for a third of a second, and a
  // table holding one lost the height and width they were giving it. Measured:
  // 403px tall and 1692 wide with them, 223 by 1617 without, so the table
  // reflowed twice per character and its horizontal scroll got clamped to the
  // narrower width on the way through. That was the flicker.
  //
  // Nothing here may be async, then. Sizes measured once are cached by url so a
  // picture already seen is redressed immediately, with no frame in between.
  (function installImages() {
    const root = () => document.querySelector('.vditor-ir .vditor-reset');
    const resolvable = (s) => /^(?:[a-z][a-z0-9+.-]*:|\\/\\/|\\/|#)/i.test(s);
    const base = DOC_BASE.replace(/\\/$/, '');
    const sizes = new Map();   // url -> { w, h } | 'broken', filled by the probe

    function rebase(src) {
      const t = (src || '').trim();
      if (!t || resolvable(t)) return t;
      return base + '/' + t.replace(/^\\.\\//, '');
    }

    function decorate() {
      const r = root();
      if (!r) return;

      for (const img of r.querySelectorAll('img')) {
        const raw = img.getAttribute('src');
        const next = rebase(raw);
        if (next && next !== raw) img.setAttribute('src', next);
      }

      for (const node of r.querySelectorAll('span[data-type="html-inline"]')) {
        if (node.hasAttribute('data-bmr-img')) continue;
        const code = node.querySelector('code');
        if (!code) continue;
        const tag = code.textContent.trim();
        if (!/^<img\\b[^>]*>$/i.test(tag)) continue;
        const src = (/\\bsrc\\s*=\\s*["']([^"']*)["']/i.exec(tag) || [])[1];
        if (!src) continue;
        const url = rebase(src);
        const known = sizes.get(url);
        if (known === 'broken') continue;   // show the tag, not an empty gap

        // The tag may fix a width, a height, both or neither. Whatever it does
        // not say comes from the picture's own proportions, measured off-DOM so
        // nothing extra is ever added to the editor.
        const attr = (name) => {
          const m = new RegExp('\\\\b' + name + '\\\\s*=\\\\s*["\\']?(\\\\d+)', 'i').exec(tag);
          return m ? +m[1] : 0;
        };
        const wantW = attr('width');
        const wantH = attr('height');

        const dress = (nat) => {
          node.setAttribute('data-bmr-img', '');
          node.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
          const ratio = nat.w && nat.h ? nat.h / nat.w : 0;
          const w = wantW || (wantH && ratio ? Math.round(wantH / ratio) : nat.w);
          const h = wantH || (ratio ? Math.round(w * ratio) : nat.h);
          node.style.width = w + 'px';
          node.style.height = h + 'px';
        };

        // seen before: dress it now, in this tick, so nothing ever blinks
        if (known) { dress(known); continue; }

        // first sight of this url: measure once, then every later keystroke is
        // served from the cache
        const probe = new Image();
        probe.onload = () => {
          const nat = { w: probe.naturalWidth, h: probe.naturalHeight };
          sizes.set(url, nat);
          dress(nat);
        };
        probe.onerror = () => { sizes.set(url, 'broken'); };
        probe.src = url;
      }
    }

    const startImgs = setInterval(() => { if (root()) { clearInterval(startImgs); decorate(); } }, 120);

    // Bubble phase, not capture: Vditor rebuilds the block in its own handler,
    // so this runs right after, on the same event, before the browser paints.
    // Registered before installScrollKeep's restore on purpose, so the table is
    // back at full size by the time its scroll position is put back.
    document.addEventListener('input', decorate);
  })();

  // ---- manual column widths (edit mode) ------------------------------------
  // SpinVditorIRDOM rebuilds the blocks as you type and drops our inline
  // widths. The widths go back on in the keystroke's own tick, for the same
  // reason the pictures do: a table that snaps to its content width and back
  // flickers, and it drags its horizontal scroll along with it. The drag
  // handles are only overlays, so they can wait for the debounce.
  if (${JSON.stringify(!!config.resizableColumns)}) (function installCols() {
${RESIZE_JS}
    const rebuild = installColumnResize(() => document.querySelector('.vditor-ir .vditor-reset'));
    const startCols = setInterval(() => {
      if (document.querySelector('.vditor-ir .vditor-reset')) { clearInterval(startCols); rebuild(); }
    }, 120);
    document.addEventListener('input', rebuild.reapply);
    let rc = null;
    document.addEventListener('input', () => {
      clearTimeout(rc);
      rc = setTimeout(rebuild, 350);
    }, true);
  })();

  // ---- keep a scrolled table where it was (edit mode) ----------------------
  // Type in a table that is scrolled to the right and the view jumps: Vditor
  // runs SpinVditorIRDOM on input and hands back a brand new table element,
  // whose scrollLeft is 0, and the browser then reveals the caret from there.
  //
  // Both halves ride the SAME input event, which is dispatched synchronously:
  //
  //   capture on document   before Vditor's handler  -> snapshot every scrollLeft
  //   bubble on document    after Vditor's handler   -> put them back
  //
  // The bubble half is the whole point. Vditor swaps the table during its own
  // handler, so by the time the event finishes bubbling the new element is
  // already in the DOM and can be scrolled back before the browser has painted
  // once. Restoring a frame later instead (requestAnimationFrame) does put the
  // number back, but the wrong frame reaches the screen first and the table
  // visibly flickers. Measured against a real Vditor offline.
  //
  // The old elements are gone, so tables are matched by index.
  //
  // This block sits last on purpose. scrollLeft is clamped to the table's
  // current width, so everything that decides that width - the pictures, the
  // column widths - has to have gone back on first, and both of those also
  // listen on the bubble phase. Handlers run in registration order, so source
  // order here IS the running order. The couple of later passes are belt and
  // braces for anything that resizes the table after the fact.
  (function installScrollKeep() {
    const root = () => document.querySelector('.vditor-ir .vditor-reset');

    // the pane that scrolls vertically, whichever ancestor Vditor made it
    function scroller() {
      for (let el = root(); el; el = el.parentElement) {
        if (el.scrollHeight > el.clientHeight + 1) return el;
      }
      return null;
    }

    let snap = null;

    function apply(withTop) {
      const r = root();
      if (!r || !snap) return false;
      const tables = r.querySelectorAll('table');
      let touched = false;
      const n = Math.min(tables.length, snap.left.length);
      for (let i = 0; i < n; i++) {
        // never scroll a table further right than it already sat
        if (snap.left[i] > tables[i].scrollLeft) {
          tables[i].scrollLeft = snap.left[i];
          touched = true;
        }
      }
      // the vertical shift rides along with the horizontal one, so only undo it
      // when a table actually had to be put back. Otherwise this would fight the
      // legitimate scroll that keeps the caret visible on a new line.
      if (touched && withTop && snap.pane && snap.pane.isConnected) {
        snap.pane.scrollTop = snap.top;
      }
      return touched;
    }

    function frames(left, withTop) {
      if (left <= 0) return;
      requestAnimationFrame(() => { apply(withTop); frames(left - 1, withTop); });
    }

    // capture: runs before Vditor's own handler, so this still sees the old
    // elements and where they were scrolled to
    document.addEventListener('input', () => {
      const r = root();
      if (!r) return;
      const left = Array.prototype.map.call(r.querySelectorAll('table'), (t) => t.scrollLeft);
      if (!left.some((x) => x > 0)) { snap = null; return; }
      const pane = scroller();
      snap = { left, pane, top: pane ? pane.scrollTop : 0 };
    }, true);

    // bubble: same event, same tick, but Vditor has now rebuilt the block
    let late = null;
    document.addEventListener('input', () => {
      if (!snap) return;
      apply(true);
      frames(2, true);
      clearTimeout(late);
      late = setTimeout(() => { apply(false); }, 420);
    });
  })();

  // ---- collapsible headings (edit mode) ------------------------------------
  // The arrows are deliberately NOT injected into the headings: the editor is a
  // contenteditable that Vditor serializes back to the file, so anything we put
  // inside it can end up in your markdown. They float over the headings instead,
  // positioned from each heading's rect.
  //
  // Folding sets data-bmr-hidden on the blocks of a section. That attribute is
  // inert through Lute (checked against vditorIRDOM2Md and SpinVditorIRDOM), so
  // a folded section still saves its full content.
  if (${JSON.stringify(!!config.collapsibleHeadings)}) (function installEditFolds() {
    const HEAD = /^H([1-6])$/;
    const level = (el) => { const m = el && HEAD.exec(el.tagName); return m ? +m[1] : 0; };
    const root = () => document.querySelector('.vditor-ir .vditor-reset');
    let pairs = []; // { h, btn }

    function sectionOf(h) {
      const stop = level(h);
      const out = [];
      for (let el = h.nextElementSibling; el; el = el.nextElementSibling) {
        const lv = level(el);
        if (lv && lv <= stop) break;
        out.push(el);
      }
      return out;
    }

    function setFolded(h, btn, folded) {
      h.dataset.bmrFolded = folded ? '1' : '';
      btn.textContent = folded ? '\\u25B8' : '\\u25BE';
      btn.title = folded ? 'Expand section' : 'Collapse section';
      btn.classList.toggle('bmr-fold-on', folded);
      for (const el of sectionOf(h)) {
        if (folded) el.setAttribute('data-bmr-hidden', '');
        else el.removeAttribute('data-bmr-hidden');
      }
      // a nested folded heading keeps its own section shut
      if (!folded) {
        for (const el of sectionOf(h)) {
          if (level(el) && el.dataset.bmrFolded) {
            for (const inner of sectionOf(el)) inner.setAttribute('data-bmr-hidden', '');
          }
        }
      }
    }

    // Vditor rebuilds blocks as you type, so rebuild the arrow set rather than
    // trying to keep stale element references alive.
    function rebuild() {
      const r = root();
      if (!r) return;
      for (const p of pairs) p.btn.remove();
      pairs = [];
      for (const h of r.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
        const btn = document.createElement('button');
        btn.className = 'bmr-fold-o';
        btn.type = 'button';
        btn.textContent = h.dataset.bmrFolded ? '\\u25B8' : '\\u25BE';
        btn.title = h.dataset.bmrFolded ? 'Expand section' : 'Collapse section';
        if (h.dataset.bmrFolded) btn.classList.add('bmr-fold-on');
        // mousedown, not click: the editor steals focus and eats the click
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          setFolded(h, btn, !h.dataset.bmrFolded);
        });
        document.body.appendChild(btn);
        pairs.push({ h, btn });
      }
      place();
    }

    function place() {
      const r = root();
      if (!r) return;
      const box = r.getBoundingClientRect();
      for (const { h, btn } of pairs) {
        const rect = h.getBoundingClientRect();
        // hide the arrow once its heading scrolls out of the editor viewport
        if (rect.bottom < box.top + 2 || rect.top > box.bottom - 2) {
          btn.hidden = true;
          continue;
        }
        btn.hidden = false;
        btn.style.left = (rect.left - 19) + 'px';
        btn.style.top = (rect.top + rect.height / 2 - 7.5) + 'px';
      }
    }

    let queued = false;
    function schedule() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; place(); });
    }

    // reveal arrows while the pointer is over the editor, like the reader's hover
    document.addEventListener('mousemove', (e) => {
      const r = root();
      if (!r) return;
      const inside = r.contains(e.target) || e.target.classList.contains('bmr-fold-o');
      for (const { btn } of pairs) btn.classList.toggle('bmr-fold-near', inside);
    });
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);

    const start = setInterval(() => { if (root()) { clearInterval(start); rebuild(); } }, 120);
    // Vditor re-renders on input; rebuild after it settles
    let reb = null;
    document.addEventListener('input', () => {
      clearTimeout(reb);
      reb = setTimeout(rebuild, 350);
    }, true);

    const all = document.getElementById('bmr-foldall');
    if (all) {
      let collapsed = false;
      all.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        collapsed = !collapsed;
        for (const { h, btn } of pairs) setFolded(h, btn, collapsed);
        all.firstElementChild.textContent = collapsed ? '\\u25B8' : '\\u25BE';
        all.title = collapsed ? 'Expand every section' : 'Collapse every section';
        place();
      });
    }
  })();
</script>
</body>
</html>`;
  }

  buildHtml(source, webview, mermaidUri, vditorBase, docDir, docBase, gitInfo, config) {
    if (config.editMode) {
      return this.buildEditHtml(source, webview, vditorBase, docDir, docBase, gitInfo, config);
    }
    const body = resolveImgSrc(md.render(source), docBase);
    const header = config.showGitHeader ? this.buildHeader(gitInfo, config.historyExpanded) : "";
    const menu = this.buildMenu(config);
    const cspSource = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline'; font-src ${cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  /* first, so a forced theme's palette is in place before anything reads it */
${themeCss(config.theme)}
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    line-height: 1.6;
    max-width: 860px;
    margin: 0 auto;
    /* 50vh at the bottom so the end of a long file can be scrolled up to the
       middle of the screen, instead of stopping at the bottom edge. */
    padding: 24px 32px 50vh;
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
${tableCss(config.tableOverflow, config.maxColumnWidth)}
${config.collapsibleHeadings ? FOLD_CSS : ""}
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

  /* options kebab menu (top-right) */
  .bmr-menu-btn {
    position: fixed; top: 10px; right: 12px; z-index: 50;
    width: 28px; height: 28px; padding: 0; border-radius: 6px; cursor: pointer;
    font-size: 16px; line-height: 1;
    display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--vscode-editor-foreground, #888) 10%, transparent);
    color: var(--vscode-editor-foreground, #ccc);
    border: 1px solid var(--vscode-panel-border, #8884);
    opacity: .45; transition: opacity .15s, background .15s;
  }
  .bmr-menu-btn:hover { opacity: 1; background: color-mix(in srgb, var(--vscode-editor-foreground, #888) 20%, transparent); }
  .bmr-menu {
    position: fixed; top: 44px; right: 12px; z-index: 50;
    min-width: 230px; padding: 6px;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background, #252526));
    border: 1px solid var(--vscode-panel-border, #8884); border-radius: 8px;
    box-shadow: 0 4px 16px #0006;
    display: flex; flex-direction: column; gap: 2px;
  }
  .bmr-menu[hidden] { display: none; }
  .bmr-menu-item {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; padding: 5px 8px; border-radius: 5px; cursor: pointer;
    color: var(--vscode-editor-foreground);
  }
  .bmr-menu-item:hover { background: var(--vscode-list-hoverBackground, #8881); }
  .bmr-menu-item input { cursor: pointer; margin: 0; }

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
${MENU_FOOT_CSS}
${LINK_TOOLTIP_CSS}
${config.resizableColumns ? RESIZE_CSS : ""}
</style>
</head>
<body>
${menu}
${
  config.collapsibleHeadings
    ? `<button class="bmr-foldall" id="bmr-foldall" title="Collapse every section">▾ All</button>`
    : ""
}
${header}
${body}
<script src="${mermaidUri}"></script>
<script>
  const vscodeApi = acquireVsCodeApi();
  const DOC_DIR = ${JSON.stringify(docDir)};
  const COLLAPSIBLE_HEADINGS = ${JSON.stringify(!!config.collapsibleHeadings)};

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

  // ---- manual column widths (reader) ---------------------------------------
  if (${JSON.stringify(!!config.resizableColumns)}) (function installCols() {
${RESIZE_JS}
    // nothing re-renders the reader, so one pass is enough; folding only moves
    // tables around, and the handles re-measure on scroll
    installColumnResize(() => document.body)();
  })();

${LINK_TOOLTIP_JS}
  installLinkTooltip((t) => {
    const a = t && t.closest ? t.closest('a[href]') : null;
    return a ? { el: a, href: a.getAttribute('href') || '' } : null;
  });

  // options kebab menu: toggle popover, persist checkbox changes
  (function wireMenu() {
    const btn = document.getElementById('bmr-menu-btn');
    const menu = document.getElementById('bmr-menu');
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.hasAttribute('hidden')) menu.removeAttribute('hidden');
      else menu.setAttribute('hidden', '');
    });
    document.addEventListener('click', (e) => {
      if (!menu.hasAttribute('hidden') && !menu.contains(e.target) && e.target !== btn) {
        menu.setAttribute('hidden', '');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') menu.setAttribute('hidden', '');
    });
    menu.querySelectorAll('input[type="checkbox"][data-key]').forEach((box) => {
      box.addEventListener('change', () => {
        // data-on/data-off turn a checkbox into a two-value setting (tableOverflow)
        const value = box.dataset.on
          ? (box.checked ? box.dataset.on : box.dataset.off)
          : box.checked;
        vscodeApi.postMessage({ type: 'setConfig', key: box.dataset.key, value });
      });
    });
    // 'change', not 'input': input fires per keystroke, and each save re-renders
    // the whole webview, so typing "420" would fire on 4, then 42, then 420.
    menu.querySelectorAll('input[type="number"][data-key]').forEach((box) => {
      box.addEventListener('change', () => {
        const value = Math.max(0, Math.round(Number(box.value) || 0));
        box.value = value;
        vscodeApi.postMessage({ type: 'setConfig', key: box.dataset.key, value });
      });
    });
    menu.querySelectorAll('select[data-key]').forEach((sel) => {
      sel.addEventListener('change', () => {
        vscodeApi.postMessage({ type: 'setConfig', key: sel.dataset.key, value: sel.value });
      });
    });
  })();

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

  // null means "auto": ask VSCode. A forced theme has already repainted the
  // palette in CSS, so this is what tells mermaid to match it.
  const FORCED_DARK = ${JSON.stringify(isDarkTheme(config.theme))};
  const isDark = FORCED_DARK !== null ? FORCED_DARK
    : document.body.classList.contains('vscode-dark') ||
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
    if (e.target.closest('.bmr-menu') || e.target.closest('.bmr-menu-btn')) return; // options menu
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

  // ---- collapsible headings ------------------------------------------------
  // A section is every sibling after a heading up to the next heading of the
  // same or higher level, which is how markdown nests without a real tree.
  // Folds are runtime only: the reader re-renders on every file change, so
  // they reset by design.
  if (COLLAPSIBLE_HEADINGS) (function installFolds() {
    const HEAD = /^H([1-6])$/;
    const level = (el) => {
      const m = el && HEAD.exec(el.tagName);
      return m ? +m[1] : 0;
    };
    const heads = [...document.querySelectorAll('body > h1, body > h2, body > h3, body > h4, body > h5, body > h6')];
    if (!heads.length) {
      const all = document.getElementById('bmr-foldall');
      if (all) all.remove(); // nothing to fold, so don't offer to
      return;
    }

    function paint(h, folded) {
      const btn = h.querySelector('.bmr-fold');
      if (!btn) return;
      btn.textContent = folded ? '\\u25B8' : '\\u25BE';
      btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
      btn.title = folded ? 'Expand section' : 'Collapse section';
    }

    // Hide or reveal one section. When revealing, a nested heading that is
    // itself folded keeps its own section hidden, so unfolding a parent does
    // not blow open everything underneath it.
    function apply(h, folded) {
      const stop = level(h);
      let el = h.nextElementSibling;
      while (el) {
        const lv = level(el);
        if (lv && lv <= stop) break;
        if (folded) {
          el.setAttribute('data-bmr-hidden', '');
          el = el.nextElementSibling;
          continue;
        }
        el.removeAttribute('data-bmr-hidden');
        if (lv && el.classList.contains('bmr-folded')) {
          let inner = el.nextElementSibling;
          while (inner) {
            const il = level(inner);
            if (il && il <= lv) break;
            inner.setAttribute('data-bmr-hidden', '');
            inner = inner.nextElementSibling;
          }
          el = inner;
        } else {
          el = el.nextElementSibling;
        }
      }
    }

    function setFolded(h, folded) {
      h.classList.toggle('bmr-folded', folded);
      paint(h, folded);
      apply(h, folded);
    }

    for (const h of heads) {
      const btn = document.createElement('button');
      btn.className = 'bmr-fold';
      btn.type = 'button';
      h.insertBefore(btn, h.firstChild);
      paint(h, false);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation(); // never let this reach the double-click-to-edit handler
        setFolded(h, !h.classList.contains('bmr-folded'));
      });
      // the button lives inside the heading, so shield the edit gesture too
      btn.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); });
    }

    const all = document.getElementById('bmr-foldall');
    if (all) {
      let collapsed = false;
      all.addEventListener('click', (e) => {
        e.stopPropagation();
        collapsed = !collapsed;
        // outermost first, so nested sections are already hidden by their parent
        for (const h of heads) setFolded(h, collapsed);
        all.textContent = collapsed ? '\\u25B8 All' : '\\u25BE All';
        all.title = collapsed ? 'Expand every section' : 'Collapse every section';
      });
      all.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); });
    }
  })();
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
