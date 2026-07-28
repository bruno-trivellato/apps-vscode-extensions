# Bruno's Markdown Reader

VSCode extension that opens `.md` files **rendered inline** (reading mode) instead of raw text. It draws mermaid diagrams, makes links clickable, shows git history, and has a fullscreen diagram viewer.

## Features

- **Rendered on open**: `.md` shows as a formatted reading view with mermaid diagrams. It re-renders live on change and follows the light/dark theme.
- **Links**: click a relative/local link to navigate (VSCode back/forward works). `Cmd`/`Ctrl`+click opens a new tab. Right-click for *Open*, *Open to the Side*, *Copy Link Path*.
- **Git header**: shows the last commit (author, date, message) plus an expandable, scrollable file history. Click any commit to open its diff in a new tab.
- **Fullscreen diagrams**: hover a mermaid diagram and click ⛶ to open a pan/zoom viewer. Middle-drag pans, scroll zooms, `Esc` closes.
- **Edit and preview**: double-click the page to switch to the text editor. Press `Esc` twice to go back to preview.
- **Options menu**: the `⋯` button (top-right) toggles the settings below without leaving the file.
- **Notion-like experience (beta)**: swaps the reader for the [Vditor](https://b3log.org/vditor) instant-render editor, where markdown formats itself as you type. Edits go straight to the file, so dirty state, `Cmd`+`S` and undo work as usual. Click **¶ Formatting** in the header for the toolbar. Off by default.
- **Link tooltip**: hover any link to see the full path it resolves to, flagged in red when the file is not there.

## Settings

| Setting | Default | What it does |
|---------|---------|--------------|
| `brunosMarkdownReader.showGitHeader` | `true` | Show the git header (last commit + file history). |
| `brunosMarkdownReader.historyExpanded` | `false` | Start the commit History panel expanded. |
| `brunosMarkdownReader.doubleEscToPreview` | `true` | Press `Esc` twice to return to preview while editing. |
| `brunosMarkdownReader.editMode` | `false` | **Beta.** Notion-like experience: replace the reader with the Vditor instant-render editor. |

### Notes on the Notion-like experience

This is a spike, so it's worth trying but expectations should stay low:

- Content is written back 300 ms after you stop typing, and on blur. It's a full-document replace, so undo history is coarser than normal typing.
- The formatting toolbar is Vditor's own, hidden behind the **¶ Formatting** button so it stays out of the way.
- It runs under a looser CSP than the reader. It needs `'unsafe-eval'` for Vditor's bundled mermaid/markmap, plus a `blob:` worker for graphviz. The reader keeps the strict policy.
- Vditor's assets are vendored under `media/vditor`, for the same reason mermaid is: the webview CSP blocks CDNs.

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
- `media/mermaid.min.js` and `media/vditor/` are vendored because the webview CSP blocks CDNs, so they must stay committed.
- Uninstall: `code --uninstall-extension brunotrivellato.brunos-markdown-reader`

## Credits

This extension stands on other people's work. All of it is MIT licensed:

- **[Vditor](https://b3log.org/vditor)** by [Vanessa](http://vanessa.b3log.org) and [B3log](https://b3log.org), the editor behind Edit mode. Source: [Vanessa219/vditor](https://github.com/Vanessa219/vditor). A copy of its dist ships in `media/vditor/`, with its license at `media/vditor/LICENSE`.
- **[mermaid](https://mermaid.js.org)** draws the diagrams, in both the reader and Vditor.
- **[markdown-it](https://github.com/markdown-it/markdown-it)** renders the markdown in reading mode.

Vditor also bundles [Lute](https://github.com/88250/lute), [KaTeX](https://katex.org), [highlight.js](https://highlightjs.org) and a few other renderers. Thanks to everyone involved.
