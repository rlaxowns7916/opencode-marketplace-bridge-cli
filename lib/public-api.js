const { LEGACY_CACHE_DIR } = require("./constants");
const {
  readJson,
  ensureDir,
  removePath,
  listDirectories,
  listMdFiles,
  listPluginFiles,
  copyDir,
} = require("./filesystem");
const {
  normalizeToolsField,
  normalizeModelField,
  transformContent,
} = require("./content-transform");
const {
  filterMdContent,
  findReferencedDirs,
  findOpencodePluginReferencedDirs,
  extractFileReferences,
  buildDependencyGraph,
} = require("./reference-scanner");
const { readMarkerOwner, writeMarker } = require("./ownership");
const { resolveSource, parseMarketplace } = require("./marketplace");
const {
  readRegistry,
  writeRegistry,
  getRegistryFileOwners,
} = require("./registry");
const { installFlatMdDir, uninstallFlatMdFiles } = require("./flat-md");
const { installFlatPluginDir, uninstallFlatPluginFiles } = require("./flat-plugin");
const { install, uninstall, list, update } = require("./install-service");
const {
  formatInstallReport,
  formatMarketplaceListReport,
  formatUpdateReport,
} = require("./report");
const { main } = require("./cli/main");

module.exports = {
  readJson,
  ensureDir,
  removePath,
  listDirectories,
  listMdFiles,
  listPluginFiles,
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
  installFlatPluginDir,
  uninstallFlatPluginFiles,
  install,
  uninstall,
  list,
  update,
  formatInstallReport,
  formatMarketplaceListReport,
  formatUpdateReport,
  main,
  LEGACY_CACHE_DIR,
};
