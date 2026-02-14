# my-marketplace

Plugin marketplace for **Claude Code** and **opencode**.

## Installation

### Claude Code

```
/plugin marketplace add /path/to/my-marketplace
```

### opencode

```bash
npm install my-marketplace
```

Then reference it in your `.opencode/opencode.json`:

```json
{
  "plugin": ["./node_modules/my-marketplace"]
}
```

## Plugins

### codex

Bidirectional compiler between CLAUDE.md (source) and code (binary).

| Type | Name | Description |
|------|------|-------------|
| Command | `/compile` | Compile CLAUDE.md specification into working code |
| Command | `/decompile` | Decompile existing code into CLAUDE.md specification |
| Skill | `compile` | Auto-triggers on compile-related requests |
| Skill | `decompile` | Auto-triggers on decompile-related requests |
| Agent | `codex` | Bidirectional compiler agent |

## Project Structure

```
my-marketplace/
├── .claude-plugin/marketplace.json     # Claude Code marketplace manifest
├── plugins/codex/                      # codex plugin
│   ├── .claude-plugin/plugin.json
│   ├── skills/
│   ├── commands/
│   └── agents/
├── .opencode/                          # opencode compatibility
│   ├── opencode.json
│   ├── commands/
│   └── prompts/agents/
└── package.json
```

## Adding a New Plugin

1. Create a directory under `plugins/<plugin-name>/`
2. Add `.claude-plugin/plugin.json` with name, version, description
3. Add skills, commands, and agents as `.md` files
4. Register the plugin in `.claude-plugin/marketplace.json`
5. Mirror commands and agents in `.opencode/` for opencode compatibility

## License

MIT
