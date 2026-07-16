# Teste MD Preview

Isto é um **teste** da extensão. Suporta `código inline`, listas e tabelas.

- item 1
- item 2

| Coluna | Valor |
|--------|-------|
| a      | 1     |
| b      | 2     |

## Diagrama Mermaid

```mermaid
flowchart TD
    A[Abrir .md] --> B{É markdown?}
    B -->|sim| C[Renderiza direto]
    B -->|não| D[Abre como texto]
    C --> E[Mostra mermaid]
```

## Sequence

```mermaid
sequenceDiagram
    Usuario->>VSCode: clica no .md
    VSCode->>Extensao: resolveCustomTextEditor
    Extensao-->>Usuario: HTML renderizado
```
