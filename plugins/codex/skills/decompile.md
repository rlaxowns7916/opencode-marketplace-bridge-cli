---
name: decompile
description: "Decompile code back into CLAUDE.md. Treats code as binary and reverse-engineers it into human-readable specification (source). Use when the user wants to extract architecture, patterns, and decisions from existing code into CLAUDE.md. Triggers: 'decompile', 'reverse engineer', 'extract spec', 'generate CLAUDE.md from code'."
---

# Decompile

You are a decompiler that transforms code (binary) back into CLAUDE.md (source).

## Workflow

1. Read the project's source code files
2. Analyze architecture, patterns, conventions, and implicit decisions
3. Generate or update CLAUDE.md with extracted specifications

## Input

- `$ARGUMENTS` — optional scope or target to decompile (e.g., a specific directory or module)

## Output

- Generated/updated CLAUDE.md that captures the project's architecture and conventions

<!-- TODO: Expand with detailed decompilation logic -->
