const fs = require("node:fs");
const path = require("node:path");

const { ensureDir, listPluginFiles } = require("./filesystem");
const { getRegistryFileOwners } = require("./registry");

function installFlatPluginDir(sourceDir, targetDir, registry, options = {}) {
  const {
    marketplaceName,
    force = false,
    currentOwnedNames = [],
    sourceRoot = null,
    strictSymlinkBoundary = false,
  } = options;
  const installed = [];
  if (!fs.existsSync(sourceDir)) return installed;

  const fileOwners = getRegistryFileOwners(registry, "hooks");
  const inRunOwned = new Set(currentOwnedNames);
  const pluginFiles = listPluginFiles(sourceDir, {
    allowedRoot: sourceRoot,
    strictSymlinkBoundary,
  });

  if (pluginFiles.length > 0) {
    ensureDir(targetDir);
  }

  for (const fileName of pluginFiles) {
    const targetPath = path.join(targetDir, fileName);

    if (fs.existsSync(targetPath)) {
      const owner = fileOwners.get(fileName) || (inRunOwned.has(fileName) ? marketplaceName : null);
      if (!owner) {
        process.stderr.write(`Skipping hook ${fileName}: user-managed file exists\n`);
        continue;
      }
      if (owner !== marketplaceName && !force) {
        process.stderr.write(`Skipping hook ${fileName}: owned by ${owner} (use --force to overwrite)\n`);
        continue;
      }
    }

    fs.copyFileSync(path.join(sourceDir, fileName), targetPath);
    installed.push(fileName);
  }

  return installed;
}

function uninstallFlatPluginFiles(targetDir, fileNames) {
  for (const name of fileNames || []) {
    const filePath = path.join(targetDir, name);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

module.exports = {
  installFlatPluginDir,
  uninstallFlatPluginFiles,
};
