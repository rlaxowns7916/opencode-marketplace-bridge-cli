---
name: decompile
description: "Decompile existing code into CLAUDE.md specification"
allowed_tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
---

# /decompile

Decompile the project's code into a CLAUDE.md specification.

Analyze the codebase, extract architecture and conventions, and generate or update CLAUDE.md.

Target: $ARGUMENTS
