const PROCESS_ARG_OFFSET = 2;

const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  FAILURE: 1,
});

const COMMANDS = Object.freeze({
  INSTALL: "install",
  UNINSTALL: "uninstall",
  LIST: "list",
  UPDATE: "update",
  HELP: "help",
});

const FLAGS = Object.freeze({
  HELP_SHORT: "-h",
  HELP_LONG: "--help",
  FORCE: "--force",
});

const ARG_INDEX = Object.freeze({
  COMMAND: 0,
  FIRST_ARG: 1,
  INSTALL_SOURCE: 0,
  INSTALL_PLUGIN: 1,
  UNINSTALL_NAME: 1,
});

const USAGE = Object.freeze({
  INSTALL: "Usage: ombc install <source> [plugin] [--force]",
  UNINSTALL: "Usage: ombc uninstall <name>",
  UPDATE: "Usage: ombc update [--force]",
});

const HELP_LINES = Object.freeze([
  "ombc CLI — OpenCode bridge for Claude Code marketplaces",
  "",
  "Usage:",
  "  ombc install <source> [plugin] [--force]  Install marketplace/plugin",
  "  ombc uninstall <name>                     Uninstall marketplace",
  "  ombc list                                 List installed marketplaces",
  "  ombc update [--force]                     Update installed marketplaces",
  "",
  "Copies skills, commands, agents to .opencode/ for auto-discovery.",
  "Referenced directories (rules, etc.) are placed at their original paths.",
  "",
  "Source formats:",
  "  owner/repo                 GitHub shorthand",
  "  https://github.com/...     Git URL",
  "  /path/to/local             Local directory",
  "",
  "Options:",
  "  --force      Overwrite files owned by other marketplaces (user files always protected)",
  "  -h, --help   Show this help",
]);

module.exports = {
  PROCESS_ARG_OFFSET,
  EXIT_CODES,
  COMMANDS,
  FLAGS,
  ARG_INDEX,
  USAGE,
  HELP_LINES,
};
