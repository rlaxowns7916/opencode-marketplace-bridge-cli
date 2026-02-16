const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  OPENCODE_DIR,
  OPENCODE_SKILLS_DIR,
  OPENCODE_COMMANDS_DIR,
  OPENCODE_AGENTS_DIR,
  OPENCODE_PLUGINS_DIR,
  LEGACY_CACHE_DIR,
  MANAGED_MARKER,
} = require("./constants");
const {
  ensureDir,
  removePath,
  listDirectories,
  resolveRealPath,
  copyDir,
} = require("./filesystem");
const { resolveSource, parseMarketplace } = require("./marketplace");
const { buildDependencyGraph } = require("./reference-scanner");
const { transformContent } = require("./content-transform");
const { readMarkerOwner, writeMarker } = require("./ownership");
const { readRegistry, writeRegistry } = require("./registry");
const { installFlatMdDir, uninstallFlatMdFiles } = require("./flat-md");
const {
  formatInstallReport,
  formatMarketplaceListReport,
  formatUpdateReport,
} = require("./report");

function normalizePluginSource(pluginSource = "./") {
  if (typeof pluginSource !== "string") {
    throw new Error("Invalid plugin source: expected string");
  }
  return pluginSource.replace(/^\.\//, "").replace(/\/$/, "");
}

function isPathWithin(baseDir, candidatePath) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(resolvedBase, resolvedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolvePluginRoot(sourceDir, pluginSource = "./") {
  const sourceRoot = path.resolve(sourceDir);
  const sourceRootRealPath = resolveRealPath(sourceRoot) || sourceRoot;
  const pluginSourceNorm = normalizePluginSource(pluginSource);
  const pluginRoot = path.resolve(sourceRoot, pluginSourceNorm || ".");

  if (!fs.existsSync(pluginRoot)) {
    throw new Error(`Invalid plugin source "${pluginSource}": path does not exist`);
  }
  const pluginRootRealPath = resolveRealPath(pluginRoot);
  if (!pluginRootRealPath) {
    throw new Error(`Invalid plugin source "${pluginSource}": path is not readable`);
  }

  if (!isPathWithin(sourceRootRealPath, pluginRootRealPath)) {
    throw new Error(`Invalid plugin source "${pluginSource}": path must stay within marketplace root`);
  }

  const sourceRelativePath = path.relative(sourceRoot, pluginRoot);
  return {
    pluginRoot,
    pluginSourceNorm: sourceRelativePath === "" ? "" : sourceRelativePath,
  };
}

function pushUnique(list, value) {
  if (!list.includes(value)) {
    list.push(value);
  }
}

function canOverwriteManagedPath(targetDir, markerPath, marketplaceName, force) {
  if (!fs.existsSync(targetDir)) {
    return true;
  }
  const owner = readMarkerOwner(markerPath);
  if (owner === null) return false;
  if (owner !== marketplaceName && !force) return false;
  return true;
}

function removeInstalledSkills(projectRoot, skillNames, marketplaceName) {
  const targetSkillsRoot = path.join(projectRoot, OPENCODE_SKILLS_DIR);
  for (const skillName of skillNames || []) {
    const skillDir = path.join(targetSkillsRoot, skillName);
    const markerPath = path.join(skillDir, MANAGED_MARKER);
    const owner = readMarkerOwner(markerPath);
    if (owner === marketplaceName || owner === "__unknown__") {
      removePath(skillDir);
    }
  }
}

function removePlacedDirectories(projectRoot, placedDirs, ownerName) {
  for (const placedDir of placedDirs || []) {
    const fullDir = path.join(projectRoot, placedDir);
    const marker = path.join(fullDir, MANAGED_MARKER);
    const owner = readMarkerOwner(marker);
    if (owner === ownerName || owner === "__unknown__") {
      removePath(fullDir);
    }
  }
}

function copyReachableFiles(options) {
  const {
    pluginRoot,
    projectRoot,
    pluginName,
    marketplaceName,
    reachableFiles,
    force,
    contentTransform,
  } = options;

  const targetBase = path.join(projectRoot, OPENCODE_DIR, pluginName);
  const markerPath = path.join(targetBase, MANAGED_MARKER);

  if (!canOverwriteManagedPath(targetBase, markerPath, marketplaceName, force)) {
    return [];
  }

  removePath(targetBase);

  for (const relFile of reachableFiles) {
    const sourcePath = path.join(pluginRoot, relFile);
    const targetPath = path.join(targetBase, relFile);

    ensureDir(path.dirname(targetPath));

    if (typeof contentTransform === "function") {
      const transformed = contentTransform(sourcePath);
      if (typeof transformed === "string") {
        fs.writeFileSync(targetPath, transformed, "utf8");
        continue;
      }
    }

    fs.copyFileSync(sourcePath, targetPath);
  }

  if (reachableFiles.size > 0 || reachableFiles.length > 0) {
    ensureDir(targetBase);
    writeMarker(markerPath, marketplaceName);
    return [path.join(OPENCODE_DIR, pluginName)];
  }

  return [];
}

async function cloneToTempDir(url) {
  const simpleGit = require("simple-git");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ombc-"));

  try {
    await simpleGit().clone(url, tmpDir, ["--depth", "1"]);
    return tmpDir;
  } catch (error) {
    removePath(tmpDir);
    throw new Error(`Failed to clone ${url}: ${error.message}`);
  }
}

function normalizePluginSelection(pluginSelection) {
  if (pluginSelection === null || pluginSelection === undefined) {
    return {
      selectedPluginNames: null,
      reportLabel: null,
    };
  }

  if (typeof pluginSelection === "string") {
    const trimmed = pluginSelection.trim();
    if (!trimmed) {
      return {
        selectedPluginNames: null,
        reportLabel: null,
      };
    }
    return {
      selectedPluginNames: new Set([trimmed]),
      reportLabel: trimmed,
    };
  }

  if (Array.isArray(pluginSelection)) {
    const selected = pluginSelection
      .map((name) => (typeof name === "string" ? name.trim() : ""))
      .filter(Boolean);

    if (selected.length === 0) {
      return {
        selectedPluginNames: null,
        reportLabel: null,
      };
    }

    const uniqueSelected = [...new Set(selected)];
    return {
      selectedPluginNames: new Set(uniqueSelected),
      reportLabel: uniqueSelected.join(", "),
    };
  }

  throw new Error("Invalid plugin filter: expected string or string[]");
}

async function install(source, pluginFilter, projectRoot = process.cwd(), options = {}) {
  const { force = false, expectedMarketplaceName = null } = options;
  const resolved = resolveSource(source);

  let sourceDir;
  let tmpDir;

  if (resolved.type === "local") {
    if (!fs.existsSync(resolved.path)) {
      throw new Error(`Local path not found: ${resolved.path}`);
    }
    sourceDir = resolved.path;
  } else {
    tmpDir = await cloneToTempDir(resolved.url);
    sourceDir = tmpDir;
  }

  try {
    const marketplace = parseMarketplace(sourceDir);
    const marketplaceName = marketplace.name || path.basename(source);
    const marketplaceRoot = resolveRealPath(sourceDir) || path.resolve(sourceDir);

    if (expectedMarketplaceName && expectedMarketplaceName !== marketplaceName) {
      throw new Error(
        `Marketplace name mismatch for source "${resolved.source}": expected "${expectedMarketplaceName}", got "${marketplaceName}"`,
      );
    }

    let plugins = marketplace.plugins;
    const { selectedPluginNames, reportLabel } = normalizePluginSelection(pluginFilter);
    if (selectedPluginNames) {
      plugins = plugins.filter((plugin) => selectedPluginNames.has(plugin.name));
      if (plugins.length === 0) {
        throw new Error(`Plugin "${reportLabel}" not found in marketplace`);
      }
    }

    const registry = readRegistry(projectRoot);
    const existing = registry.installations[marketplaceName];

    if (existing) {
      removeInstalledSkills(projectRoot, existing.skills, marketplaceName);
      uninstallFlatMdFiles(path.join(projectRoot, OPENCODE_COMMANDS_DIR), existing.commands);
      uninstallFlatMdFiles(path.join(projectRoot, OPENCODE_AGENTS_DIR), existing.agents);
      if (existing.cacheDir) {
        removePath(path.join(projectRoot, existing.cacheDir));
      }
      removePlacedDirectories(projectRoot, existing.placedDirs, marketplaceName);
    }

    const allSkills = [];
    const allCommands = [];
    const allAgents = [];
    const allPluginNames = [];
    const allPlacedDirs = [];

    for (const plugin of plugins) {
      const pluginName = plugin.name;
      allPluginNames.push(pluginName);

      const {
        pluginSourceNorm,
        pluginRoot,
      } = resolvePluginRoot(sourceDir, plugin.source || "./");

      // --- Build dependency graph and selectively copy reachable files ---
      const { reachableFiles, reachableDirs } = buildDependencyGraph(pluginRoot, {
        allowedRoot: marketplaceRoot,
        strictSymlinkBoundary: true,
      });

      const copiedDirs = [...reachableDirs];

      const contentTransform = (filePath) => {
        if (!filePath.endsWith(".md")) return null;
        return transformContent(fs.readFileSync(filePath, "utf8"), {
          pluginSourceNorm,
          pluginName,
          copiedDirs,
        });
      };

      const placedDirs = copyReachableFiles({
        pluginRoot,
        projectRoot,
        pluginName,
        marketplaceName,
        reachableFiles,
        force,
        contentTransform,
      });
      for (const dir of placedDirs) pushUnique(allPlacedDirs, dir);

      // --- Skills ---
      const sourceSkillsRoot = path.join(pluginRoot, "skills");
      const targetSkillsRoot = path.join(projectRoot, OPENCODE_SKILLS_DIR);
      if (fs.existsSync(sourceSkillsRoot)) {
        ensureDir(targetSkillsRoot);
        const skillNames = listDirectories(sourceSkillsRoot, {
          allowedRoot: marketplaceRoot,
          strictSymlinkBoundary: true,
        });

        for (const skillName of skillNames) {
          const sourceSkillDir = path.join(sourceSkillsRoot, skillName);
          const targetSkillDir = path.join(targetSkillsRoot, skillName);
          const markerPath = path.join(targetSkillDir, MANAGED_MARKER);

          if (fs.existsSync(targetSkillDir)) {
            const owner = readMarkerOwner(markerPath);
            if (owner === null) {
              process.stderr.write(`Skipping skill ${skillName}: user-managed skill exists\n`);
              continue;
            }
            if (owner !== marketplaceName && !force) {
              const ownerLabel = owner === "__unknown__" ? "another marketplace" : owner;
              process.stderr.write(`Skipping skill ${skillName}: owned by ${ownerLabel} (use --force to overwrite)\n`);
              continue;
            }
          }

          removePath(targetSkillDir);
          copyDir(sourceSkillDir, targetSkillDir, contentTransform, null, {
            allowedRoot: marketplaceRoot,
            strictSymlinkBoundary: true,
          });

          writeMarker(markerPath, marketplaceName);
          pushUnique(allSkills, skillName);
        }
      }

      // --- Commands ---
      const sourceCommandsRoot = path.join(pluginRoot, "commands");
      const targetCommandsRoot = path.join(projectRoot, OPENCODE_COMMANDS_DIR);
      const installedCommands = installFlatMdDir(
        sourceCommandsRoot,
        targetCommandsRoot,
        registry,
        "commands",
        {
          marketplaceName,
          force,
          currentOwnedNames: allCommands,
          sourceRoot: marketplaceRoot,
          strictSymlinkBoundary: true,
          contentTransform: (raw) => transformContent(raw, {
            pluginSourceNorm,
            pluginName,
            copiedDirs,
          }),
        },
      );
      for (const commandName of installedCommands) {
        pushUnique(allCommands, commandName);
      }

      // --- Agents ---
      const sourceAgentsRoot = path.join(pluginRoot, "agents");
      const targetAgentsRoot = path.join(projectRoot, OPENCODE_AGENTS_DIR);
      const installedAgents = installFlatMdDir(
        sourceAgentsRoot,
        targetAgentsRoot,
        registry,
        "agents",
        {
          marketplaceName,
          force,
          currentOwnedNames: allAgents,
          sourceRoot: marketplaceRoot,
          strictSymlinkBoundary: true,
          contentTransform: (raw) => transformContent(raw, {
            pluginSourceNorm,
            pluginName,
            copiedDirs,
          }),
        },
      );
      for (const agentName of installedAgents) {
        pushUnique(allAgents, agentName);
      }
    }

    const now = new Date().toISOString();
    registry.installations[marketplaceName] = {
      source: resolved.source,
      plugins: allPluginNames,
      skills: allSkills,
      commands: allCommands,
      agents: allAgents,
      placedDirs: allPlacedDirs,
      installedAt: existing?.installedAt || now,
      lastUpdated: now,
    };
    writeRegistry(projectRoot, registry);

    console.log(formatInstallReport({
      marketplaceName,
      source: resolved.source,
      pluginFilter: reportLabel,
      plugins: allPluginNames,
      placedDirs: allPlacedDirs,
      skills: allSkills,
      commands: allCommands,
      agents: allAgents,
    }));
  } finally {
    if (tmpDir) {
      removePath(tmpDir);
    }
  }
}

function removeEmptyParentsUntilRoot(targetPath, projectRoot) {
  let parent = path.dirname(targetPath);
  while (parent !== projectRoot && fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
    removePath(parent);
    parent = path.dirname(parent);
  }
}

function uninstall(name, projectRoot = process.cwd()) {
  const registry = readRegistry(projectRoot);
  if (!registry.installations[name]) {
    process.stderr.write(`"${name}" is not installed\n`);
    return;
  }

  const entry = registry.installations[name];
  removeInstalledSkills(projectRoot, entry.skills, name);
  uninstallFlatMdFiles(path.join(projectRoot, OPENCODE_COMMANDS_DIR), entry.commands);
  uninstallFlatMdFiles(path.join(projectRoot, OPENCODE_AGENTS_DIR), entry.agents);

  for (const placedDir of entry.placedDirs || []) {
    const fullDir = path.join(projectRoot, placedDir);
    const marker = path.join(fullDir, MANAGED_MARKER);
    const owner = readMarkerOwner(marker);
    if (owner === name || owner === "__unknown__") {
      removePath(fullDir);
      removeEmptyParentsUntilRoot(fullDir, projectRoot);
    }
  }

  if (entry.cacheDir) {
    removePath(path.join(projectRoot, entry.cacheDir));
  }

  // Legacy cleanup
  for (const pluginName of entry.plugins || []) {
    const bundleDir = path.join(projectRoot, OPENCODE_DIR, pluginName);
    if (fs.existsSync(bundleDir) && fs.readdirSync(bundleDir).length === 0) {
      removePath(bundleDir);
    }
  }

  const pluginsCacheDir = path.join(projectRoot, LEGACY_CACHE_DIR);
  if (fs.existsSync(pluginsCacheDir) && fs.readdirSync(pluginsCacheDir).length === 0) {
    removePath(pluginsCacheDir);
    const pluginsDir = path.join(projectRoot, OPENCODE_PLUGINS_DIR);
    if (fs.existsSync(pluginsDir) && fs.readdirSync(pluginsDir).length === 0) {
      removePath(pluginsDir);
    }
  }

  delete registry.installations[name];
  writeRegistry(projectRoot, registry);
  console.log(`Uninstalled ${name}`);
}

function list(projectRoot = process.cwd()) {
  const registry = readRegistry(projectRoot);
  const entries = Object.entries(registry.installations);
  console.log(formatMarketplaceListReport(entries));
}

async function update(projectRoot = process.cwd(), options = {}) {
  const { force = false } = options;
  const registry = readRegistry(projectRoot);
  const entries = Object.entries(registry.installations);

  if (entries.length === 0) {
    const summary = { updated: [], failed: [] };
    console.log(formatUpdateReport(summary));
    return summary;
  }

  const summary = {
    updated: [],
    failed: [],
  };

  for (const [marketplaceName, entry] of entries) {
    try {
      if (!entry || typeof entry.source !== "string" || !entry.source.trim()) {
        throw new Error("Registry entry is missing source");
      }

      const pluginFilters = Array.isArray(entry.plugins) && entry.plugins.length > 0
        ? entry.plugins
        : null;

      await install(entry.source, pluginFilters, projectRoot, {
        force,
        expectedMarketplaceName: marketplaceName,
      });

      summary.updated.push(marketplaceName);
    } catch (error) {
      summary.failed.push({
        marketplaceName,
        error: String(error.message || error),
      });
    }
  }

  console.log(formatUpdateReport(summary));
  return summary;
}

module.exports = {
  install,
  uninstall,
  list,
  update,
};
