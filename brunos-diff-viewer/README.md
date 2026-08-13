# Bruno's Diff Viewer

VSCode extension that opens `.diff` and `.patch` files **coloured** instead of raw text. Added lines get a **green** background, removed lines get a **red** one.

It only shows the patch. It never writes to the file, and the page has no JavaScript at all.

## Features

- **Green adds, red removes**: unified diff, in the patch's own order. Colours come from the VSCode theme, so light and dark both look right.
- **Headers stay neutral**: `--- a/file`, `+++ b/file`, `diff --git`, `index` and the mode/rename lines are not painted. They are headers, not content.
- **Hunk headers**: every `@@ ... @@` gets its own band, so hunks are easy to tell apart.
- **Summary bar**: file name plus the total `+` and `-` counts, pinned at the top while you scroll.
- **Live**: it re-renders when the file changes, so you can regenerate a patch without reopening the tab.

## Build and install

```bash
npm install
npx @vscode/vsce package --allow-missing-repository
code --install-extension brunos-diff-viewer-*.vsix --force
# then: Cmd+Shift+P -> Developer: Reload Window
```

To open coloured on click, add this to VSCode user settings:

```json
"workbench.editorAssociations": {
  "*.diff": "brunosDiffViewer.editor",
  "*.patch": "brunosDiffViewer.editor"
}
```

There is a `sample.diff` in this folder to check the rendering.

## Test

```bash
npm test   # Mocha unit tests for lib/diff.js and lib/html.js
```

## Notes

- Custom editor contribution (`priority: default`, selectors `*.diff` and `*.patch`).
- **Why the parser counts hunk lines.** A removed line starting with `--` looks exactly like a `--- a/file` header. Text alone cannot tell them apart. So `parseDiff` reads the `-a,b +c,d` counts from each `@@` header and always knows if it is inside a hunk. Without that, a patch that contains a patch renders wrong.
- The webview runs under `script-src 'none'`. A test checks the page has no `<script>`, and syntax-checks any that shows up later. An undefined name inside a template-literal script passes `node -c` and would only break in the GUI.
- Uninstall: `code --uninstall-extension brunotrivellato.brunos-diff-viewer`
