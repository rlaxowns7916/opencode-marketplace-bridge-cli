const fs = require("node:fs");
const path = require("node:path");

const { ensureDir, listMdFiles } = require("./filesystem");
const { transformContent } = require("./content-transform");
const { getRegistryFileOwners } = require("./registry");

function installFlatMdDir(sourceDir, targetDir, registry, registryType, options = {}) {
  const {
    marketplaceName,
    force = false,
    currentOwnedNames = [],
    sourceRoot = null,
    strictSymlinkBoundary = false,
  } = options;
  const installed = [];
  if (!fs.existsSync(sourceDir)) return installed;

  const fileOwners = getRegistryFileOwners(registry, registryType);
  const inRunOwned = new Set(currentOwnedNames);
  const mdFiles = listMdFiles(sourceDir, {
    allowedRoot: sourceRoot,
    strictSymlinkBoundary,
  });

  if (mdFiles.length > 0) {
    ensureDir(targetDir);
  }

  for (const fileName of mdFiles) {
    const baseName = path.basename(fileName, ".md");
    const targetPath = path.join(targetDir, fileName);
    const typeSingular = registryType.slice(0, -1);

    if (fs.existsSync(targetPath)) {
      const owner = fileOwners.get(baseName) || (inRunOwned.has(baseName) ? marketplaceName : null);
      if (!owner) {
        process.stderr.write(`Skipping ${typeSingular} ${baseName}: user-managed file exists\n`);
        continue;
      }
      if (owner !== marketplaceName && !force) {
        process.stderr.write(`Skipping ${typeSingular} ${baseName}: owned by ${owner} (use --force to overwrite)\n`);
        continue;
      }
    }

    const content = fs.readFileSync(path.join(sourceDir, fileName), "utf8");
    fs.writeFileSync(targetPath, transformContent(content), "utf8");
    installed.push(baseName);
  }

  return installed;
}

function uninstallFlatMdFiles(targetDir, names) {
  for (const name of names || []) {
    const filePath = path.join(targetDir, `${name}.md`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

module.exports = {
  installFlatMdDir,
  uninstallFlatMdFiles,
};
