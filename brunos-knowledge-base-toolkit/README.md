# Bruno's Knowledge Base Toolkit

VSCode extension that opens knowledge-base files the way they are meant to be read, instead of as raw text.

One extension, one **handler** per file type:

| Handler | Files | What it does |
|---------|-------|--------------|
| [Markdown Reader](#markdown-reader) | `.md` | Renders the page inline, with mermaid diagrams, git history and a beta Notion-like editor. |
| [Diff Viewer](#diff-viewer) | `.diff`, `.patch` | Colours the patch: green background on added lines, red on removed ones. Read-only. |

Adding a third file type means adding a module in `renderers/` and a line in `extension.js`. Nothing else has to move.

## Markdown Reader

Opens `.md` files **rendered inline** (reading mode) instead of raw text. It draws mermaid diagrams, makes links clickable, shows git history, and has a fullscreen diagram viewer.

- **Rendered on open**: `.md` shows as a formatted reading view with mermaid diagrams. It re-renders live on change and follows the light/dark theme.
- **Links**: click a relative/local link to navigate (VSCode back/forward works). `Cmd`/`Ctrl`+click opens a new tab. Right-click for *Open*, *Open to the Side*, *Copy Link Path*.
- **Git header**: shows the last commit (author, date, message) plus an expandable, scrollable file history. Click any commit to open its diff in a new tab.
- **Fullscreen diagrams**: hover a mermaid diagram and click ⛶ to open a pan/zoom viewer. Middle-drag pans, scroll zooms, `Esc` closes. Works in the reader **and** in the Notion-like editor.
- **Edit and preview**: double-click the page to switch to the text editor. Press `Esc` twice to go back to preview.
- **Options menu**: the `⋯` button (top-right) changes the settings below without leaving the file. **Max column width** is a number you can dial right there, and **Theme** is a dropdown.
- **Dark and light**: the reader follows your system theme through VSCode, so it goes dark when your Mac does. The page, mermaid diagrams and code highlighting all move together. Set **Theme** to `light` or `dark` if you want the reader pinned to one, whatever VSCode is doing.
- **Notion-like experience (beta)**: swaps the reader for the [Vditor](https://b3log.org/vditor) instant-render editor, where markdown formats itself as you type. Edits go straight to the file, so dirty state, `Cmd`+`S` and undo work as usual. Click **¶ Formatting** in the header for the toolbar. Off by default.
- **Link tooltip**: hover any link to see the full path it resolves to, flagged in red when the file is not there.

### Settings

| Setting | Default | What it does |
|---------|---------|--------------|
| `brunosMarkdownReader.showGitHeader` | `true` | Show the git header (last commit + file history). |
| `brunosMarkdownReader.historyExpanded` | `false` | Start the commit History panel expanded. |
| `brunosMarkdownReader.doubleEscToPreview` | `true` | Press `Esc` twice to return to preview while editing. |
| `brunosMarkdownReader.editMode` | `false` | **Beta.** Notion-like experience: replace the reader with the Vditor instant-render editor. |
| `brunosMarkdownReader.collapsibleHeadings` | `true` | Show a fold arrow next to each heading, so you can collapse everything under it. Folds reset when you reopen the file. |
| `brunosMarkdownReader.resizableColumns` | `true` | **Experimental.** Drag the divider in a table header to set a column width by hand. Widths reset when you reopen the file. |
| `brunosMarkdownReader.maxColumnWidth` | `420` | How wide a table column may get, in pixels, before its text wraps. `0` turns the cap off. Long inline code stays whole and widens its column past the cap. |
| `brunosMarkdownReader.tableOverflow` | `center` | Where a wide table grows. `center` grows both ways from the middle, `left` keeps the left edge and grows right. |
| `brunosMarkdownReader.theme` | `auto` | Which palette the reader paints itself with. `auto` follows VSCode, which follows your system theme. `light` and `dark` force one, whatever VSCode is set to. |

The setting names still say `brunosMarkdownReader` on purpose. Renaming them would silently drop every preference you already have. They can be migrated later, with a proper fallback read.

### Notes on the Notion-like experience

This is a spike, so it's worth trying but expectations should stay low:

- Content is written back 300 ms after you stop typing, and on blur. It's a full-document replace, so undo history is coarser than normal typing.
- The formatting toolbar is Vditor's own, hidden behind the **¶ Formatting** button so it stays out of the way.
- It runs under a looser CSP than the reader. It needs `'unsafe-eval'` for Vditor's bundled mermaid/markmap, plus a `blob:` worker for graphviz. The reader keeps the strict policy.
- Vditor's assets are vendored under `media/vditor`, for the same reason mermaid is: the webview CSP blocks CDNs.
- The fullscreen diagram button is a single floating element in `<body>`, not something added next to the diagram. Vditor renders mermaid by replacing the `innerHTML` of `.language-mermaid`, and Lute reads that same DOM back to rebuild the markdown that gets written to the file. Wrapping the diagram there could corrupt the document, and anything placed inside it is destroyed on the next re-render. So the button only reads bounding boxes and never touches the editor's DOM. A test enforces this.

## Diff Viewer

Opens `.diff` and `.patch` files **coloured**. Added lines get a green background, removed lines get a red one. It only shows the patch, it never writes to the file, and the page has no JavaScript at all.

- **Green adds, red removes**: unified diff, in the patch's own order. Colours come from the VSCode theme, so light and dark both look right.
- **Headers stay neutral**: `--- a/file`, `+++ b/file`, `diff --git`, `index` and the mode/rename lines are not painted. They are headers, not content.
- **Hunk headers**: every `@@ ... @@` gets its own band, so hunks are easy to tell apart.
- **Summary bar**: file name plus the total `+` and `-` counts, pinned at the top while you scroll.
- **Live**: it re-renders when the file changes, so you can regenerate a patch without reopening the tab.

There is a `sample.diff` in this folder to check the rendering.

### Why the parser counts hunk lines

A removed line starting with `--` looks exactly like a `--- a/file` header. Text alone cannot tell them apart. So `parseDiff` reads the `-a,b +c,d` counts from each `@@` header and always knows if it is inside a hunk. Without that, a patch that contains a patch renders wrong.

## Build and install

```bash
npm install
npx @vscode/vsce package --allow-missing-repository
code --install-extension brunos-knowledge-base-toolkit-*.vsix --force
# then: Cmd+Shift+P -> Developer: Reload Window
```

To open both file types rendered on click, add this to VSCode user settings:

```json
"workbench.editorAssociations": {
  "*.md": "brunosMarkdownReader.editor",
  "*.diff": "brunosDiffViewer.editor",
  "*.patch": "brunosDiffViewer.editor"
}
```

The `viewType` ids kept their old names, so an existing `editorAssociations` block keeps working after the merge.

## Test

```bash
npm test   # Mocha unit tests for the pure helpers in lib/
```

## Publish

```bash
export VSCE_PAT=...   # or store it once in the macOS Keychain as `vsce-pat`
./publish.sh          # append patch|minor|major to bump the version
```

## Layout

```
extension.js          picks which handlers exist, nothing else
renderers/
  markdown.js         the .md custom editor, its commands and keybindings
  diff.js             the .diff/.patch custom editor
lib/
  util.js, css.js     markdown helpers
  diagram-zoom.js     fullscreen mermaid viewer, shared by both markdown views
  diff-parse.js       patch parser
  diff-css.js         patch styles
  diff-html.js        patch page
media/                vendored mermaid and Vditor
```

## Notes

- Two custom editor contributions, both `priority: default`: `*.md` and `*.diff`/`*.patch`.
- `media/mermaid.min.js` and `media/vditor/` are vendored because the webview CSP blocks CDNs, so they must stay committed.
- The diff webview runs under `script-src 'none'`. A test checks the page has no `<script>`, and syntax-checks any that shows up later. An undefined name inside a template-literal script passes `node -c` and would only break in the GUI.
- Uninstall: `code --uninstall-extension brunotrivellato.brunos-knowledge-base-toolkit`
- This replaces the separate `brunos-markdown-reader` and `brunos-diff-viewer` extensions. Uninstall both, or two extensions fight over the same `viewType`.

## Credits

This extension stands on other people's work. All of it is MIT licensed:

- **[Vditor](https://b3log.org/vditor)** by [Vanessa](http://vanessa.b3log.org) and [B3log](https://b3log.org), the editor behind Edit mode. Source: [Vanessa219/vditor](https://github.com/Vanessa219/vditor). A copy of its dist ships in `media/vditor/`, with its license at `media/vditor/LICENSE`.
- **[mermaid](https://mermaid.js.org)** draws the diagrams, in both the reader and Vditor.
- **[markdown-it](https://github.com/markdown-it/markdown-it)** renders the markdown in reading mode.

Vditor also bundles [Lute](https://github.com/88250/lute), [KaTeX](https://katex.org), [highlight.js](https://highlightjs.org) and a few other renderers. Thanks to everyone involved.
