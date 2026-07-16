# apps-vscode-extensions

Monorepo of Bruno's personal VSCode extensions. Each subfolder is a standalone extension.

## Extensions

| Extension | Description |
|-----------|-------------|
| [brunos-markdown-reader](./brunos-markdown-reader/) | Opens `.md` files rendered inline (replaces the text editor), with mermaid diagram support. Double-click switches back to text editing. |

## Build & install an extension

```bash
cd <extension-folder>
npm install
npx @vscode/vsce package --allow-missing-repository
code --install-extension <name>-<version>.vsix --force
```
