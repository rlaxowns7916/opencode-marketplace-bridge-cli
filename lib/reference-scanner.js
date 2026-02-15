const fs = require("node:fs");
const path = require("node:path");

const { DISCOVERY_DIR_NAMES, SKIP_DIRS } = require("./constants");
const {
  listDirectories,
  resolveRealPath,
  isPathWithin,
  classifyDirentEntry,
} = require("./filesystem");

function collectMdContent(dir, options = {}) {
  const {
    allowedRoot = null,
    strictSymlinkBoundary = false,
    strictBrokenSymlink = false,
    activeRealDirs = new Set(),
  } = options;
  let content = "";
  if (!fs.existsSync(dir)) return content;

  const dirRealPath = resolveRealPath(dir);
  if (!dirRealPath) {
    if (strictBrokenSymlink) {
      throw new Error(`Broken source path: ${dir}`);
    }
    return content;
  }
  if (allowedRoot && !isPathWithin(allowedRoot, dirRealPath)) {
    if (strictSymlinkBoundary) {
      throw new Error(`Symbolic link escapes marketplace root: ${dir}`);
    }
    return content;
  }
  if (activeRealDirs.has(dirRealPath)) {
    return content;
  }
  activeRealDirs.add(dirRealPath);

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const entryKind = classifyDirentEntry(dir, entry, {
        allowedRoot,
        strictSymlinkBoundary,
        strictBrokenSymlink,
      });

      if (entryKind === "directory") {
        content += collectMdContent(fullPath, {
          allowedRoot,
          strictSymlinkBoundary,
          strictBrokenSymlink,
          activeRealDirs,
        });
        continue;
      }
      if (entryKind === "file" && entry.name.endsWith(".md")) {
        content += "\n" + fs.readFileSync(fullPath, "utf8");
      }
    }
  } finally {
    activeRealDirs.delete(dirRealPath);
  }

  return content;
}

function filterMdContent(raw) {
  let inCodeBlock = false;

  return raw
    .split("\n")
    .filter((line) => {
      if (/^\s*```/.test(line)) {
        inCodeBlock = !inCodeBlock;
        return false;
      }
      if (inCodeBlock) return false;

      const trimmed = line.trimStart();
      if (/^[│├└─\s]*[├└]──/.test(line)) return false;
      if (/^\s*\|/.test(trimmed)) return false;
      if (/^\s*#\s/.test(trimmed)) return false;
      if (/^\/\//.test(trimmed)) return false;
      if (/https?:\/\//.test(trimmed)) return false;
      if (/~\//.test(trimmed)) return false;
      return true;
    })
    .join("\n");
}

function scanReferenceContent(pluginRoot) {
  const allowedRoot = resolveRealPath(pluginRoot) || path.resolve(pluginRoot);
  const activeRealDirs = new Set();
  let mdContent = "";
  for (const dir of DISCOVERY_DIR_NAMES) {
    mdContent += collectMdContent(path.join(pluginRoot, dir), {
      allowedRoot,
      strictSymlinkBoundary: true,
      activeRealDirs,
    });
  }
  if (!mdContent) return "";
  return filterMdContent(mdContent);
}

function findReferencedDirs(pluginRoot) {
  const allTopLevel = listDirectories(pluginRoot, {
    allowedRoot: pluginRoot,
    strictSymlinkBoundary: true,
  }).filter((dir) => !SKIP_DIRS.has(dir));
  if (allTopLevel.length === 0) return [];

  const filteredContent = scanReferenceContent(pluginRoot);
  if (!filteredContent) return [];

  return allTopLevel.filter((dir) => {
    const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|[\\s\`("'@\\[])(?:\\./)?${escaped}/`, "m");
    return pattern.test(filteredContent);
  });
}

function findOpencodePluginReferencedDirs(pluginRoot) {
  const filteredContent = scanReferenceContent(pluginRoot);
  if (!filteredContent) return [];

  const allowedRoot = resolveRealPath(pluginRoot) || path.resolve(pluginRoot);

  function hasAllowedDirectory(targetPath) {
    if (!fs.existsSync(targetPath)) return false;
    const targetRealPath = resolveRealPath(targetPath);
    if (!targetRealPath) return false;
    if (!isPathWithin(allowedRoot, targetRealPath)) {
      throw new Error(`Symbolic link escapes marketplace root: ${targetPath}`);
    }
    return fs.statSync(targetPath).isDirectory();
  }

  const refs = new Map();
  const pattern = /(?:^|[\s\`("'@\[])(?:\.\/)?\.opencode\/plugins\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\//gm;

  for (const match of filteredContent.matchAll(pattern)) {
    const bundle = match[1];
    const dir = match[2];
    const topLevelDir = path.join(pluginRoot, dir);
    const bundledDir = path.join(pluginRoot, "plugins", bundle, dir);
    if (!hasAllowedDirectory(topLevelDir) && !hasAllowedDirectory(bundledDir)) continue;
    refs.set(`${bundle}/${dir}`, { bundle, dir });
  }

  return [...refs.values()].sort((a, b) => {
    if (a.bundle === b.bundle) {
      return a.dir.localeCompare(b.dir);
    }
    return a.bundle.localeCompare(b.bundle);
  });
}

module.exports = {
  filterMdContent,
  findReferencedDirs,
  findOpencodePluginReferencedDirs,
};
