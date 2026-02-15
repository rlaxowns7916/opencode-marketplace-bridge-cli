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
  COPY_EXCLUDE,
} = require("./constants");
const {
  ensureDir,
  removePath,
  listDirectories,
  resolveRealPath,
  copyDir,
} = require("./filesystem");
const { resolveSource, parseMarketplace } = require("./marketplace");
const {
  findReferencedDirs,
  findOpencodePluginReferencedDirs,
} = require("./reference-scanner");
const { transformContent } = require("./content-transform");
const { readMarkerOwner, writeMarker } = require("./ownership");
const { readRegistry, writeRegistry } = require("./registry");
const { installFlatMdDir, uninstallFlatMdFiles } = require("./flat-md");
const { formatInstallReport, formatMarketplaceListReport } = require("./report");

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

function placeManagedDirectory(options) {
  const {
    sourceDir,
    projectRoot,
    relativePath,
    marketplaceName,
    force,
    placedDirs,
    sourceRoot,
  } = options;
  const fullTargetDir = path.resolve(projectRoot, relativePath);
  if (!isPathWithin(projectRoot, fullTargetDir)) {
    throw new Error(`Invalid install target path "${relativePath}": path must stay within project root`);
  }
  const markerPath = path.join(fullTargetDir, MANAGED_MARKER);

  if (!canOverwriteManagedPath(fullTargetDir, markerPath, marketplaceName, force)) {
    return;
  }

  removePath(fullTargetDir);
  copyDir(sourceDir, fullTargetDir, null, COPY_EXCLUDE, {
    allowedRoot: sourceRoot,
    strictSymlinkBoundary: true,
  });
  writeMarker(markerPath, marketplaceName);
  pushUnique(placedDirs, relativePath);
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

async function install(source, pluginFilter, projectRoot = process.cwd(), options = {}) {
  const { force = false } = options;
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

    let plugins = marketplace.plugins;
    if (pluginFilter) {
      plugins = plugins.filter((plugin) => plugin.name === pluginFilter);
      if (plugins.length === 0) {
        throw new Error(`Plugin "${pluginFilter}" not found in marketplace`);
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

      const referencedDirs = findReferencedDirs(pluginRoot);
      for (const dir of referencedDirs) {
        const placedRelPath = pluginSourceNorm ? path.join(pluginSourceNorm, dir) : dir;
        placeManagedDirectory({
          sourceDir: path.join(pluginRoot, dir),
          projectRoot,
          relativePath: placedRelPath,
          marketplaceName,
          force,
          placedDirs: allPlacedDirs,
          sourceRoot: marketplaceRoot,
        });
      }

      const opencodePluginRefs = findOpencodePluginReferencedDirs(pluginRoot);
      for (const ref of opencodePluginRefs) {
        const bundledRefDir = path.join(pluginRoot, "plugins", ref.bundle, ref.dir);
        const sourceRefDir = fs.existsSync(bundledRefDir)
          ? bundledRefDir
          : path.join(pluginRoot, ref.dir);

        if (!fs.existsSync(sourceRefDir)) continue;

        const placedRelPath = path.join(OPENCODE_PLUGINS_DIR, ref.bundle, ref.dir);
        placeManagedDirectory({
          sourceDir: sourceRefDir,
          projectRoot,
          relativePath: placedRelPath,
          marketplaceName,
          force,
          placedDirs: allPlacedDirs,
          sourceRoot: marketplaceRoot,
        });
      }

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
          copyDir(sourceSkillDir, targetSkillDir, (filePath) => {
            if (!filePath.endsWith(".md")) return null;
            return transformContent(fs.readFileSync(filePath, "utf8"));
          }, null, {
            allowedRoot: marketplaceRoot,
            strictSymlinkBoundary: true,
          });

          writeMarker(markerPath, marketplaceName);
          pushUnique(allSkills, skillName);
        }
      }

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
        },
      );
      for (const commandName of installedCommands) {
        pushUnique(allCommands, commandName);
      }

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
      pluginFilter,
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

module.exports = {
  install,
  uninstall,
  list,
};
