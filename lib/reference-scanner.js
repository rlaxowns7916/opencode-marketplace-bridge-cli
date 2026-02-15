const fs = require("node:fs");
const path = require("node:path");

const { DISCOVERY_DIR_NAMES, CONTENT_COPY_SKIP, SCANNABLE_EXTENSIONS } = require("./constants");
const {
  listDirectories,
  resolveRealPath,
  isPathWithin,
  classifyDirentEntry,
  walkFiles,
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
  let fenceLen = 0;

  return raw
    .split("\n")
    .filter((line) => {
      const fenceMatch = /^\s*(`{3,})/.exec(line);
      if (fenceMatch) {
        const ticks = fenceMatch[1].length;
        if (fenceLen === 0) {
          fenceLen = ticks;
        } else if (ticks >= fenceLen) {
          fenceLen = 0;
        }
        return false;
      }
      if (fenceLen > 0) return false;

      const trimmed = line.trimStart();
      if (/^[│├└─\s]*[├└]──/.test(line)) return false;
      if (/^\s*\|/.test(trimmed)) return false;
      if (/^\s*#+\s/.test(trimmed)) return false;
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

// Deprecated: use buildDependencyGraph instead
function findReferencedDirs(pluginRoot) {
  const allTopLevel = listDirectories(pluginRoot, {
    allowedRoot: pluginRoot,
    strictSymlinkBoundary: true,
  }).filter((dir) => !CONTENT_COPY_SKIP.has(dir));
  if (allTopLevel.length === 0) return [];

  const filteredContent = scanReferenceContent(pluginRoot);
  if (!filteredContent) return [];

  return allTopLevel.filter((dir) => {
    const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|[\\s\`("'@\\[])(?:\\./)?${escaped}/`, "m");
    return pattern.test(filteredContent);
  });
}

// Deprecated: use buildDependencyGraph instead
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
  const pattern = /(?:^|[\s\`("'@\[])(?:\.\/)?(?:\.opencode\/)?plugins\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\//gm;

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

/**
 * Extract file/directory reference paths from markdown content.
 *
 * @param {string} content - Content filtered by filterMdContent()
 * @param {string[]} knownDirs - Top-level directory names in plugin root
 * @returns {string[]} - Relative path array (e.g. ["rules/common/review.md", "templates/"])
 */
function extractFileReferences(content, knownDirs) {
  const refs = new Set();
  for (const dir of knownDirs) {
    const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `(?:^|[\\s\`("'@\\[])(?:\\.\\/)?(?:\\.opencode\\/(?:plugins\\/)?[\\w._-]+\\/)?(?:plugins\\/[\\w._-]+\\/)?(${escaped}\\/[^\\s\`)"'\\]]*)`,
      "gm",
    );
    for (const match of content.matchAll(pattern)) {
      refs.add(match[1].replace(/[.,;:!?]+$/, ""));
    }
  }
  return [...refs];
}

/**
 * Build a dependency graph starting from discovery dirs (skills/commands/agents)
 * by recursively tracking all file references.
 *
 * @param {string} pluginRoot - Plugin source root absolute path
 * @param {object} options - { allowedRoot, strictSymlinkBoundary }
 * @returns {{ reachableFiles: Set<string>, reachableDirs: Set<string> }}
 *   reachableFiles: file paths relative to pluginRoot
 *   reachableDirs: top-level directory names
 */
function buildDependencyGraph(pluginRoot, options = {}) {
  const { allowedRoot = null, strictSymlinkBoundary = false } = options;

  const resolvedAllowedRoot = allowedRoot
    ? (resolveRealPath(allowedRoot) || path.resolve(allowedRoot))
    : (resolveRealPath(pluginRoot) || path.resolve(pluginRoot));

  const knownDirs = listDirectories(pluginRoot, {
    allowedRoot: resolvedAllowedRoot,
    strictSymlinkBoundary,
  }).filter((dir) => !CONTENT_COPY_SKIP.has(dir));

  const queue = [];
  const visited = new Set();
  const reachableFiles = new Set();
  const reachableDirs = new Set();

  // Seed: walk discovery dirs for scannable files
  for (const discoveryDir of DISCOVERY_DIR_NAMES) {
    const discoveryPath = path.join(pluginRoot, discoveryDir);
    if (!fs.existsSync(discoveryPath)) continue;
    const files = walkFiles(discoveryPath, {
      allowedRoot: resolvedAllowedRoot,
      strictSymlinkBoundary,
    });
    for (const relFile of files) {
      const ext = path.extname(relFile).toLowerCase();
      if (SCANNABLE_EXTENSIONS.has(ext)) {
        queue.push(path.join(discoveryPath, relFile));
      }
    }
  }

  // BFS
  while (queue.length > 0) {
    const filePath = queue.shift();
    const realPath = resolveRealPath(filePath);
    if (!realPath || visited.has(realPath)) continue;
    visited.add(realPath);

    const ext = path.extname(filePath).toLowerCase();
    if (!SCANNABLE_EXTENSIONS.has(ext)) continue;

    let content;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (_e) {
      continue;
    }

    const filtered = filterMdContent(content);
    const refs = extractFileReferences(filtered, knownDirs);

    for (const ref of refs) {
      const absPath = path.join(pluginRoot, ref);
      const topLevelDir = ref.split("/")[0];

      if (!fs.existsSync(absPath)) continue;

      let stat;
      try {
        stat = fs.statSync(absPath);
      } catch (_e) {
        continue;
      }

      if (stat.isDirectory()) {
        reachableDirs.add(topLevelDir);
        const dirFiles = walkFiles(absPath, {
          allowedRoot: resolvedAllowedRoot,
          strictSymlinkBoundary,
        });
        for (const f of dirFiles) {
          const fileRef = path.join(ref, f);
          reachableFiles.add(fileRef);
          queue.push(path.join(pluginRoot, fileRef));
        }
      } else if (stat.isFile()) {
        reachableFiles.add(ref);
        reachableDirs.add(topLevelDir);
        queue.push(absPath);
      }
    }
  }

  return { reachableFiles, reachableDirs };
}

module.exports = {
  filterMdContent,
  findReferencedDirs,
  findOpencodePluginReferencedDirs,
  extractFileReferences,
  buildDependencyGraph,
};
