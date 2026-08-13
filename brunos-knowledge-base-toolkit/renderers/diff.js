const vscode = require("vscode");
const path = require("path");
const { buildHtml } = require("../lib/diff-html");

// straight from the manifest, so the header can never drift from the real version
const { version: VERSION } = require("../package.json");

/**
 * Custom editor that renders a .diff/.patch with add/remove colouring instead of
 * showing it as raw text. Read-only: it never writes to the document.
 */
class DiffEditorProvider {
  constructor(context) {
    this.context = context;
  }

  async resolveCustomTextEditor(document, webviewPanel, _token) {
    const webview = webviewPanel.webview;
    // No scripts, no local assets — the page is static HTML plus a <style>.
    webview.options = { enableScripts: false };

    const render = () => {
      webview.html = buildHtml({
        text: document.getText(),
        cspSource: webview.cspSource,
        fileName: path.basename(document.uri.fsPath),
        version: VERSION,
      });
    };

    render();

    // Patches get regenerated in place often enough (git diff > x.diff) that
    // following the document beats making Bruno reopen the tab.
    const sub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) render();
    });
    webviewPanel.onDidDispose(() => sub.dispose());
  }
}

// Everything this handler contributes. Read-only, so there is nothing here but
// the editor itself: no commands, no keybindings, no state to keep in sync.
function register(context) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      "brunosDiffViewer.editor",
      new DiffEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );
}

module.exports = { register };
