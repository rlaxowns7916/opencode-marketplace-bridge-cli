const fs = require("node:fs");
const path = require("node:path");

const { COPY_EXCLUDE } = require("./constants");

function resolveRealPath(target) {
  try {
    if (typeof fs.realpathSync.native === "function") {
      return fs.realpathSync.native(target);
    }
    return fs.realpathSync(target);
  } catch (_error) {
    return null;
  }
}

function isPathWithin(baseDir, candidatePath) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(resolvedBase, resolvedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function classifyDirentEntry(parentDir, entry, options = {}) {
  const {
    allowedRoot = null,
    strictSymlinkBoundary = false,
    strictBrokenSymlink = false,
  } = options;
  const fullPath = path.join(parentDir, entry.name);

  if (entry.isDirectory()) {
    return "directory";
  }
  if (entry.isFile()) {
    return "file";
  }
  if (!entry.isSymbolicLink()) {
    return null;
  }

  let stats;
  try {
    stats = fs.statSync(fullPath);
  } catch (_error) {
    if (strictBrokenSymlink) {
      throw new Error(`Broken symbolic link: ${fullPath}`);
    }
    return null;
  }

  if (allowedRoot) {
    const linkRealPath = resolveRealPath(fullPath);
    if (!linkRealPath) {
      if (strictBrokenSymlink) {
        throw new Error(`Broken symbolic link: ${fullPath}`);
      }
      return null;
    }
    if (!isPathWithin(allowedRoot, linkRealPath)) {
      if (strictSymlinkBoundary) {
        throw new Error(`Symbolic link escapes allowed root: ${fullPath}`);
      }
      return null;
    }
  }

  if (stats.isDirectory()) {
    return "directory";
  }
  if (stats.isFile()) {
    return "file";
  }
  return null;
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return null;
  }
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function writeJsonAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmpPath, filePath);
}

function removePath(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}

function listDirectories(target, options = {}) {
  if (!fs.existsSync(target)) return [];
  const allowedRoot = options.allowedRoot
    ? (resolveRealPath(options.allowedRoot) || path.resolve(options.allowedRoot))
    : null;
  return fs
    .readdirSync(target, { withFileTypes: true })
    .filter((entry) => classifyDirentEntry(target, entry, {
      allowedRoot,
      strictSymlinkBoundary: options.strictSymlinkBoundary,
      strictBrokenSymlink: options.strictBrokenSymlink,
    }) === "directory")
    .map((entry) => entry.name)
    .sort();
}

function listMdFiles(target, options = {}) {
  if (!fs.existsSync(target)) return [];
  const allowedRoot = options.allowedRoot
    ? (resolveRealPath(options.allowedRoot) || path.resolve(options.allowedRoot))
    : null;
  return fs
    .readdirSync(target, { withFileTypes: true })
    .filter((entry) => (
      classifyDirentEntry(target, entry, {
        allowedRoot,
        strictSymlinkBoundary: options.strictSymlinkBoundary,
        strictBrokenSymlink: options.strictBrokenSymlink,
      }) === "file"
    ) && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
}

function copyDir(source, target, transformFile, exclude, options = {}) {
  const allowedRoot = options.allowedRoot
    ? (resolveRealPath(options.allowedRoot) || path.resolve(options.allowedRoot))
    : null;
  const activeRealDirs = options.activeRealDirs || new Set();
  const strictSymlinkBoundary = options.strictSymlinkBoundary === true;
  const strictBrokenSymlink = options.strictBrokenSymlink === true;

  const sourceRealPath = resolveRealPath(source);
  if (!sourceRealPath) {
    if (strictBrokenSymlink) {
      throw new Error(`Broken source path: ${source}`);
    }
    return;
  }
  if (allowedRoot && !isPathWithin(allowedRoot, sourceRealPath)) {
    throw new Error(`Source path escapes allowed root: ${source}`);
  }
  if (activeRealDirs.has(sourceRealPath)) {
    return;
  }

  activeRealDirs.add(sourceRealPath);
  ensureDir(target);

  try {
    const entries = fs.readdirSync(source, { withFileTypes: true });
    for (const entry of entries) {
      if (exclude && exclude.has(entry.name)) continue;

      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);
      const entryKind = classifyDirentEntry(source, entry, {
        allowedRoot,
        strictSymlinkBoundary,
        strictBrokenSymlink,
      });

      if (entryKind === "directory") {
        copyDir(sourcePath, targetPath, transformFile, exclude, {
          allowedRoot,
          activeRealDirs,
          strictSymlinkBoundary,
          strictBrokenSymlink,
        });
        continue;
      }

      if (entryKind !== "file") {
        continue;
      }

      if (typeof transformFile === "function") {
        const transformed = transformFile(sourcePath);
        if (typeof transformed === "string") {
          fs.writeFileSync(targetPath, transformed, "utf8");
          continue;
        }
      }

      fs.copyFileSync(sourcePath, targetPath);
    }
  } finally {
    activeRealDirs.delete(sourceRealPath);
  }
}

function walkFiles(dir, options = {}) {
  const {
    allowedRoot = null,
    strictSymlinkBoundary = false,
  } = options;
  const resolvedAllowedRoot = allowedRoot
    ? (resolveRealPath(allowedRoot) || path.resolve(allowedRoot))
    : null;
  const files = [];

  function walk(currentDir, relPrefix) {
    if (!fs.existsSync(currentDir)) return;
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const entry of entries) {
      if (COPY_EXCLUDE.has(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      const relPath = relPrefix ? path.join(relPrefix, entry.name) : entry.name;
      const entryKind = classifyDirentEntry(currentDir, entry, {
        allowedRoot: resolvedAllowedRoot,
        strictSymlinkBoundary,
      });
      if (entryKind === "directory") {
        walk(fullPath, relPath);
      } else if (entryKind === "file") {
        files.push(relPath);
      }
    }
  }

  walk(dir, "");
  return files;
}

module.exports = {
  readJson,
  ensureDir,
  writeJsonAtomic,
  removePath,
  resolveRealPath,
  isPathWithin,
  classifyDirentEntry,
  listDirectories,
  listMdFiles,
  copyDir,
  walkFiles,
};
