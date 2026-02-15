const { MODEL_ALIASES, OPENCODE_DIR } = require("./constants");

function normalizeToolsField(content) {
  content = content.replace(
    /^tools:\s*\[([^\]]*)\]/m,
    (_match, items) => {
      const tools = items
        .split(",")
        .map((value) => value.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);

      if (tools.length === 0) return "tools:";
      return "tools:\n" + tools.map((tool) => `  ${tool.toLowerCase()}: true`).join("\n");
    },
  );

  content = content.replace(
    /^tools:\s+([A-Za-z*][\w*]*(?:\s*,\s*[A-Za-z*][\w*]*)*)\s*$/m,
    (_match, items) => {
      const tools = items
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

      return "tools:\n" + tools.map((tool) => `  ${tool.toLowerCase()}: true`).join("\n");
    },
  );

  return content;
}

function normalizeModelField(content) {
  return content.replace(/^(model:\s*)(\S+)\s*$/m, (match, prefix, value) => {
    if (value.includes("/")) return match;
    const mapped = MODEL_ALIASES[value.toLowerCase()];
    return mapped ? `${prefix}${mapped}` : match;
  });
}

/**
 * Rewrite file path references so they point to .opencode/<pluginName>/...
 *
 * Handles two forms:
 * 1. Full source path: @<pluginSourceNorm>/<dir>/... → @.opencode/<pluginName>/<dir>/...
 * 2. Relative path:    @<dir>/...                   → @.opencode/<pluginName>/<dir>/...
 *
 * The "marker" characters before a path (@, backtick, space, etc.) are preserved.
 */
function rewriteFilePaths(content, rewriteCtx) {
  if (!rewriteCtx) return content;
  const { pluginSourceNorm, pluginName, copiedDirs } = rewriteCtx;
  if (!copiedDirs || copiedDirs.length === 0) return content;

  const targetPrefix = `${OPENCODE_DIR}/${pluginName}/`;

  // 1) Full source-path form: <pluginSourceNorm>/<dir>/...
  //    e.g. plugins/spec-driven-roundtrip-engine/rules/file.md
  if (pluginSourceNorm) {
    const escaped = pluginSourceNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const fullPattern = new RegExp(
      `((?:^|[\\s\`("'@\\[])(?:\\.\\/)?)(${escaped}/)`,
      "gm",
    );
    content = content.replace(fullPattern, `$1${targetPrefix}`);
  }

  // 2) Relative form: <dir>/...  (only for copied dirs)
  for (const dir of copiedDirs) {
    const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const relPattern = new RegExp(
      `((?:^|[\\s\`("'@\\[])(?:\\.\\/)?)((?!\\.opencode\\/)${escaped}/)`,
      "gm",
    );
    content = content.replace(relPattern, `$1${targetPrefix}$2`);
  }

  return content;
}

function transformContent(content, rewriteCtx) {
  const toolsNormalized = normalizeToolsField(content);
  const modelNormalized = normalizeModelField(toolsNormalized);
  return rewriteFilePaths(modelNormalized, rewriteCtx);
}

module.exports = {
  normalizeToolsField,
  normalizeModelField,
  rewriteFilePaths,
  transformContent,
};
