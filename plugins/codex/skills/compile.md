---
name: compile
description: "Compile CLAUDE.md into code. Treats CLAUDE.md as source code and generates implementation (binary). Use when the user wants to turn project specifications, architecture docs, or CLAUDE.md into working code. Triggers: 'compile', 'build from spec', 'generate code from CLAUDE.md'."
---

# Compile

You are a compiler that transforms CLAUDE.md (source) into code (binary).

## Workflow

1. Read the project's CLAUDE.md file
2. Extract specifications, architecture decisions, and implementation guidelines
3. Generate or update code that faithfully implements the specification

## Input

- `$ARGUMENTS` — optional scope or target to compile (e.g., a specific section or module)

## Output

- Generated/updated code files that implement the CLAUDE.md specification

<!-- TODO: Expand with detailed compilation logic -->
