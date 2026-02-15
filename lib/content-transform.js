const { MODEL_ALIASES } = require("./constants");

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

function transformContent(content) {
  const toolsNormalized = normalizeToolsField(content);
  return normalizeModelField(toolsNormalized);
}

module.exports = {
  normalizeToolsField,
  normalizeModelField,
  transformContent,
};
