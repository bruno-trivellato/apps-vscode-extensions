# apps-vscode-extensions

Monorepo of Bruno's personal VSCode extensions. Each subfolder is a standalone extension.

## Extensions

| Extension | Description |
|-----------|-------------|
| [brunos-knowledge-base](./brunos-knowledge-base/) | Opens knowledge-base files rendered instead of raw. One handler per file type: `.md` rendered inline with mermaid, `.diff`/`.patch` coloured green and red. |

### Superseded

Both folders below were merged into `brunos-knowledge-base`. They are kept until the merged extension has been used for a while, then they get deleted.

| Extension | Replaced by |
|-----------|-------------|
| [brunos-markdown-reader](./brunos-markdown-reader/) | the Markdown Reader handler |
| [brunos-diff-viewer](./brunos-diff-viewer/) | the Diff Viewer handler |

## Build & install an extension

```bash
cd <extension-folder>
npm install
npx @vscode/vsce package --allow-missing-repository
code --install-extension <name>-<version>.vsix --force
```
