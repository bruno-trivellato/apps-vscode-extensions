# Bruno's Markdown Reader

VSCode extension that opens `.md` files **rendered inline** (reading mode) instead of raw text. It draws mermaid diagrams, makes links clickable, shows git history, and has a fullscreen diagram viewer.

## Features

- **Rendered on open**: `.md` shows as a formatted reading view with mermaid diagrams. It re-renders live on change and follows the light/dark theme.
- **Links**: click a relative/local link to navigate (VSCode back/forward works). `Cmd`/`Ctrl`+click opens a new tab. Right-click for *Open*, *Open to the Side*, *Copy Link Path*.
- **Git header**: shows the last commit (author, date, message) plus an expandable, scrollable file history. Click any commit to open its diff in a new tab.
- **Fullscreen diagrams**: hover a mermaid diagram and click ⛶ to open a pan/zoom viewer. Middle-drag pans, scroll zooms, `Esc` closes.
- **Edit and preview**: double-click the page to switch to the text editor. Press `Esc` twice to go back to preview.

## Build and install

```bash
npm install
npx @vscode/vsce package --allow-missing-repository
code --install-extension brunos-markdown-reader-*.vsix --force
# then: Cmd+Shift+P -> Developer: Reload Window
```

To open rendered on click, add this to VSCode user settings:

```json
"workbench.editorAssociations": { "*.md": "brunosMarkdownReader.editor" }
```

## Test

```bash
npm test   # Mocha unit tests for the pure helpers in lib/util.js
```

## Publish

```bash
export VSCE_PAT=...   # or store it once in the macOS Keychain as `vsce-pat`
./publish.sh          # append patch|minor|major to bump the version
```

## Notes

- Custom editor contribution (`priority: default`, selector `*.md`).
- `media/mermaid.min.js` is vendored because the webview CSP blocks CDNs, so it must stay committed.
- Uninstall: `code --uninstall-extension brunotrivellato.brunos-markdown-reader`
