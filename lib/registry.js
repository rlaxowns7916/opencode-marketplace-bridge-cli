const fs = require("node:fs");
const path = require("node:path");

const {
  REGISTRY_FILE,
  LEGACY_REGISTRY_FILE,
} = require("./constants");
const { readJson, writeJsonAtomic } = require("./filesystem");

function readRegistry(projectRoot) {
  const registryPath = path.join(projectRoot, REGISTRY_FILE);
  const registry = readJson(registryPath);
  if (registry && typeof registry === "object" && registry.installations) {
    return registry;
  }

  const legacyPath = path.join(projectRoot, LEGACY_REGISTRY_FILE);
  const legacyRegistry = readJson(legacyPath);
  if (legacyRegistry && typeof legacyRegistry === "object" && legacyRegistry.installations) {
    return legacyRegistry;
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

function getRegistryFileOwners(registry, type) {
  const owners = new Map();
  for (const [marketplaceName, entry] of Object.entries(registry.installations)) {
    for (const name of entry[type] || []) {
      owners.set(name, marketplaceName);
    }
  }
  return owners;
}

module.exports = {
  readRegistry,
  writeRegistry,
  getRegistryFileOwners,
};
