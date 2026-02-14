#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const OPENCODE_DIR = ".opencode";
const OPENCODE_SKILLS_DIR = path.join(OPENCODE_DIR, "skills");
const OPENCODE_COMMANDS_DIR = path.join(OPENCODE_DIR, "commands");
const OPENCODE_AGENTS_DIR = path.join(OPENCODE_DIR, "agents");
const CACHE_DIR = path.join(OPENCODE_DIR, "plugins", "cache");
const MANAGED_MARKER = ".ombc-managed";
const LEGACY_MANAGED_MARKER = ".my-marketplace-managed";
const REGISTRY_FILE = path.join(OPENCODE_DIR, ".ombc-registry.json");
const LEGACY_REGISTRY_FILE = path.join(OPENCODE_DIR, ".my-marketplace-registry.json");
const COPY_EXCLUDE = new Set([".git", "node_modules", ".DS_Store"]);

// --- Utility functions ---

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return null;
  }
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmpPath, filePath);
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function removePath(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}

function listDirectories(target) {
  if (!fs.existsSync(target)) return [];
  return fs
    .readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listMdFiles(target) {
  if (!fs.existsSync(target)) return [];
  return fs
    .readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
}

function copyDir(source, target, transformFile, exclude) {
  ensureDir(target);

  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude && exclude.has(entry.name)) continue;

    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath, transformFile, exclude);
      continue;
    }

    if (entry.isFile()) {
      if (typeof transformFile === "function") {
        const transformed = transformFile(sourcePath);
        if (typeof transformed === "string") {
          fs.writeFileSync(targetPath, transformed, "utf8");
          continue;
        }
      }
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

// --- Source resolution ---

function resolveSource(source) {
  if (/^[^/\\:@]+\/[^/\\]+$/.test(source) && !source.startsWith(".")) {
    return { type: "github", url: `https://github.com/${source}.git`, source };
  }
  if (/^https?:\/\//i.test(source) || /^git@/i.test(source)) {
    return { type: "url", url: source, source };
  }
  return { type: "local", path: path.resolve(source), source };
}

// --- Marketplace parsing ---

function parseMarketplace(repoDir) {
  const marketplacePath = path.join(repoDir, ".claude-plugin", "marketplace.json");
  if (!fs.existsSync(marketplacePath)) {
    throw new Error(`No .claude-plugin/marketplace.json found in ${repoDir}`);
  }

  const data = readJson(marketplacePath);
  if (!data) {
    throw new Error("Invalid marketplace.json: failed to parse JSON");
  }
  if (!Array.isArray(data.plugins)) {
    throw new Error("Invalid marketplace.json: plugins array is missing");
  }

  return data;
}

// --- Smart cache: scan .md files to find referenced directories ---

function collectMdContent(dir) {
  let content = "";
  if (!fs.existsSync(dir)) return content;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      content += collectMdContent(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      content += "\n" + fs.readFileSync(fullPath, "utf8");
    }
  }
  return content;
}

const SKIP_DIRS = new Set([".git", ".github", ".claude", "node_modules", ".DS_Store", "skills", "commands", "agents"]);

function filterMdContent(raw) {
  let inCodeBlock = false;
  return raw
    .split("\n")
    .filter((line) => {
      // Track fenced code blocks (``` ... ```)
      if (/^\s*```/.test(line)) {
        inCodeBlock = !inCodeBlock;
        return false;
      }
      if (inCodeBlock) return false;

      const trimmed = line.trimStart();
      // Skip tree diagram lines: ├── docs/  └── tests/  │   hooks/
      if (/^[│├└─\s]*[├└]──/.test(line)) return false;
      // Skip markdown table rows: | `hooks/` | description |
      if (/^\s*\|/.test(trimmed)) return false;
      // Skip comment-only lines: # .github/workflows/e2e.yml  // tests/foo.cpp
      if (/^\s*#\s/.test(trimmed)) return false;
      if (/^\/\//.test(trimmed)) return false;
      // Skip URL lines: https://nextjs.org/docs/security
      if (/https?:\/\//.test(trimmed)) return false;
      // Skip home dir references: ~/.claude/skills/...
      if (/~\//.test(trimmed)) return false;
      return true;
    })
    .join("\n");
}

function findReferencedDirs(pluginRoot) {
  const allTopLevel = listDirectories(pluginRoot).filter((d) => !SKIP_DIRS.has(d));
  if (allTopLevel.length === 0) return [];

  let mdContent = "";
  for (const dir of ["skills", "commands", "agents"]) {
    mdContent += collectMdContent(path.join(pluginRoot, dir));
  }
  if (!mdContent) return [];

  const filtered = filterMdContent(mdContent);

  return allTopLevel.filter((dir) => {
    const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|[\\s\`("'/])${escaped}/`, "m");
    return pattern.test(filtered);
  });
}

// --- Path rewriting ---

function rewriteCachedPaths(content, cachePrefix, cachedDirs) {
  if (!cachedDirs || cachedDirs.length === 0) return content;
  const escaped = cachedDirs.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?<=^|[\\s\`("'/])(?:${escaped.join("|")})/`, "gm");

  return content.replace(pattern, (match, offset) => {
    const lookbackStart = Math.max(0, offset - 200);
    const before = content.substring(lookbackStart, offset);
    if (/\.opencode\/\S*$/.test(before)) {
      return match;
    }
    const lineStart = content.lastIndexOf("\n", offset - 1) + 1;
    const lineBefore = content.substring(lineStart, offset);
    if (/https?:\/\/\S*$/.test(lineBefore)) {
      return match;
    }
    return cachePrefix + match;
  });
}

// --- YAML frontmatter normalization ---

function normalizeToolsField(content) {
  // OpenCode expects tools as a YAML record: tools:\n  read: true\n  grep: true
  // Claude Code uses either JSON array or comma-separated string.

  // Case 1: JSON array — tools: ["Read", "Grep", "Glob"]
  content = content.replace(
    /^tools:\s*\[([^\]]*)\]/m,
    (_match, items) => {
      const tools = items
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      if (tools.length === 0) return "tools:";
      return "tools:\n" + tools.map((t) => `  ${t.toLowerCase()}: true`).join("\n");
    },
  );

  // Case 2: Comma-separated string or single tool — tools: Read, Grep, Glob
  // Does NOT match record format (tools: followed by newline then indented keys)
  content = content.replace(
    /^tools:\s+([A-Za-z*][\w*]*(?:\s*,\s*[A-Za-z*][\w*]*)*)\s*$/m,
    (_match, items) => {
      const tools = items
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return "tools:\n" + tools.map((t) => `  ${t.toLowerCase()}: true`).join("\n");
    },
  );

  return content;
}

// --- Model name normalization ---

const MODEL_ALIASES = {
  opus: "anthropic/claude-opus-4-5",
  sonnet: "anthropic/claude-sonnet-4-5",
  haiku: "anthropic/claude-haiku-4-5",
};

function normalizeModelField(content) {
  return content.replace(/^(model:\s*)(\S+)\s*$/m, (_match, prefix, value) => {
    if (value.includes("/")) return _match;
    const mapped = MODEL_ALIASES[value.toLowerCase()];
    if (mapped) return `${prefix}${mapped}`;
    return _match;
  });
}

// Applies all content transformations: path rewrite + frontmatter normalization
function transformContent(content, cachePrefix, cachedDirs) {
  let result = rewriteCachedPaths(content, cachePrefix, cachedDirs);
  result = normalizeToolsField(result);
  result = normalizeModelField(result);
  return result;
}

// --- Marker ownership ---

function readMarkerOwner(markerPath) {
  if (!fs.existsSync(markerPath)) {
    if (path.basename(markerPath) === MANAGED_MARKER) {
      const legacyPath = path.join(path.dirname(markerPath), LEGACY_MANAGED_MARKER);
      if (fs.existsSync(legacyPath)) {
        markerPath = legacyPath;
      } else {
        return null;
      }
    } else {
      return null;
    }
  }
  const content = fs.readFileSync(markerPath, "utf8").trim();
  // Old format: "managed by my-marketplace" → unknown specific owner
  if (!content || content.includes(" ")) return "__unknown__";
  return content;
}

function writeMarker(markerPath, marketplaceName) {
  fs.writeFileSync(markerPath, marketplaceName + "\n", "utf8");
  const legacyPath = path.join(path.dirname(markerPath), LEGACY_MANAGED_MARKER);
  if (legacyPath !== markerPath && fs.existsSync(legacyPath)) {
    fs.unlinkSync(legacyPath);
  }
}

// --- Registry ---

function readRegistry(projectRoot) {
  const registryPath = path.join(projectRoot, REGISTRY_FILE);
  const registry = readJson(registryPath);
  if (registry && typeof registry === "object" && registry.installations) {
    return registry;
  }

  const legacyPath = path.join(projectRoot, LEGACY_REGISTRY_FILE);
  const legacy = readJson(legacyPath);
  if (legacy && typeof legacy === "object" && legacy.installations) {
    return legacy;
  }

  return { installations: {} };
}

function writeRegistry(projectRoot, registry) {
  const registryPath = path.join(projectRoot, REGISTRY_FILE);
  writeJsonAtomic(registryPath, registry);
  const legacyPath = path.join(projectRoot, LEGACY_REGISTRY_FILE);
  if (fs.existsSync(legacyPath)) {
    fs.unlinkSync(legacyPath);
  }
}

// Returns Map<name, ownerMarketplace> for a given type across all registry entries
function getRegistryFileOwners(registry, type) {
  const owners = new Map();
  for (const [marketplaceName, entry] of Object.entries(registry.installations)) {
    for (const name of entry[type] || []) {
      owners.set(name, marketplaceName);
    }
  }
  return owners;
}

// --- Install flat .md files (commands, agents) ---

function installFlatMdDir(sourceDir, targetDir, cachePrefix, cachedDirs, registry, registryType, opts = {}) {
  const { marketplaceName, force = false } = opts;
  const installed = [];
  if (!fs.existsSync(sourceDir)) return installed;

  const fileOwners = getRegistryFileOwners(registry, registryType);
  const mdFiles = listMdFiles(sourceDir);

  if (mdFiles.length > 0) {
    ensureDir(targetDir);
  }

  for (const fileName of mdFiles) {
    const baseName = path.basename(fileName, ".md");
    const targetPath = path.join(targetDir, fileName);
    const typeSingular = registryType.slice(0, -1);

    if (fs.existsSync(targetPath)) {
      const owner = fileOwners.get(baseName);
      if (!owner) {
        // User-managed: always protected
        process.stderr.write(`Skipping ${typeSingular} ${baseName}: user-managed file exists\n`);
        continue;
      }
      if (owner !== marketplaceName && !force) {
        // Owned by another marketplace: skip without --force
        process.stderr.write(`Skipping ${typeSingular} ${baseName}: owned by ${owner} (use --force to overwrite)\n`);
        continue;
      }
    }

    const content = fs.readFileSync(path.join(sourceDir, fileName), "utf8");
    fs.writeFileSync(targetPath, transformContent(content, cachePrefix, cachedDirs), "utf8");
    installed.push(baseName);
  }

  return installed;
}

// Remove flat .md files tracked in registry
function uninstallFlatMdFiles(targetDir, names) {
  for (const name of names || []) {
    const filePath = path.join(targetDir, `${name}.md`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

// --- Commands ---

async function install(source, pluginFilter, projectRoot = process.cwd(), options = {}) {
  const { force = false } = options;
  const resolved = resolveSource(source);

  // Step 1: Obtain source (local path or clone to tmpdir)
  let sourceDir;
  let tmpDir;

  if (resolved.type === "local") {
    if (!fs.existsSync(resolved.path)) {
      throw new Error(`Local path not found: ${resolved.path}`);
    }
    sourceDir = resolved.path;
  } else {
    const simpleGit = require("simple-git");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ombc-"));
    try {
      await simpleGit().clone(resolved.url, tmpDir, ["--depth", "1"]);
    } catch (error) {
      removePath(tmpDir);
      throw new Error(`Failed to clone ${resolved.url}: ${error.message}`);
    }
    sourceDir = tmpDir;
  }

  try {
    // Step 2: Parse marketplace
    const marketplace = parseMarketplace(sourceDir);
    const marketplaceName = marketplace.name || path.basename(source);

    // Step 3: Prepare cache (rules-only)
    const cacheDir = path.join(projectRoot, CACHE_DIR, marketplaceName);
    removePath(cacheDir);

    // Step 4: Filter plugins
    let plugins = marketplace.plugins;
    if (pluginFilter) {
      plugins = plugins.filter((p) => p.name === pluginFilter);
      if (plugins.length === 0) {
        throw new Error(`Plugin "${pluginFilter}" not found in marketplace`);
      }
    }

    const registry = readRegistry(projectRoot);

    // Clean up existing installation for idempotent reinstall (only OUR files)
    const existing = registry.installations[marketplaceName];
    if (existing) {
      // Clean up skills owned by THIS marketplace
      const targetSkillsRoot = path.join(projectRoot, OPENCODE_SKILLS_DIR);
      for (const skillName of existing.skills || []) {
        const skillDir = path.join(targetSkillsRoot, skillName);
        const markerPath = path.join(skillDir, MANAGED_MARKER);
        const owner = readMarkerOwner(markerPath);
        if (owner === marketplaceName || owner === "__unknown__") {
          removePath(skillDir);
        }
      }
      // Clean up commands/agents tracked by THIS marketplace
      uninstallFlatMdFiles(
        path.join(projectRoot, OPENCODE_COMMANDS_DIR),
        existing.commands,
      );
      uninstallFlatMdFiles(
        path.join(projectRoot, OPENCODE_AGENTS_DIR),
        existing.agents,
      );
    }

    // Step 5: Install each plugin from cache
    const allSkills = [];
    const allCommands = [];
    const allAgents = [];
    const allPluginNames = [];

    for (const plugin of plugins) {
      const pluginName = plugin.name;
      allPluginNames.push(pluginName);

      const pluginSource = plugin.source || "./";
      const pluginSourceNorm = pluginSource.replace(/^\.\//, "").replace(/\/$/, "");
      const pluginRoot = path.join(sourceDir, pluginSourceNorm || ".");

      // Smart cache: scan .md files to find referenced directories, cache only those
      const referencedDirs = findReferencedDirs(pluginRoot);
      const cachePluginDir = path.join(cacheDir, pluginSourceNorm || ".");
      for (const dir of referencedDirs) {
        copyDir(path.join(pluginRoot, dir), path.join(cachePluginDir, dir), null, COPY_EXCLUDE);
      }

      // Compute cache prefix for path rewriting
      const cacheRelSegments = [OPENCODE_DIR, "plugins", "cache", marketplaceName];
      if (pluginSourceNorm) cacheRelSegments.push(pluginSourceNorm);
      const cachePrefix = cacheRelSegments.join("/") + "/";
      const cachedDirs = referencedDirs;

      // --- Skills (directory-based, marker-managed) ---
      const sourceSkillsRoot = path.join(pluginRoot, "skills");
      const targetSkillsRoot = path.join(projectRoot, OPENCODE_SKILLS_DIR);

      if (fs.existsSync(sourceSkillsRoot)) {
        ensureDir(targetSkillsRoot);
        const skillNames = listDirectories(sourceSkillsRoot);

        for (const skillName of skillNames) {
          const sourceSkillDir = path.join(sourceSkillsRoot, skillName);
          const targetSkillDir = path.join(targetSkillsRoot, skillName);
          const markerPath = path.join(targetSkillDir, MANAGED_MARKER);

          if (fs.existsSync(targetSkillDir)) {
            const owner = readMarkerOwner(markerPath);
            if (owner === null) {
              // No marker → user-managed → always protected
              process.stderr.write(`Skipping skill ${skillName}: user-managed skill exists\n`);
              continue;
            }
            if (owner !== marketplaceName && !force) {
              // Owned by another marketplace → skip without --force
              const ownerLabel = owner === "__unknown__" ? "another marketplace" : owner;
              process.stderr.write(`Skipping skill ${skillName}: owned by ${ownerLabel} (use --force to overwrite)\n`);
              continue;
            }
          }

          removePath(targetSkillDir);

          copyDir(sourceSkillDir, targetSkillDir, (filePath) => {
            if (!filePath.endsWith(".md")) return null;
            const content = fs.readFileSync(filePath, "utf8");
            return transformContent(content, cachePrefix, cachedDirs);
          });

          writeMarker(markerPath, marketplaceName);
          allSkills.push(skillName);
        }
      }

      // --- Commands (flat .md files, registry-managed) ---
      const sourceCommandsRoot = path.join(pluginRoot, "commands");
      const targetCommandsRoot = path.join(projectRoot, OPENCODE_COMMANDS_DIR);
      const installedCommands = installFlatMdDir(
        sourceCommandsRoot, targetCommandsRoot, cachePrefix, cachedDirs, registry, "commands",
        { marketplaceName, force },
      );
      allCommands.push(...installedCommands);

      // --- Agents (flat .md files, registry-managed) ---
      const sourceAgentsRoot = path.join(pluginRoot, "agents");
      const targetAgentsRoot = path.join(projectRoot, OPENCODE_AGENTS_DIR);
      const installedAgents = installFlatMdDir(
        sourceAgentsRoot, targetAgentsRoot, cachePrefix, cachedDirs, registry, "agents",
        { marketplaceName, force },
      );
      allAgents.push(...installedAgents);
    }

    // Step 6: Update registry
    const now = new Date().toISOString();
    registry.installations[marketplaceName] = {
      source: resolved.source,
      plugins: allPluginNames,
      skills: allSkills,
      commands: allCommands,
      agents: allAgents,
      cacheDir: `${CACHE_DIR}/${marketplaceName}`,
      installedAt: existing?.installedAt || now,
      lastUpdated: now,
    };

    writeRegistry(projectRoot, registry);

    // Summary output
    const parts = [];
    if (allSkills.length > 0) parts.push(`skills: ${allSkills.join(", ")}`);
    if (allCommands.length > 0) parts.push(`commands: ${allCommands.join(", ")}`);
    if (allAgents.length > 0) parts.push(`agents: ${allAgents.join(", ")}`);
    console.log(`Installed ${marketplaceName}: ${parts.join(" | ") || "none"}`);
  } finally {
    if (tmpDir) {
      removePath(tmpDir);
    }
  }
}

function uninstall(name, projectRoot = process.cwd()) {
  const registry = readRegistry(projectRoot);

  if (!registry.installations[name]) {
    process.stderr.write(`"${name}" is not installed\n`);
    return;
  }

  const entry = registry.installations[name];

  // Remove managed skills (only those owned by this marketplace)
  const targetSkillsRoot = path.join(projectRoot, OPENCODE_SKILLS_DIR);
  for (const skillName of entry.skills || []) {
    const skillDir = path.join(targetSkillsRoot, skillName);
    const markerPath = path.join(skillDir, MANAGED_MARKER);
    const owner = readMarkerOwner(markerPath);
    if (owner === name || owner === "__unknown__") {
      removePath(skillDir);
    }
  }

  // Remove managed commands (registry-based)
  uninstallFlatMdFiles(
    path.join(projectRoot, OPENCODE_COMMANDS_DIR),
    entry.commands,
  );

  // Remove managed agents (registry-based)
  uninstallFlatMdFiles(
    path.join(projectRoot, OPENCODE_AGENTS_DIR),
    entry.agents,
  );

  // Remove cache directory
  if (entry.cacheDir) {
    removePath(path.join(projectRoot, entry.cacheDir));
  }

  // Backward compat: remove old-style rules directories
  for (const pluginName of entry.plugins || []) {
    const bundleDir = path.join(projectRoot, OPENCODE_DIR, pluginName);
    const rulesDir = path.join(bundleDir, "rules");
    if (fs.existsSync(rulesDir)) {
      removePath(rulesDir);
    }
    if (fs.existsSync(bundleDir) && fs.readdirSync(bundleDir).length === 0) {
      removePath(bundleDir);
    }
  }

  // Clean up empty parent directories
  const pluginsCacheDir = path.join(projectRoot, CACHE_DIR);
  if (fs.existsSync(pluginsCacheDir) && fs.readdirSync(pluginsCacheDir).length === 0) {
    removePath(pluginsCacheDir);
    const pluginsDir = path.join(projectRoot, OPENCODE_DIR, "plugins");
    if (fs.existsSync(pluginsDir) && fs.readdirSync(pluginsDir).length === 0) {
      removePath(pluginsDir);
    }
  }

  // Remove from registry
  delete registry.installations[name];
  writeRegistry(projectRoot, registry);

  console.log(`Uninstalled ${name}`);
}

function list(projectRoot = process.cwd()) {
  const registry = readRegistry(projectRoot);
  const entries = Object.entries(registry.installations);

  if (entries.length === 0) {
    console.log("No marketplaces installed.");
    return;
  }

  for (const [name, entry] of entries) {
    const plugins = (entry.plugins || []).join(", ");
    const parts = [];
    if ((entry.skills || []).length > 0) parts.push(`skills: ${entry.skills.join(", ")}`);
    if ((entry.commands || []).length > 0) parts.push(`commands: ${entry.commands.join(", ")}`);
    if ((entry.agents || []).length > 0) parts.push(`agents: ${entry.agents.join(", ")}`);
    console.log(`${name} (${plugins}): ${parts.join(" | ") || "none"}`);
  }
}

// --- CLI ---

function printHelp() {
  console.log([
    "ombc CLI — OpenCode bridge for Claude Code marketplaces",
    "",
    "Usage:",
    "  ombc install <source> [plugin] [--force]  Install marketplace/plugin",
    "  ombc uninstall <name>                     Uninstall marketplace",
    "  ombc list                                 List installed marketplaces",
    "",
    "Caches marketplaces in .opencode/plugins/cache/ and copies",
    "skills, commands, agents to .opencode/ for OpenCode auto-discovery.",
    "Rules remain in the cache and are referenced via rewritten paths.",
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
    if (command === "install") {
      const args = argv.slice(1);
      const force = args.includes("--force");
      const positional = args.filter((a) => !a.startsWith("--"));
      const source = positional[0];
      if (!source) {
        console.error("Error: source is required");
        console.error("Usage: ombc install <source> [plugin] [--force]");
        process.exit(1);
      }
      const pluginFilter = positional[1] || null;
      await install(source, pluginFilter, process.cwd(), { force });
    } else if (command === "uninstall") {
      const name = argv[1];
      if (!name) {
        console.error("Error: name is required");
        console.error("Usage: ombc uninstall <name>");
        process.exit(1);
      }
      uninstall(name);
    } else if (command === "list") {
      list();
    } else {
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
    }
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
  rewriteCachedPaths,
  normalizeToolsField,
  normalizeModelField,
  filterMdContent,
  findReferencedDirs,
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
  main,
  CACHE_DIR,
};
