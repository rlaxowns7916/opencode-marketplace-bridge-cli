const fs = require("node:fs");
const path = require("node:path");

const { readJson } = require("./filesystem");

function resolveSource(source) {
  if (/^[^/\\:@]+\/[^/\\]+$/.test(source) && !source.startsWith(".")) {
    return { type: "github", url: `https://github.com/${source}.git`, source };
  }
  if (/^https?:\/\//i.test(source) || /^git@/i.test(source)) {
    return { type: "url", url: source, source };
  }
  return { type: "local", path: path.resolve(source), source };
}

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

module.exports = {
  resolveSource,
  parseMarketplace,
};
