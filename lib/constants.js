const path = require("node:path");

const OPENCODE_DIR = ".opencode";
const OPENCODE_SKILLS_DIR = path.join(OPENCODE_DIR, "skills");
const OPENCODE_COMMANDS_DIR = path.join(OPENCODE_DIR, "commands");
const OPENCODE_AGENTS_DIR = path.join(OPENCODE_DIR, "agents");
const OPENCODE_PLUGINS_DIR = path.join(OPENCODE_DIR, "plugins");
const LEGACY_CACHE_DIR = path.join(OPENCODE_PLUGINS_DIR, "cache");

const MANAGED_MARKER = ".ombc-managed";
const LEGACY_MANAGED_MARKER = ".my-marketplace-managed";
const REGISTRY_FILE = path.join(OPENCODE_DIR, ".ombc-registry.json");
const LEGACY_REGISTRY_FILE = path.join(OPENCODE_DIR, ".my-marketplace-registry.json");

const DISCOVERY_DIR_NAMES = Object.freeze(["skills", "commands", "agents"]);

const COPY_EXCLUDE = new Set([".git", "node_modules", ".DS_Store"]);
const SKIP_DIRS = new Set([
  ".git",
  ".github",
  ".claude",
  "node_modules",
  ".DS_Store",
  ...DISCOVERY_DIR_NAMES,
]);

const MODEL_ALIASES = {
  opus: "anthropic/claude-opus-4-5",
  sonnet: "anthropic/claude-sonnet-4-5",
  haiku: "anthropic/claude-haiku-4-5",
};

module.exports = {
  OPENCODE_DIR,
  OPENCODE_SKILLS_DIR,
  OPENCODE_COMMANDS_DIR,
  OPENCODE_AGENTS_DIR,
  OPENCODE_PLUGINS_DIR,
  LEGACY_CACHE_DIR,
  MANAGED_MARKER,
  LEGACY_MANAGED_MARKER,
  REGISTRY_FILE,
  LEGACY_REGISTRY_FILE,
  DISCOVERY_DIR_NAMES,
  COPY_EXCLUDE,
  SKIP_DIRS,
  MODEL_ALIASES,
};
