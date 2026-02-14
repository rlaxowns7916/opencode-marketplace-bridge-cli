# codex

Bidirectional compiler between CLAUDE.md (source) and code (binary).

## Concept

- **CLAUDE.md** = source code (human-readable specification)
- **Code** = binary (machine-executable implementation)
- **Compile** = CLAUDE.md -> Code
- **Decompile** = Code -> CLAUDE.md

## Commands

### `/compile`

Reads the project's CLAUDE.md, extracts specifications, and generates or updates code.

```
/compile                    # compile entire spec
/compile auth module        # compile specific section
```

### `/decompile`

Analyzes the codebase and generates or updates CLAUDE.md with extracted architecture.

```
/decompile                  # decompile entire project
/decompile src/api/         # decompile specific directory
```

## Agent

The `codex` agent handles both compile and decompile workflows. It can be invoked directly or through the commands above.
