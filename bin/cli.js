#!/usr/bin/env node

const { LEGACY_CACHE_DIR } = require("../lib/constants");
const {
  readJson,
  ensureDir,
  removePath,
  listDirectories,
  listMdFiles,
  copyDir,
} = require("../lib/filesystem");
const {
  normalizeToolsField,
  normalizeModelField,
  transformContent,
} = require("../lib/content-transform");
const {
  filterMdContent,
  findReferencedDirs,
  findOpencodePluginReferencedDirs,
  extractFileReferences,
  buildDependencyGraph,
} = require("../lib/reference-scanner");
const { readMarkerOwner, writeMarker } = require("../lib/ownership");
const { resolveSource, parseMarketplace } = require("../lib/marketplace");
const {
  readRegistry,
  writeRegistry,
  getRegistryFileOwners,
} = require("../lib/registry");
const { installFlatMdDir, uninstallFlatMdFiles } = require("../lib/flat-md");
const { install, uninstall, list } = require("../lib/install-service");
const {
  formatInstallReport,
  formatMarketplaceListReport,
} = require("../lib/report");

const CLI_COMMANDS = Object.freeze({
  INSTALL: "install",
  UNINSTALL: "uninstall",
  LIST: "list",
});

function printHelp() {
  console.log([
    "ombc CLI — OpenCode bridge for Claude Code marketplaces",
    "",
    "Usage:",
    "  ombc install <source> [plugin] [--force]  Install marketplace/plugin",
    "  ombc uninstall <name>                     Uninstall marketplace",
    "  ombc list                                 List installed marketplaces",
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
  ].join("\n"));
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];

  if (!command || command === "-h" || command === "--help") {
    printHelp();
    return;
  }

  try {
    if (command === CLI_COMMANDS.INSTALL) {
      const args = argv.slice(1);
      const force = args.includes("--force");
      const positional = args.filter((arg) => !arg.startsWith("--"));
      const source = positional[0];

      if (!source) {
        console.error("Error: source is required");
        console.error("Usage: ombc install <source> [plugin] [--force]");
        process.exit(1);
      }

      const pluginFilter = positional[1] || null;
      await install(source, pluginFilter, process.cwd(), { force });
      return;
    }

    if (command === CLI_COMMANDS.UNINSTALL) {
      const name = argv[1];
      if (!name) {
        console.error("Error: name is required");
        console.error("Usage: ombc uninstall <name>");
        process.exit(1);
      }
      uninstall(name);
      return;
    }

    if (command === CLI_COMMANDS.LIST) {
      list();
      return;
    }

    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  readJson,
  ensureDir,
  removePath,
  listDirectories,
  listMdFiles,
  copyDir,
  normalizeToolsField,
  normalizeModelField,
  filterMdContent,
  findReferencedDirs,
  findOpencodePluginReferencedDirs,
  extractFileReferences,
  buildDependencyGraph,
  transformContent,
  readMarkerOwner,
  writeMarker,
  resolveSource,
  parseMarketplace,
  readRegistry,
  writeRegistry,
  getRegistryFileOwners,
  installFlatMdDir,
  uninstallFlatMdFiles,
  install,
  uninstall,
  list,
  formatInstallReport,
  formatMarketplaceListReport,
  main,
  LEGACY_CACHE_DIR,
};
