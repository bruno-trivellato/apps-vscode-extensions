const vscode = require("vscode");
const MarkdownIt = require("markdown-it");

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

// Faz os blocos ```mermaid virarem <pre class="mermaid"> (que o mermaid.js renderiza),
// em vez de <pre><code class="language-mermaid">.
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

/**
 * Custom editor que renderiza o .md direto (no lugar do texto cru), com mermaid.
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

    const render = () => {
      webview.html = this.buildHtml(document.getText(), webview, mermaidUri);
    };

    render();

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        render();
      }
    });

    // duplo-clique na página → reabre o arquivo no editor de texto (modo edição)
    const msgSub = webview.onDidReceiveMessage((msg) => {
      if (msg && msg.type === "edit") {
        vscode.commands.executeCommand("vscode.openWith", document.uri, "default");
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      msgSub.dispose();
    });
  }

  buildHtml(source, webview, mermaidUri) {
    const body = md.render(source);
    const cspSource = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="pt-br">
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

  /* wrapper + botão de expandir no hover do diagrama */
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
${body}
<script src="${mermaidUri}"></script>
<script>
  const vscodeApi = acquireVsCodeApi();
  const isDark = document.body.classList.contains('vscode-dark') ||
    document.querySelector('body')?.dataset?.vscodeThemeKind?.includes('dark');

  let modalOpen = false;

  // duplo-clique na página (fora de diagrama/link/modal) → volta pro editor de texto
  document.addEventListener('dblclick', (e) => {
    if (modalOpen) return;
    if (e.target.closest('a')) return;
    if (e.target.closest('.mermaid-wrap')) return; // diagramas são interativos
    vscodeApi.postMessage({ type: 'edit' });
  });

  // adiciona o botão de expandir em cada diagrama já renderizado
  function decorate() {
    document.querySelectorAll('pre.mermaid[data-processed="true"]').forEach((el) => {
      if (el.parentElement.classList.contains('mermaid-wrap')) return;
      const wrap = document.createElement('div');
      wrap.className = 'mermaid-wrap';
      el.parentNode.insertBefore(wrap, el);
      wrap.appendChild(el);
      const btn = document.createElement('button');
      btn.className = 'expand-btn';
      btn.title = 'Abrir em tela cheia (pan + zoom)';
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
    hint.textContent = 'Scroll pra mover · ⌘/Ctrl+scroll pra zoom · Esc fecha';
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
    mk('⤢', 'Ajustar à tela', fit);
    mk('✕', 'Fechar (Esc)', close);

    // scroll = pan · ⌘/Ctrl+scroll = zoom (mouse fica livre pra selecionar texto)
    modal.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = modal.getBoundingClientRect();
        zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
      } else {
        tx -= e.deltaX; ty -= e.deltaY; applyT();
      }
    }, { passive: false });

    function onKey(e) { if (e.key === 'Escape') close(); }
    window.addEventListener('keydown', onKey);

    function close() {
      window.removeEventListener('keydown', onKey);
      modal.remove();
      modalOpen = false;
    }

    fit();
  }

  try {
    mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default' });
    mermaid.run({ querySelector: 'pre.mermaid' }).then(decorate).catch((e) => {
      console.error('mermaid run falhou', e);
    });
  } catch (e) {
    console.error('mermaid init falhou', e);
  }
</script>
</body>
</html>`;
  }
}

function activate(context) {
  const provider = new MarkdownEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider("brunosMarkdownReader.editor", provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
