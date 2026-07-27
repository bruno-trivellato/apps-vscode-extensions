# Bruno's Markdown Reader

VSCode extension that opens `.md` files **rendered inline** (replacing the text editor), with mermaid diagram support.

## Behavior

- Click a `.md` file → opens rendered (reading mode), mermaid diagrams drawn.
- Hover a mermaid diagram → **⛶ Fullscreen** button; opens a fullscreen viewer with pan (drag) and zoom (scroll / `+` `−` / fit). Double-click resets, `Esc` closes.
- Double-click anywhere else on the page → switches back to the text editor. Links and diagrams are not intercepted.
- Live re-render when the underlying file changes; follows the VSCode light/dark theme.

## Build & install

```bash
npm install
npx @vscode/vsce package --allow-missing-repository
code --install-extension brunos-markdown-reader-0.0.1.vsix --force
# then: Cmd+Shift+P -> Developer: Reload Window
```

To open rendered on click, VSCode user settings needs:

```json
"workbench.editorAssociations": { "*.md": "brunosMarkdownReader.editor" }
```

## Notes

- Registered as a `customEditors` contribution (`priority: default`, selector `*.md`).
- `media/mermaid.min.js` is vendored because the webview CSP blocks external CDNs — it must be committed.
- Uninstall: `code --uninstall-extension brunotrivellato.brunos-markdown-reader`
