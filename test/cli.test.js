const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const cliPath = path.resolve(__dirname, "..", "bin", "cli.js");
const fixtureRoot = path.resolve(__dirname, "fixtures", "ombc-source");
const {
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
  install,
  uninstall,
  list,
  LEGACY_CACHE_DIR,
} = require(cliPath);

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ombc-cli-test-"));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function withSimpleGitMock(mockFactory, fn) {
  const simpleGitPath = require.resolve("simple-git");
  require(simpleGitPath);
  const cacheEntry = require.cache[simpleGitPath];
  const originalExports = cacheEntry.exports;
  cacheEntry.exports = mockFactory;
  try {
    return await fn();
  } finally {
    cacheEntry.exports = originalExports;
  }
}

function createMockMarketplace(tmpDir, opts = {}) {
  const marketplaceDir = path.join(tmpDir, "mock-marketplace");
  fs.mkdirSync(path.join(marketplaceDir, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "skills", "test-skill"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "rules", "common"), { recursive: true });

  fs.writeFileSync(
    path.join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "mock-marketplace",
      plugins: [{ name: "mock-plugin", source: "./" }],
    }),
    "utf8",
  );

  fs.writeFileSync(
    path.join(marketplaceDir, "skills", "test-skill", "SKILL.md"),
    "Read `rules/common/test-rule.md` first.\nThen read rules/common/other.md too.",
    "utf8",
  );

  fs.writeFileSync(
    path.join(marketplaceDir, "rules", "common", "test-rule.md"),
    "# Test Rule\nSome rule content.",
    "utf8",
  );

  // Optionally add commands
  if (opts.commands) {
    fs.mkdirSync(path.join(marketplaceDir, "commands"), { recursive: true });
    for (const [name, content] of Object.entries(opts.commands)) {
      fs.writeFileSync(
        path.join(marketplaceDir, "commands", `${name}.md`),
        content,
        "utf8",
      );
    }
  }

  // Optionally add agents
  if (opts.agents) {
    fs.mkdirSync(path.join(marketplaceDir, "agents"), { recursive: true });
    for (const [name, content] of Object.entries(opts.agents)) {
      fs.writeFileSync(
        path.join(marketplaceDir, "agents", `${name}.md`),
        content,
        "utf8",
      );
    }
  }

  return marketplaceDir;
}

function createSecondMarketplace(tmpDir, opts = {}) {
  const marketplaceDir = path.join(tmpDir, "second-marketplace");
  fs.mkdirSync(path.join(marketplaceDir, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "skills", "test-skill"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "rules", "common"), { recursive: true });

  fs.writeFileSync(
    path.join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "second-marketplace",
      plugins: [{ name: "second-plugin", source: "./" }],
    }),
    "utf8",
  );

  fs.writeFileSync(
    path.join(marketplaceDir, "skills", "test-skill", "SKILL.md"),
    "Second marketplace skill. Read `rules/common/test-rule.md`.",
    "utf8",
  );

  fs.writeFileSync(
    path.join(marketplaceDir, "rules", "common", "test-rule.md"),
    "# Second Rule",
    "utf8",
  );

  if (opts.commands) {
    fs.mkdirSync(path.join(marketplaceDir, "commands"), { recursive: true });
    for (const [name, content] of Object.entries(opts.commands)) {
      fs.writeFileSync(path.join(marketplaceDir, "commands", `${name}.md`), content, "utf8");
    }
  }

  if (opts.agents) {
    fs.mkdirSync(path.join(marketplaceDir, "agents"), { recursive: true });
    for (const [name, content] of Object.entries(opts.agents)) {
      fs.writeFileSync(path.join(marketplaceDir, "agents", `${name}.md`), content, "utf8");
    }
  }

  return marketplaceDir;
}

// --- resolveSource ---

test("resolveSource parses GitHub shorthand", () => {
  const result = resolveSource("kimtaejun/ombc-fixture");
  assert.equal(result.type, "github");
  assert.equal(result.url, "https://github.com/kimtaejun/ombc-fixture.git");
  assert.equal(result.source, "kimtaejun/ombc-fixture");
});

test("resolveSource parses HTTPS URL", () => {
  const result = resolveSource("https://github.com/owner/repo.git");
  assert.equal(result.type, "url");
  assert.equal(result.url, "https://github.com/owner/repo.git");
});

test("resolveSource parses SSH URL", () => {
  const result = resolveSource("git@github.com:owner/repo.git");
  assert.equal(result.type, "url");
  assert.equal(result.url, "git@github.com:owner/repo.git");
});

test("resolveSource parses local path", () => {
  const result = resolveSource("/some/local/path");
  assert.equal(result.type, "local");
  assert.equal(result.path, "/some/local/path");
});

test("resolveSource parses relative local path", () => {
  const result = resolveSource("./relative/path");
  assert.equal(result.type, "local");
  assert.equal(path.isAbsolute(result.path), true);
});

// --- normalizeToolsField ---

test("normalizeToolsField converts JSON array to YAML record", () => {
  const input = '---\nname: reviewer\ntools: ["Read", "Grep", "Glob"]\n---\nContent here.';
  const result = normalizeToolsField(input);
  assert.equal(
    result,
    "---\nname: reviewer\ntools:\n  read: true\n  grep: true\n  glob: true\n---\nContent here.",
  );
});

test("normalizeToolsField handles single-quoted items in array", () => {
  const input = "---\ntools: ['Read', 'Grep']\n---\nContent.";
  const result = normalizeToolsField(input);
  assert.equal(result, "---\ntools:\n  read: true\n  grep: true\n---\nContent.");
});

test("normalizeToolsField converts comma-separated string to YAML record", () => {
  const input = "---\ntools: Read, Grep, Glob, Bash\n---\nContent.";
  const result = normalizeToolsField(input);
  assert.equal(
    result,
    "---\ntools:\n  read: true\n  grep: true\n  glob: true\n  bash: true\n---\nContent.",
  );
});

test("normalizeToolsField converts single tool string to YAML record", () => {
  const input = "---\ntools: Read\n---\nContent.";
  const result = normalizeToolsField(input);
  assert.equal(result, "---\ntools:\n  read: true\n---\nContent.");
});

test("normalizeToolsField passes through correct YAML record format", () => {
  const input = "---\ntools:\n  read: true\n  grep: true\n---\nContent.";
  const result = normalizeToolsField(input);
  assert.equal(result, input);
});

test("normalizeToolsField passes through content without tools field", () => {
  const input = "# Skill\nJust a regular markdown file.\nNo frontmatter at all.";
  const result = normalizeToolsField(input);
  assert.equal(result, input);
});

test("normalizeToolsField handles empty array", () => {
  const input = "---\ntools: []\n---\nContent.";
  const result = normalizeToolsField(input);
  assert.equal(result, "---\ntools:\n---\nContent.");
});

// --- normalizeModelField ---

test("normalizeModelField converts sonnet to full path", () => {
  const input = "---\nmodel: sonnet\n---\nContent.";
  assert.equal(normalizeModelField(input), "---\nmodel: anthropic/claude-sonnet-4-5\n---\nContent.");
});

test("normalizeModelField converts opus to full path", () => {
  const input = "---\nmodel: opus\n---\nContent.";
  assert.equal(normalizeModelField(input), "---\nmodel: anthropic/claude-opus-4-5\n---\nContent.");
});

test("normalizeModelField converts haiku to full path", () => {
  const input = "---\nmodel: haiku\n---\nContent.";
  assert.equal(normalizeModelField(input), "---\nmodel: anthropic/claude-haiku-4-5\n---\nContent.");
});

test("normalizeModelField passes through provider/model format", () => {
  const input = "---\nmodel: anthropic/claude-sonnet-4-5\n---\nContent.";
  assert.equal(normalizeModelField(input), input);
});

test("normalizeModelField passes through unknown shorthand", () => {
  const input = "---\nmodel: gpt-4o\n---\nContent.";
  assert.equal(normalizeModelField(input), input);
});

test("normalizeModelField passes through content without model field", () => {
  const input = "# Skill\nNo frontmatter.";
  assert.equal(normalizeModelField(input), input);
});

// --- filterMdContent ---

test("filterMdContent removes tree diagram lines", () => {
  const input = [
    "Read `rules/common/review.md`",
    "├── hooks/          # Custom React hooks",
    "│   └── tests/      # Test files",
    "└── docs/           # Documentation",
    "Then check scripts/setup.js",
  ].join("\n");
  const result = filterMdContent(input);
  assert.ok(result.includes("rules/common/review.md"));
  assert.ok(!result.includes("├── hooks/"));
  assert.ok(!result.includes("└── tests/"));
  assert.ok(!result.includes("└── docs/"));
  assert.ok(result.includes("scripts/setup.js"));
});

test("filterMdContent removes comment lines", () => {
  const input = [
    "Run the tests",
    "# .github/workflows/e2e.yml",
    "  # scripts/setup.sh",
    "// tests/add_test.cpp",
    "node scripts/run.js",
  ].join("\n");
  const result = filterMdContent(input);
  assert.ok(!result.includes(".github/"));
  assert.ok(!result.includes("# scripts/"));
  assert.ok(!result.includes("// tests/"));
  assert.ok(result.includes("node scripts/run.js"));
});

test("filterMdContent removes URL lines", () => {
  const input = [
    "Read rules/common/review.md",
    "See https://nextjs.org/docs/security for details",
    "Also https://example.com/hooks/guide",
  ].join("\n");
  const result = filterMdContent(input);
  assert.ok(result.includes("rules/common/review.md"));
  assert.ok(!result.includes("nextjs.org/docs/"));
  assert.ok(!result.includes("example.com/hooks/"));
});

test("filterMdContent removes fenced code block content", () => {
  const input = [
    "Read `rules/common/review.md` first.",
    "```yaml",
    "# .github/workflows/e2e.yml",
    "name: E2E",
    "```",
    "```bash",
    "pytest tests/test_utils.py",
    "```",
    "Then continue with scripts/setup.js",
  ].join("\n");
  const result = filterMdContent(input);
  assert.ok(result.includes("rules/common/review.md"));
  assert.ok(!result.includes(".github/"));
  assert.ok(!result.includes("tests/test_utils"));
  assert.ok(result.includes("scripts/setup.js"));
});

test("filterMdContent removes markdown table rows", () => {
  const input = [
    "Security scan targets:",
    "| `hooks/` | Command injection |",
    "| `scripts/` | Path traversal |",
    "Read `rules/common/review.md`.",
  ].join("\n");
  const result = filterMdContent(input);
  assert.ok(!result.includes("hooks/"));
  assert.ok(!result.includes("scripts/"));
  assert.ok(result.includes("rules/common/review.md"));
});

test("filterMdContent removes home dir references", () => {
  const input = [
    "Copy to ~/.claude/skills/my-skill/SKILL.md",
    "Read `rules/common/review.md`",
  ].join("\n");
  const result = filterMdContent(input);
  assert.ok(!result.includes("~/.claude/"));
  assert.ok(result.includes("rules/common/review.md"));
});

// --- findReferencedDirs ---

test("findReferencedDirs finds dirs referenced in skills", () => {
  const tmpDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmpDir, "skills", "review"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "rules", "common"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "templates"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "skills", "review", "SKILL.md"),
      "Read `rules/common/review.md` and `templates/pr.md`.",
      "utf8",
    );
    fs.writeFileSync(path.join(tmpDir, "rules", "common", "review.md"), "rule", "utf8");
    fs.writeFileSync(path.join(tmpDir, "templates", "pr.md"), "template", "utf8");
    fs.writeFileSync(path.join(tmpDir, "docs", "guide.md"), "guide", "utf8");

    const dirs = findReferencedDirs(tmpDir);
    assert.deepEqual(dirs.sort(), ["rules", "templates"]);
    assert.equal(dirs.includes("docs"), false);
  } finally {
    cleanup(tmpDir);
  }
});

test("findReferencedDirs returns empty for no references", () => {
  const tmpDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmpDir, "skills", "basic"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "skills", "basic", "SKILL.md"),
      "Just do the thing.",
      "utf8",
    );

    const dirs = findReferencedDirs(tmpDir);
    assert.deepEqual(dirs, []);
  } finally {
    cleanup(tmpDir);
  }
});

test("findReferencedDirs ignores tree diagrams and comments", () => {
  const tmpDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmpDir, "skills", "review"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "rules", "common"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "hooks"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".github", "workflows"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "tests"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "skills", "review", "SKILL.md"),
      [
        "Read `rules/common/review.md` first.",
        "├── hooks/          # Custom React hooks",
        "├── docs/           # Documentation",
        "│   └── tests/      # Test files",
        "# .github/workflows/e2e.yml",
        "See https://example.com/docs/guide",
      ].join("\n"),
      "utf8",
    );

    const dirs = findReferencedDirs(tmpDir);
    assert.deepEqual(dirs, ["rules"]);
  } finally {
    cleanup(tmpDir);
  }
});

test("findReferencedDirs ignores .opencode/plugins references", () => {
  const tmpDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmpDir, "skills", "review"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "rules", "common"), { recursive: true });
    fs.mkdirSync(
      path.join(tmpDir, "plugins", "spec-driven-roundtrip-engine", "rules"),
      { recursive: true },
    );

    fs.writeFileSync(
      path.join(tmpDir, "skills", "review", "SKILL.md"),
      [
        "Read rules/common/review.md first.",
        "@.opencode/plugins/spec-driven-roundtrip-engine/rules/boundary-definition.md",
      ].join("\n"),
      "utf8",
    );

    const dirs = findReferencedDirs(tmpDir);
    assert.deepEqual(dirs, ["rules"]);
  } finally {
    cleanup(tmpDir);
  }
});

test("findReferencedDirs includes plugins/ dir when referenced", () => {
  const tmpDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmpDir, "skills", "review"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "rules", "common"), { recursive: true });
    fs.mkdirSync(
      path.join(tmpDir, "plugins", "spec-driven-roundtrip-engine", "rules"),
      { recursive: true },
    );

    fs.writeFileSync(
      path.join(tmpDir, "skills", "review", "SKILL.md"),
      [
        "Read rules/common/review.md first.",
        "@plugins/spec-driven-roundtrip-engine/rules/boundary-definition.md",
        "@plugins/spec-driven-roundtrip-engine/rules/operational-rules.md",
      ].join("\n"),
      "utf8",
    );

    const dirs = findReferencedDirs(tmpDir);
    assert.deepEqual(dirs.sort(), ["plugins", "rules"]);
  } finally {
    cleanup(tmpDir);
  }
});

test("findOpencodePluginReferencedDirs finds .opencode plugin bundle refs", () => {
  const tmpDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmpDir, "skills", "review"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "rules", "common"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "templates"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "skills", "review", "SKILL.md"),
      [
        "Read rules/common/review.md first.",
        "@.opencode/plugins/spec-driven-roundtrip-engine/rules/boundary-definition.md",
        "@.opencode/plugins/spec-driven-roundtrip-engine/rules/operational-rules.md",
      ].join("\n"),
      "utf8",
    );

    const refs = findOpencodePluginReferencedDirs(tmpDir);
    assert.deepEqual(refs, [{ bundle: "spec-driven-roundtrip-engine", dir: "rules" }]);
  } finally {
    cleanup(tmpDir);
  }
});

test("findOpencodePluginReferencedDirs deduplicates and sorts by bundle/dir", () => {
  const tmpDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmpDir, "skills", "review"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "rules", "common"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "templates"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "skills", "review", "SKILL.md"),
      [
        "@.opencode/plugins/zeta-bundle/rules/one.md",
        "@.opencode/plugins/alpha-bundle/templates/two.md",
        "@.opencode/plugins/alpha-bundle/rules/three.md",
        "@.opencode/plugins/alpha-bundle/rules/three.md",
      ].join("\n"),
      "utf8",
    );

    const refs = findOpencodePluginReferencedDirs(tmpDir);
    assert.deepEqual(refs, [
      { bundle: "alpha-bundle", dir: "rules" },
      { bundle: "alpha-bundle", dir: "templates" },
      { bundle: "zeta-bundle", dir: "rules" },
    ]);
  } finally {
    cleanup(tmpDir);
  }
});

test("findOpencodePluginReferencedDirs finds bare plugins/ refs without .opencode prefix", () => {
  const tmpDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmpDir, "skills", "review"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "rules", "common"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "skills", "review", "SKILL.md"),
      [
        "Read rules/common/review.md first.",
        "@plugins/spec-driven-roundtrip-engine/rules/boundary-definition.md",
        "@plugins/spec-driven-roundtrip-engine/rules/operational-rules.md",
      ].join("\n"),
      "utf8",
    );

    const refs = findOpencodePluginReferencedDirs(tmpDir);
    assert.deepEqual(refs, [{ bundle: "spec-driven-roundtrip-engine", dir: "rules" }]);
  } finally {
    cleanup(tmpDir);
  }
});

test("findOpencodePluginReferencedDirs includes bundled-only refs without top-level dir", () => {
  const tmpDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmpDir, "skills", "review"), { recursive: true });
    fs.mkdirSync(
      path.join(tmpDir, "plugins", "spec-driven-roundtrip-engine", "rules", "common"),
      { recursive: true },
    );

    fs.writeFileSync(
      path.join(tmpDir, "skills", "review", "SKILL.md"),
      "@.opencode/plugins/spec-driven-roundtrip-engine/rules/common/boundary-definition.md",
      "utf8",
    );

    const refs = findOpencodePluginReferencedDirs(tmpDir);
    assert.deepEqual(refs, [{ bundle: "spec-driven-roundtrip-engine", dir: "rules" }]);
  } finally {
    cleanup(tmpDir);
  }
});

// --- transformContent applies tools + model normalization ---

test("transformContent applies tools normalization and model normalization", () => {
  const input = '---\nmodel: sonnet\ntools: ["Read", "Grep"]\n---\nRead rules/common/test.md for review.';
  const result = transformContent(input);
  assert.match(result, /model: anthropic\/claude-sonnet-4-5/);
  assert.match(result, /tools:\n {2}read: true\n {2}grep: true/);
  // No path rewriting — content preserved as-is
  assert.match(result, /Read rules\/common\/test\.md for review\./);
});

test("transformContent rewrites relative paths with rewriteCtx", () => {
  const input = [
    "Read rules/common/review.md first.",
    "Also read /rules/common/from-root.md.",
    "Check templates/pr.md too.",
    "Already rewritten: .opencode/my-plugin/rules/file.md",
  ].join("\n");
  const result = transformContent(input, {
    pluginSourceNorm: "",
    pluginName: "my-plugin",
    copiedDirs: ["rules", "templates"],
  });
  assert.match(result, /\.opencode\/my-plugin\/rules\/common\/review\.md/);
  assert.match(result, /\.opencode\/my-plugin\/rules\/common\/from-root\.md/);
  assert.match(result, /\.opencode\/my-plugin\/templates\/pr\.md/);
  // No double rewriting
  assert.doesNotMatch(result, /\.opencode\/my-plugin\/\.opencode\//);
});

// --- parseMarketplace ---

test("parseMarketplace reads valid marketplace.json", () => {
  const result = parseMarketplace(fixtureRoot);
  assert.equal(result.name, "ombc-fixture");
  assert.equal(Array.isArray(result.plugins), true);
  assert.equal(result.plugins[0].name, "ombc-fixture");
});

test("parseMarketplace throws for missing marketplace.json", () => {
  const tmpDir = makeTempDir();
  try {
    assert.throws(() => parseMarketplace(tmpDir), {
      message: /No .claude-plugin\/marketplace.json found/,
    });
  } finally {
    cleanup(tmpDir);
  }
});

test("parseMarketplace throws for invalid JSON", () => {
  const tmpDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmpDir, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".claude-plugin", "marketplace.json"),
      "not json",
      "utf8",
    );
    assert.throws(() => parseMarketplace(tmpDir), {
      message: /Invalid marketplace.json/,
    });
  } finally {
    cleanup(tmpDir);
  }
});

test("parseMarketplace throws for missing plugins array", () => {
  const tmpDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmpDir, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".claude-plugin", "marketplace.json"),
      JSON.stringify({ name: "test" }),
      "utf8",
    );
    assert.throws(() => parseMarketplace(tmpDir), {
      message: /plugins array is missing/,
    });
  } finally {
    cleanup(tmpDir);
  }
});

// --- install: place-at-source ---

test("install places referenced files in .opencode/<pluginName>/ and creates skills", async () => {
  const tmpDir = makeTempDir();
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(fixtureRoot, null, projectRoot);

    // Rules placed at .opencode/<pluginName>/
    const ruleFile = path.join(projectRoot, ".opencode", "ombc-fixture", "rules", "common", "review-baseline.md");
    assert.equal(fs.existsSync(ruleFile), true);

    // Marker exists at .opencode/<pluginName>/
    const placedMarker = path.join(projectRoot, ".opencode", "ombc-fixture", ".ombc-managed");
    assert.equal(fs.existsSync(placedMarker), true);

    // No cache directory created
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "plugins", "cache")),
      false,
    );

    // No rules at project root
    assert.equal(fs.existsSync(path.join(projectRoot, "rules")), false);

    // Skills created
    const codeReviewSkill = path.join(
      projectRoot, ".opencode", "skills", "code-review", "SKILL.md",
    );
    const prCreateSkill = path.join(
      projectRoot, ".opencode", "skills", "pr-create", "SKILL.md",
    );
    assert.equal(fs.existsSync(codeReviewSkill), true);
    assert.equal(fs.existsSync(prCreateSkill), true);

    // Skill content rewritten with .opencode/<pluginName>/ prefix
    const skillContent = fs.readFileSync(codeReviewSkill, "utf8");
    assert.match(skillContent, /\.opencode\/ombc-fixture\/rules\/common\/review-baseline\.md/);

    // Skill markers created
    const marker = path.join(
      projectRoot, ".opencode", "skills", "code-review", ".ombc-managed",
    );
    assert.equal(fs.existsSync(marker), true);

    // Registry created with placedDirs field (no cacheDir)
    const registry = readRegistry(projectRoot);
    assert.equal("ombc-fixture" in registry.installations, true);
    const entry = registry.installations["ombc-fixture"];
    assert.deepEqual(entry.plugins, ["ombc-fixture"]);
    assert.deepEqual(entry.skills, ["code-review", "pr-create"]);
    assert.deepEqual(entry.commands, []);
    assert.deepEqual(entry.agents, []);
    assert.deepEqual(entry.placedDirs, [".opencode/ombc-fixture"]);
    assert.equal(entry.cacheDir, undefined);
  } finally {
    cleanup(tmpDir);
  }
});

test("install with plugin filter installs only specified plugin", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = createMockMarketplace(tmpDir);
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, "mock-plugin", projectRoot);

    const skillPath = path.join(
      projectRoot, ".opencode", "skills", "test-skill", "SKILL.md",
    );
    assert.equal(fs.existsSync(skillPath), true);

    // Content rewritten with .opencode/<pluginName>/ prefix
    const content = fs.readFileSync(skillPath, "utf8");
    assert.match(content, /\.opencode\/mock-plugin\/rules\/common\/test-rule\.md/);
  } finally {
    cleanup(tmpDir);
  }
});

test("install throws for non-existent plugin filter", async () => {
  const tmpDir = makeTempDir();
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await assert.rejects(
      () => install(fixtureRoot, "non-existent", projectRoot),
      { message: /Plugin "non-existent" not found in marketplace/ },
    );
  } finally {
    cleanup(tmpDir);
  }
});

test("install rejects plugin source that escapes marketplace root", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = path.join(tmpDir, "escape-mp");
  const outsideDir = path.join(tmpDir, "outside");
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(path.join(marketplaceDir, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(outsideDir, "skills", "review"), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });

  fs.writeFileSync(
    path.join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "escape-mp",
      plugins: [{ name: "escape", source: "../outside" }],
    }),
    "utf8",
  );
  fs.writeFileSync(path.join(outsideDir, "skills", "review", "SKILL.md"), "outside", "utf8");

  try {
    await assert.rejects(
      () => install(marketplaceDir, null, projectRoot),
      { message: /Invalid plugin source/ },
    );

    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "skills", "review", "SKILL.md")),
      false,
    );
    assert.equal("escape-mp" in readRegistry(projectRoot).installations, false);
  } finally {
    cleanup(tmpDir);
  }
});

test("install rejects absolute plugin source paths", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = path.join(tmpDir, "abs-source-mp");
  const outsideDir = path.join(tmpDir, "outside");
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(path.join(marketplaceDir, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(outsideDir, "skills", "review"), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });

  fs.writeFileSync(
    path.join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "abs-source-mp",
      plugins: [{ name: "abs", source: outsideDir }],
    }),
    "utf8",
  );
  fs.writeFileSync(path.join(outsideDir, "skills", "review", "SKILL.md"), "outside", "utf8");

  try {
    await assert.rejects(
      () => install(marketplaceDir, null, projectRoot),
      { message: /Invalid plugin source/ },
    );

    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "skills", "review", "SKILL.md")),
      false,
    );
    assert.equal("abs-source-mp" in readRegistry(projectRoot).installations, false);
  } finally {
    cleanup(tmpDir);
  }
});

test("install clones GitHub shorthand source and cleans temporary clone dir", async () => {
  const tmpDir = makeTempDir();
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
  let clonedTmpDir;

  try {
    await withSimpleGitMock(
      () => ({
        clone: async (_url, targetDir) => {
          clonedTmpDir = targetDir;
          fs.cpSync(fixtureRoot, targetDir, { recursive: true });
        },
      }),
      async () => {
        await install("owner/repo", null, projectRoot);
      },
    );

    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "ombc-fixture", "rules", "common", "review-baseline.md")),
      true,
    );
    assert.equal(fs.existsSync(clonedTmpDir), false);
  } finally {
    cleanup(tmpDir);
  }
});

test("install reports clone failure and removes temporary clone dir", async () => {
  const tmpDir = makeTempDir();
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
  let clonedTmpDir;

  try {
    await withSimpleGitMock(
      () => ({
        clone: async (_url, targetDir) => {
          clonedTmpDir = targetDir;
          throw new Error("mock clone failure");
        },
      }),
      async () => {
        await assert.rejects(
          () => install("owner/repo", null, projectRoot),
          { message: /Failed to clone .*mock clone failure/ },
        );
      },
    );

    assert.equal(fs.existsSync(clonedTmpDir), false);
  } finally {
    cleanup(tmpDir);
  }
});

// --- install commands and agents ---

test("install copies commands with path rewriting", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = createMockMarketplace(tmpDir, {
    commands: {
      "review": "---\ndescription: Review command\n---\nRead rules/common/test-rule.md",
      "deploy": "---\ndescription: Deploy command\n---\nDeploy the app.",
    },
  });
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    // Commands copied to .opencode/commands/
    const reviewCmd = path.join(projectRoot, ".opencode", "commands", "review.md");
    const deployCmd = path.join(projectRoot, ".opencode", "commands", "deploy.md");
    assert.equal(fs.existsSync(reviewCmd), true);
    assert.equal(fs.existsSync(deployCmd), true);

    // Content rewritten with .opencode/<pluginName>/ prefix
    const content = fs.readFileSync(reviewCmd, "utf8");
    assert.match(content, /\.opencode\/mock-plugin\/rules\/common\/test-rule\.md/);

    // Registry tracks commands
    const registry = readRegistry(projectRoot);
    const entry = registry.installations["mock-marketplace"];
    assert.deepEqual(entry.commands.sort(), ["deploy", "review"]);
  } finally {
    cleanup(tmpDir);
  }
});

test("install copies agents with path rewriting", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = createMockMarketplace(tmpDir, {
    agents: {
      "reviewer": "---\nname: reviewer\n---\nUse rules/common/test-rule.md for review.",
    },
  });
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    // Agent copied to .opencode/agents/
    const agentFile = path.join(projectRoot, ".opencode", "agents", "reviewer.md");
    assert.equal(fs.existsSync(agentFile), true);

    // Content rewritten with .opencode/<pluginName>/ prefix
    const content = fs.readFileSync(agentFile, "utf8");
    assert.match(content, /\.opencode\/mock-plugin\/rules\/common\/test-rule\.md/);

    // Registry tracks agents
    const registry = readRegistry(projectRoot);
    assert.deepEqual(registry.installations["mock-marketplace"].agents, ["reviewer"]);
  } finally {
    cleanup(tmpDir);
  }
});

test("install handles duplicate command/agent names across plugins in same marketplace", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = path.join(tmpDir, "duplicate-names-mp");
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(path.join(marketplaceDir, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "plugin-a", "commands"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "plugin-a", "agents"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "plugin-b", "commands"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "plugin-b", "agents"), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });

  fs.writeFileSync(
    path.join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "duplicate-names-mp",
      plugins: [
        { name: "plugin-a", source: "plugin-a" },
        { name: "plugin-b", source: "plugin-b" },
      ],
    }),
    "utf8",
  );

  fs.writeFileSync(
    path.join(marketplaceDir, "plugin-a", "commands", "shared.md"),
    "command-from-a",
    "utf8",
  );
  fs.writeFileSync(
    path.join(marketplaceDir, "plugin-b", "commands", "shared.md"),
    "command-from-b",
    "utf8",
  );
  fs.writeFileSync(
    path.join(marketplaceDir, "plugin-a", "agents", "shared.md"),
    "agent-from-a",
    "utf8",
  );
  fs.writeFileSync(
    path.join(marketplaceDir, "plugin-b", "agents", "shared.md"),
    "agent-from-b",
    "utf8",
  );

  try {
    await install(marketplaceDir, null, projectRoot);

    assert.equal(
      fs.readFileSync(path.join(projectRoot, ".opencode", "commands", "shared.md"), "utf8"),
      "command-from-b",
    );
    assert.equal(
      fs.readFileSync(path.join(projectRoot, ".opencode", "agents", "shared.md"), "utf8"),
      "agent-from-b",
    );

    const entry = readRegistry(projectRoot).installations["duplicate-names-mp"];
    assert.deepEqual(entry.commands, ["shared"]);
    assert.deepEqual(entry.agents, ["shared"]);
  } finally {
    cleanup(tmpDir);
  }
});

test("install copies only referenced files to .opencode/<pluginName>/", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = path.join(tmpDir, "smart-mp");
  fs.mkdirSync(path.join(marketplaceDir, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "skills", "review"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "rules", "common"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "templates"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "docs"), { recursive: true });

  fs.writeFileSync(
    path.join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "smart-mp", plugins: [{ name: "smart-mp", source: "./" }] }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(marketplaceDir, "skills", "review", "SKILL.md"),
    "Read `rules/common/test.md` and `templates/pr.md`.",
    "utf8",
  );
  fs.writeFileSync(path.join(marketplaceDir, "rules", "common", "test.md"), "rule", "utf8");
  fs.writeFileSync(path.join(marketplaceDir, "templates", "pr.md"), "template", "utf8");
  fs.writeFileSync(path.join(marketplaceDir, "docs", "guide.md"), "unreferenced", "utf8");
  fs.writeFileSync(path.join(marketplaceDir, "package.json"), "{}", "utf8");
  fs.writeFileSync(path.join(marketplaceDir, "LICENSE"), "MIT", "utf8");

  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    // Referenced files placed at .opencode/<pluginName>/
    assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "smart-mp", "rules", "common", "test.md")), true);
    assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "smart-mp", "templates", "pr.md")), true);

    // Marker at .opencode/<pluginName>/
    assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "smart-mp", ".ombc-managed")), true);

    // Unreferenced dirs/files NOT placed
    assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "smart-mp", "docs")), false);
    assert.equal(fs.existsSync(path.join(projectRoot, "docs")), false);
    assert.equal(fs.existsSync(path.join(projectRoot, "package.json")), false);

    // Skills installed with rewritten paths
    const skillContent = fs.readFileSync(
      path.join(projectRoot, ".opencode", "skills", "review", "SKILL.md"),
      "utf8",
    );
    assert.match(skillContent, /\.opencode\/smart-mp\/rules\/common\/test\.md/);
    assert.match(skillContent, /\.opencode\/smart-mp\/templates\/pr\.md/);

    // Registry has placedDirs
    const registry = readRegistry(projectRoot);
    const entry = registry.installations["smart-mp"];
    assert.deepEqual(entry.placedDirs, [".opencode/smart-mp"]);
    assert.equal(entry.cacheDir, undefined);
  } finally {
    cleanup(tmpDir);
  }
});

test("install supports referenced directory symlink inside marketplace root", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = path.join(tmpDir, "symlink-rules-mp");
  fs.mkdirSync(path.join(marketplaceDir, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "skills", "review"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "assets", "rules-real", "common"), { recursive: true });

  fs.writeFileSync(
    path.join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "symlink-rules-mp",
      plugins: [{ name: "symlink-rules-mp", source: "./" }],
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(marketplaceDir, "skills", "review", "SKILL.md"),
    "Read rules/common/test.md first.",
    "utf8",
  );
  fs.writeFileSync(
    path.join(marketplaceDir, "assets", "rules-real", "common", "test.md"),
    "symlinked rules content",
    "utf8",
  );
  fs.symlinkSync(
    path.join(marketplaceDir, "assets", "rules-real"),
    path.join(marketplaceDir, "rules"),
    "dir",
  );

  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "symlink-rules-mp", "rules", "common", "test.md")), true);
    const registry = readRegistry(projectRoot);
    assert.deepEqual(registry.installations["symlink-rules-mp"].placedDirs, [".opencode/symlink-rules-mp"]);
  } finally {
    cleanup(tmpDir);
  }
});

test("install copies symlinked files inside referenced directories", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = path.join(tmpDir, "symlink-rule-file-mp");
  fs.mkdirSync(path.join(marketplaceDir, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "skills", "review"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "rules", "common"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "shared"), { recursive: true });

  fs.writeFileSync(
    path.join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "symlink-rule-file-mp",
      plugins: [{ name: "symlink-rule-file-mp", source: "./" }],
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(marketplaceDir, "skills", "review", "SKILL.md"),
    "Read rules/common/test.md first.",
    "utf8",
  );
  fs.writeFileSync(path.join(marketplaceDir, "shared", "test.md"), "linked rule", "utf8");
  fs.symlinkSync(
    path.join(marketplaceDir, "shared", "test.md"),
    path.join(marketplaceDir, "rules", "common", "test.md"),
    "file",
  );

  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    const copiedPath = path.join(projectRoot, ".opencode", "symlink-rule-file-mp", "rules", "common", "test.md");
    assert.equal(fs.existsSync(copiedPath), true);
    assert.equal(fs.readFileSync(copiedPath, "utf8"), "linked rule");
  } finally {
    cleanup(tmpDir);
  }
});

test("install rejects referenced directory symlink that escapes marketplace root", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = path.join(tmpDir, "symlink-escape-rules-mp");
  const outsideDir = path.join(tmpDir, "outside-rules");
  fs.mkdirSync(path.join(marketplaceDir, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "skills", "review"), { recursive: true });
  fs.mkdirSync(path.join(outsideDir, "common"), { recursive: true });
  fs.writeFileSync(path.join(outsideDir, "common", "test.md"), "outside", "utf8");

  fs.writeFileSync(
    path.join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "symlink-escape-rules-mp",
      plugins: [{ name: "symlink-escape-rules-mp", source: "./" }],
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(marketplaceDir, "skills", "review", "SKILL.md"),
    "Read rules/common/test.md first.",
    "utf8",
  );
  fs.symlinkSync(outsideDir, path.join(marketplaceDir, "rules"), "dir");

  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await assert.rejects(
      () => install(marketplaceDir, null, projectRoot),
      { message: /Symbolic link escapes/ },
    );

    assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "symlink-escape-rules-mp", "rules", "common", "test.md")), false);
    assert.equal("symlink-escape-rules-mp" in readRegistry(projectRoot).installations, false);
  } finally {
    cleanup(tmpDir);
  }
});

test("install with nested plugin source places dirs at nested path", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = path.join(tmpDir, "nested-mp");
  fs.mkdirSync(path.join(marketplaceDir, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "plugins", "my-plugin", "skills", "review"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "plugins", "my-plugin", "rules", "common"), { recursive: true });

  fs.writeFileSync(
    path.join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "nested-mp",
      plugins: [{ name: "my-plugin", source: "plugins/my-plugin" }],
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(marketplaceDir, "plugins", "my-plugin", "skills", "review", "SKILL.md"),
    "Read `rules/common/test.md` for context.",
    "utf8",
  );
  fs.writeFileSync(
    path.join(marketplaceDir, "plugins", "my-plugin", "rules", "common", "test.md"),
    "# Nested Rule",
    "utf8",
  );

  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    // Rules placed at .opencode/<pluginName>/
    const ruleFile = path.join(projectRoot, ".opencode", "my-plugin", "rules", "common", "test.md");
    assert.equal(fs.existsSync(ruleFile), true);

    // Marker at .opencode/<pluginName>/
    const placedMarker = path.join(projectRoot, ".opencode", "my-plugin", ".ombc-managed");
    assert.equal(fs.existsSync(placedMarker), true);

    // Skills installed
    const skillPath = path.join(projectRoot, ".opencode", "skills", "review", "SKILL.md");
    assert.equal(fs.existsSync(skillPath), true);

    // Registry has .opencode/<pluginName> as placedDirs
    const registry = readRegistry(projectRoot);
    const entry = registry.installations["nested-mp"];
    assert.deepEqual(entry.placedDirs, [".opencode/my-plugin"]);
  } finally {
    cleanup(tmpDir);
  }
});

test("install normalizes .opencode/plugins/ refs to plugin-root-relative paths", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = path.join(tmpDir, "opencode-ref-mp");
  fs.mkdirSync(path.join(marketplaceDir, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "skills", "review"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "rules", "common"), { recursive: true });

  fs.writeFileSync(
    path.join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "opencode-ref-mp",
      plugins: [{ name: "opencode-ref-mp", source: "./" }],
    }),
    "utf8",
  );

  fs.writeFileSync(
    path.join(marketplaceDir, "skills", "review", "SKILL.md"),
    [
      "Read rules/common/review.md first.",
      "@.opencode/plugins/spec-driven-roundtrip-engine/rules/boundary-definition.md",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(marketplaceDir, "rules", "common", "review.md"), "rule", "utf8");

  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    // Referenced file copied to .opencode/<pluginName>/
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "opencode-ref-mp", "rules", "common", "review.md")),
      true,
    );
    // No repository root plugins dir
    assert.equal(fs.existsSync(path.join(projectRoot, "plugins")), false);
    // No root-level rules dir
    assert.equal(fs.existsSync(path.join(projectRoot, "rules")), false);

    const registry = readRegistry(projectRoot);
    assert.deepEqual(registry.installations["opencode-ref-mp"].placedDirs, [".opencode/opencode-ref-mp"]);
  } finally {
    cleanup(tmpDir);
  }
});

test("install normalizes model field in agents", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = createMockMarketplace(tmpDir, {
    agents: {
      "reviewer": "---\nname: reviewer\nmodel: sonnet\ntools: Read, Grep\n---\nReview code.",
    },
  });
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    const content = fs.readFileSync(
      path.join(projectRoot, ".opencode", "agents", "reviewer.md"),
      "utf8",
    );
    assert.match(content, /model: anthropic\/claude-sonnet-4-5/);
    assert.doesNotMatch(content, /model: sonnet/);
  } finally {
    cleanup(tmpDir);
  }
});

test("install normalizes tools field in agents", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = createMockMarketplace(tmpDir, {
    agents: {
      "reviewer": '---\nname: reviewer\ntools: ["Read", "Grep", "Glob"]\n---\nUse rules/common/test-rule.md for review.',
    },
  });
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    const agentFile = path.join(projectRoot, ".opencode", "agents", "reviewer.md");
    const content = fs.readFileSync(agentFile, "utf8");

    // tools field normalized to YAML record with lowercase keys
    assert.match(content, /tools:\n {2}read: true\n {2}grep: true\n {2}glob: true/);
    assert.doesNotMatch(content, /\["Read"/);
    assert.doesNotMatch(content, /tools: Read/);

    // No cache path rewriting
    assert.doesNotMatch(content, /\.opencode\/plugins\/cache/);
  } finally {
    cleanup(tmpDir);
  }
});

test("install normalizes tools field in skills", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = path.join(tmpDir, "tools-skill-marketplace");
  fs.mkdirSync(path.join(marketplaceDir, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "skills", "review-skill"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "rules", "common"), { recursive: true });

  fs.writeFileSync(
    path.join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "tools-test",
      plugins: [{ name: "tools-test", source: "./" }],
    }),
    "utf8",
  );

  fs.writeFileSync(
    path.join(marketplaceDir, "skills", "review-skill", "SKILL.md"),
    '---\nname: review-skill\ntools: ["Read", "Grep"]\n---\nRead rules/common/test.md first.',
    "utf8",
  );

  fs.writeFileSync(
    path.join(marketplaceDir, "rules", "common", "test.md"),
    "# Test Rule",
    "utf8",
  );

  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    const skillPath = path.join(projectRoot, ".opencode", "skills", "review-skill", "SKILL.md");
    const content = fs.readFileSync(skillPath, "utf8");

    // tools field normalized to YAML record
    assert.match(content, /tools:\n {2}read: true\n {2}grep: true/);
    assert.doesNotMatch(content, /\["Read"/);
    assert.doesNotMatch(content, /tools: Read/);

    // No cache path rewriting
    assert.doesNotMatch(content, /\.opencode\/plugins\/cache/);
  } finally {
    cleanup(tmpDir);
  }
});

test("install with skills + commands + agents together", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = createMockMarketplace(tmpDir, {
    commands: { "hello": "---\ndescription: Greet\n---\nHello!" },
    agents: { "oracle": "---\nname: oracle\n---\nDebug agent." },
  });
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    // All three types installed
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "skills", "test-skill", "SKILL.md")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "commands", "hello.md")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "agents", "oracle.md")),
      true,
    );

    // Rules placed at .opencode/<pluginName>/
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "mock-plugin", "rules", "common", "test-rule.md")),
      true,
    );

    // No cache directory
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "plugins", "cache")),
      false,
    );

    // Registry tracks all with placedDirs
    const registry = readRegistry(projectRoot);
    const entry = registry.installations["mock-marketplace"];
    assert.deepEqual(entry.skills, ["test-skill"]);
    assert.deepEqual(entry.commands, ["hello"]);
    assert.deepEqual(entry.agents, ["oracle"]);
    assert.deepEqual(entry.placedDirs, [".opencode/mock-plugin"]);
    assert.equal(entry.cacheDir, undefined);
  } finally {
    cleanup(tmpDir);
  }
});

// --- Idempotency ---

test("install is idempotent — reinstall replaces placed dirs and files", async () => {
  const tmpDir = makeTempDir();
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(fixtureRoot, null, projectRoot);

    const skillPath = path.join(
      projectRoot, ".opencode", "skills", "code-review", "SKILL.md",
    );
    const contentBefore = fs.readFileSync(skillPath, "utf8");

    // Second install (idempotent)
    await install(fixtureRoot, null, projectRoot);

    const contentAfter = fs.readFileSync(skillPath, "utf8");
    assert.equal(contentBefore, contentAfter);

    // Registry still valid
    const registry = readRegistry(projectRoot);
    assert.equal("ombc-fixture" in registry.installations, true);
    assert.ok(registry.installations["ombc-fixture"].installedAt);
    assert.ok(registry.installations["ombc-fixture"].lastUpdated);

    // Placed dirs still exist
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "ombc-fixture", "rules", "common", "review-baseline.md")),
      true,
    );
  } finally {
    cleanup(tmpDir);
  }
});

test("reinstall with commands/agents replaces old files", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = createMockMarketplace(tmpDir, {
    commands: { "hello": "v1 content" },
    agents: { "oracle": "v1 agent" },
  });
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    // Modify source
    fs.writeFileSync(
      path.join(marketplaceDir, "commands", "hello.md"),
      "v2 content",
      "utf8",
    );

    // Reinstall
    await install(marketplaceDir, null, projectRoot);

    const content = fs.readFileSync(
      path.join(projectRoot, ".opencode", "commands", "hello.md"),
      "utf8",
    );
    assert.equal(content, "v2 content");
  } finally {
    cleanup(tmpDir);
  }
});

// --- User-managed protection ---

test("install skips user-managed skills", async () => {
  const tmpDir = makeTempDir();
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    // Create a user-managed skill with same name
    const userSkillDir = path.join(projectRoot, ".opencode", "skills", "code-review");
    fs.mkdirSync(userSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(userSkillDir, "SKILL.md"),
      "user managed skill\n",
      "utf8",
    );

    await install(fixtureRoot, null, projectRoot);

    // User skill preserved
    const content = fs.readFileSync(path.join(userSkillDir, "SKILL.md"), "utf8");
    assert.equal(content, "user managed skill\n");

    // No marker on user skill
    assert.equal(
      fs.existsSync(path.join(userSkillDir, ".ombc-managed")),
      false,
    );

    // Other skills still installed
    const prSkill = path.join(
      projectRoot, ".opencode", "skills", "pr-create", "SKILL.md",
    );
    assert.equal(fs.existsSync(prSkill), true);

    // Registry records only installed skills (not skipped ones)
    const registry = readRegistry(projectRoot);
    assert.equal(registry.installations["ombc-fixture"].skills.includes("pr-create"), true);
    assert.equal(registry.installations["ombc-fixture"].skills.includes("code-review"), false);
  } finally {
    cleanup(tmpDir);
  }
});

test("install skips user-managed commands", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = createMockMarketplace(tmpDir, {
    commands: { "review": "marketplace review command" },
  });
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    // Create user command first
    const cmdDir = path.join(projectRoot, ".opencode", "commands");
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.writeFileSync(path.join(cmdDir, "review.md"), "user review command\n", "utf8");

    await install(marketplaceDir, null, projectRoot);

    // User command preserved
    const content = fs.readFileSync(path.join(cmdDir, "review.md"), "utf8");
    assert.equal(content, "user review command\n");

    // Registry does not include skipped command
    const registry = readRegistry(projectRoot);
    assert.equal(registry.installations["mock-marketplace"].commands.includes("review"), false);
  } finally {
    cleanup(tmpDir);
  }
});

test("install skips user-managed agents", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = createMockMarketplace(tmpDir, {
    agents: { "oracle": "marketplace oracle agent" },
  });
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    // Create user agent first
    const agentDir = path.join(projectRoot, ".opencode", "agents");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "oracle.md"), "user oracle agent\n", "utf8");

    await install(marketplaceDir, null, projectRoot);

    // User agent preserved
    const content = fs.readFileSync(path.join(agentDir, "oracle.md"), "utf8");
    assert.equal(content, "user oracle agent\n");

    // Registry does not include skipped agent
    const registry = readRegistry(projectRoot);
    assert.equal(registry.installations["mock-marketplace"].agents.includes("oracle"), false);
  } finally {
    cleanup(tmpDir);
  }
});

// --- uninstall ---

test("uninstall removes skills, commands, agents, placed dirs, and registry entry", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = createMockMarketplace(tmpDir, {
    commands: { "hello": "hello cmd" },
    agents: { "oracle": "oracle agent" },
  });
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);
    uninstall("mock-marketplace", projectRoot);

    // Skills removed
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "skills", "test-skill")),
      false,
    );

    // Commands removed
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "commands", "hello.md")),
      false,
    );

    // Agents removed
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "agents", "oracle.md")),
      false,
    );

    // Placed dirs removed (.opencode/<pluginName>/)
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "mock-plugin")),
      false,
    );

    // Registry entry removed
    const registry = readRegistry(projectRoot);
    assert.equal("mock-marketplace" in registry.installations, false);
  } finally {
    cleanup(tmpDir);
  }
});

test("uninstall cleans up nested placed dirs and empty parents", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = path.join(tmpDir, "nested-mp");
  fs.mkdirSync(path.join(marketplaceDir, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "plugins", "my-plugin", "skills", "review"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "plugins", "my-plugin", "rules", "common"), { recursive: true });

  fs.writeFileSync(
    path.join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "nested-mp",
      plugins: [{ name: "my-plugin", source: "plugins/my-plugin" }],
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(marketplaceDir, "plugins", "my-plugin", "skills", "review", "SKILL.md"),
    "Read `rules/common/test.md` for context.",
    "utf8",
  );
  fs.writeFileSync(
    path.join(marketplaceDir, "plugins", "my-plugin", "rules", "common", "test.md"),
    "# Nested Rule",
    "utf8",
  );

  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    // Verify placed
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "my-plugin", "rules", "common", "test.md")),
      true,
    );

    uninstall("nested-mp", projectRoot);

    // Placed dirs removed
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "my-plugin")),
      false,
    );
  } finally {
    cleanup(tmpDir);
  }
});

test("uninstall preserves user-managed skills", async () => {
  const tmpDir = makeTempDir();
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    // Create user skill before install
    const userSkillDir = path.join(projectRoot, ".opencode", "skills", "code-review");
    fs.mkdirSync(userSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(userSkillDir, "SKILL.md"),
      "user managed skill\n",
      "utf8",
    );

    await install(fixtureRoot, null, projectRoot);
    uninstall("ombc-fixture", projectRoot);

    // User skill preserved
    assert.equal(
      fs.readFileSync(path.join(userSkillDir, "SKILL.md"), "utf8"),
      "user managed skill\n",
    );
  } finally {
    cleanup(tmpDir);
  }
});

test("uninstall for non-installed marketplace exits gracefully", () => {
  const tmpDir = makeTempDir();
  try {
    uninstall("non-existent", tmpDir);

    const registry = readRegistry(tmpDir);
    assert.deepEqual(registry.installations, {});
  } finally {
    cleanup(tmpDir);
  }
});

test("uninstall cleans up legacy cache from previous version", async () => {
  const tmpDir = makeTempDir();
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    // Simulate a registry entry from the old cache-based version
    const registryPath = path.join(projectRoot, ".opencode", ".ombc-registry.json");
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    const legacyCacheDir = path.join(projectRoot, ".opencode", "plugins", "cache", "old-mp");
    fs.mkdirSync(path.join(legacyCacheDir, "rules", "common"), { recursive: true });
    fs.writeFileSync(path.join(legacyCacheDir, "rules", "common", "test.md"), "old rule", "utf8");

    const registry = {
      installations: {
        "old-mp": {
          source: "./old-source",
          plugins: ["old-plugin"],
          skills: [],
          commands: [],
          agents: [],
          cacheDir: ".opencode/plugins/cache/old-mp",
        },
      },
    };
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf8");

    uninstall("old-mp", projectRoot);

    // Legacy cache removed
    assert.equal(fs.existsSync(legacyCacheDir), false);

    // Registry entry removed
    const updatedRegistry = readRegistry(projectRoot);
    assert.equal("old-mp" in updatedRegistry.installations, false);
  } finally {
    cleanup(tmpDir);
  }
});

test("uninstall removes .opencode/<plugin>/ via placedDirs", () => {
  const tmpDir = makeTempDir();
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    const opencodeDir = path.join(projectRoot, ".opencode");
    const pluginDir = path.join(opencodeDir, "old-plugin");
    const rulesDir = path.join(pluginDir, "rules", "common");
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, "old-rule.md"), "legacy rule", "utf8");
    fs.writeFileSync(path.join(pluginDir, ".ombc-managed"), "old-mp\n", "utf8");

    writeRegistry(projectRoot, {
      installations: {
        "old-mp": {
          source: "./legacy",
          plugins: ["old-plugin"],
          skills: [],
          commands: [],
          agents: [],
          placedDirs: [".opencode/old-plugin"],
        },
      },
    });

    uninstall("old-mp", projectRoot);

    assert.equal(fs.existsSync(path.join(opencodeDir, "old-plugin")), false);
  } finally {
    cleanup(tmpDir);
  }
});

// --- Legacy cache cleanup on reinstall ---

test("install cleans up legacy cache from previous version on reinstall", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = createMockMarketplace(tmpDir);
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    // Simulate a registry entry from the old cache-based version
    const registryPath = path.join(projectRoot, ".opencode", ".ombc-registry.json");
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    const legacyCacheDir = path.join(projectRoot, ".opencode", "plugins", "cache", "mock-marketplace");
    fs.mkdirSync(path.join(legacyCacheDir, "rules", "common"), { recursive: true });
    fs.writeFileSync(path.join(legacyCacheDir, "rules", "common", "test.md"), "old rule", "utf8");

    const registry = {
      installations: {
        "mock-marketplace": {
          source: marketplaceDir,
          plugins: ["mock-plugin"],
          skills: ["test-skill"],
          commands: [],
          agents: [],
          cacheDir: ".opencode/plugins/cache/mock-marketplace",
        },
      },
    };
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), "utf8");

    // Reinstall — should clean up legacy cache
    await install(marketplaceDir, null, projectRoot);

    // Legacy cache removed
    assert.equal(fs.existsSync(legacyCacheDir), false);

    // New placement at .opencode/<pluginName>/
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "mock-plugin", "rules", "common", "test-rule.md")),
      true,
    );

    // Registry updated with placedDirs, no cacheDir
    const updatedRegistry = readRegistry(projectRoot);
    const entry = updatedRegistry.installations["mock-marketplace"];
    assert.deepEqual(entry.placedDirs, [".opencode/mock-plugin"]);
    assert.equal(entry.cacheDir, undefined);
  } finally {
    cleanup(tmpDir);
  }
});

// --- list ---

test("list shows installed marketplaces with skills, commands, agents", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = createMockMarketplace(tmpDir, {
    commands: { "hello": "hello" },
    agents: { "oracle": "oracle" },
  });
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    const originalLog = console.log;
    const output = [];
    console.log = (...args) => output.push(args.join(" "));

    list(projectRoot);

    console.log = originalLog;

    assert.equal(output.length, 1);
    assert.match(output[0], /mock-marketplace/);
    assert.match(output[0], /Skills\s+: test-skill/);
    assert.match(output[0], /Commands\s+: hello/);
    assert.match(output[0], /Agents\s+: oracle/);
  } finally {
    cleanup(tmpDir);
  }
});

test("list shows empty message when nothing installed", () => {
  const tmpDir = makeTempDir();
  try {
    const originalLog = console.log;
    const output = [];
    console.log = (...args) => output.push(args.join(" "));

    list(tmpDir);

    console.log = originalLog;

    assert.equal(output.length, 1);
    assert.match(output[0], /No marketplaces installed/);
  } finally {
    cleanup(tmpDir);
  }
});

// --- CLI subprocess integration ---

test("CLI install from local path works end-to-end", () => {
  const tmpDir = makeTempDir();
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    const run = spawnSync(
      process.execPath,
      [cliPath, "install", fixtureRoot],
      { cwd: projectRoot, encoding: "utf8" },
    );

    assert.equal(run.status, 0, `stderr: ${run.stderr}`);
    assert.match(run.stdout, /OMBC INSTALL ASCII REPORT/);
    assert.match(run.stdout, /Marketplace\s+: ombc-fixture/);

    // Skills exist
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "skills", "code-review", "SKILL.md")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "skills", "pr-create", "SKILL.md")),
      true,
    );

    // Rules placed at .opencode/<pluginName>/
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "ombc-fixture", "rules", "common", "review-baseline.md")),
      true,
    );

    // No rules at project root
    assert.equal(fs.existsSync(path.join(projectRoot, "rules")), false);

    // Registry exists
    assert.equal(
      fs.existsSync(
        path.join(projectRoot, ".opencode", ".ombc-registry.json"),
      ),
      true,
    );
  } finally {
    cleanup(tmpDir);
  }
});

test("CLI list works end-to-end", () => {
  const tmpDir = makeTempDir();
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    spawnSync(process.execPath, [cliPath, "install", fixtureRoot], {
      cwd: projectRoot,
      encoding: "utf8",
    });

    const run = spawnSync(process.execPath, [cliPath, "list"], {
      cwd: projectRoot,
      encoding: "utf8",
    });

    assert.equal(run.status, 0, `stderr: ${run.stderr}`);
    assert.match(run.stdout, /ombc-fixture/);
    assert.match(run.stdout, /Skills\s+: code-review, pr-create/);
  } finally {
    cleanup(tmpDir);
  }
});

test("CLI uninstall works end-to-end", () => {
  const tmpDir = makeTempDir();
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    spawnSync(process.execPath, [cliPath, "install", fixtureRoot], {
      cwd: projectRoot,
      encoding: "utf8",
    });

    const run = spawnSync(process.execPath, [cliPath, "uninstall", "ombc-fixture"], {
      cwd: projectRoot,
      encoding: "utf8",
    });

    assert.equal(run.status, 0, `stderr: ${run.stderr}`);
    assert.match(run.stdout, /Uninstalled ombc-fixture/);

    // Skills removed
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "skills", "code-review")),
      false,
    );

    // Placed dirs removed
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "ombc-fixture")),
      false,
    );
  } finally {
    cleanup(tmpDir);
  }
});

test("CLI shows help with no arguments", () => {
  const run = spawnSync(process.execPath, [cliPath], { encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /ombc CLI/);
  assert.match(run.stdout, /install <source>/);
});

test("CLI returns non-zero for unknown command", () => {
  const run = spawnSync(process.execPath, [cliPath, "unknown"], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Unknown command: unknown/);
});

test("CLI install without source shows error", () => {
  const run = spawnSync(process.execPath, [cliPath, "install"], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /source is required/);
});

test("CLI uninstall without name shows error", () => {
  const run = spawnSync(process.execPath, [cliPath, "uninstall"], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /name is required/);
});

test("CLI install with non-existent local path shows error", () => {
  const run = spawnSync(
    process.execPath,
    [cliPath, "install", "/non/existent/path"],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Local path not found/);
});

// --- Mock marketplace full tests ---

test("install from mock marketplace places rules at .opencode/<pluginName>/", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = createMockMarketplace(tmpDir);
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    // Skill installed with rewritten paths
    const skillPath = path.join(
      projectRoot, ".opencode", "skills", "test-skill", "SKILL.md",
    );
    const content = fs.readFileSync(skillPath, "utf8");
    assert.match(content, /\.opencode\/mock-plugin\/rules\/common\/test-rule\.md/);

    // Rules placed at .opencode/<pluginName>/
    const ruleFile = path.join(projectRoot, ".opencode", "mock-plugin", "rules", "common", "test-rule.md");
    assert.equal(fs.existsSync(ruleFile), true);

    // Marker at .opencode/<pluginName>/
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "mock-plugin", ".ombc-managed")),
      true,
    );

    // No rules at project root
    assert.equal(fs.existsSync(path.join(projectRoot, "rules")), false);

    // Registry uses marketplace name as key with placedDirs
    const registry = readRegistry(projectRoot);
    assert.equal("mock-marketplace" in registry.installations, true);
    assert.deepEqual(registry.installations["mock-marketplace"].plugins, ["mock-plugin"]);
    assert.deepEqual(registry.installations["mock-marketplace"].placedDirs, [".opencode/mock-plugin"]);
    assert.equal(registry.installations["mock-marketplace"].cacheDir, undefined);
  } finally {
    cleanup(tmpDir);
  }
});

// --- Marker ownership ---

test("marker records marketplace name", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = createMockMarketplace(tmpDir);
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    const markerPath = path.join(
      projectRoot, ".opencode", "skills", "test-skill", ".ombc-managed",
    );
    const owner = readMarkerOwner(markerPath);
    assert.equal(owner, "mock-marketplace");
  } finally {
    cleanup(tmpDir);
  }
});

test("writeMarker removes legacy marker file", () => {
  const tmpDir = makeTempDir();
  try {
    const skillDir = path.join(tmpDir, ".opencode", "skills", "demo");
    fs.mkdirSync(skillDir, { recursive: true });

    const legacyMarker = path.join(skillDir, ".my-marketplace-managed");
    const marker = path.join(skillDir, ".ombc-managed");
    fs.writeFileSync(legacyMarker, "legacy-owner\n", "utf8");

    writeMarker(marker, "modern-owner");

    assert.equal(fs.existsSync(legacyMarker), false);
    assert.equal(fs.existsSync(marker), true);
    assert.equal(readMarkerOwner(marker), "modern-owner");
  } finally {
    cleanup(tmpDir);
  }
});

test("readRegistry falls back to legacy registry path", () => {
  const tmpDir = makeTempDir();
  try {
    const legacyRegistryPath = path.join(tmpDir, ".opencode", ".my-marketplace-registry.json");
    fs.mkdirSync(path.dirname(legacyRegistryPath), { recursive: true });
    fs.writeFileSync(
      legacyRegistryPath,
      JSON.stringify({
        installations: {
          "legacy-mp": {
            source: "./legacy",
            plugins: ["legacy-plugin"],
            skills: ["legacy-skill"],
            commands: [],
            agents: [],
            placedDirs: ["rules"],
          },
        },
      }),
      "utf8",
    );

    const registry = readRegistry(tmpDir);
    assert.equal("legacy-mp" in registry.installations, true);
    assert.deepEqual(registry.installations["legacy-mp"].skills, ["legacy-skill"]);
  } finally {
    cleanup(tmpDir);
  }
});

test("writeRegistry removes legacy registry file", () => {
  const tmpDir = makeTempDir();
  try {
    const opencodeDir = path.join(tmpDir, ".opencode");
    fs.mkdirSync(opencodeDir, { recursive: true });

    const legacyRegistryPath = path.join(opencodeDir, ".my-marketplace-registry.json");
    fs.writeFileSync(legacyRegistryPath, JSON.stringify({ installations: {} }), "utf8");

    writeRegistry(tmpDir, {
      installations: {
        "new-mp": {
          source: "./new",
          plugins: ["new-plugin"],
          skills: [],
          commands: [],
          agents: [],
          placedDirs: [],
        },
      },
    });

    const newRegistryPath = path.join(opencodeDir, ".ombc-registry.json");
    assert.equal(fs.existsSync(newRegistryPath), true);
    assert.equal(fs.existsSync(legacyRegistryPath), false);
  } finally {
    cleanup(tmpDir);
  }
});

// --- Cross-marketplace conflict ---

test("install skips skills owned by another marketplace (default)", async () => {
  const tmpDir = makeTempDir();
  const firstDir = createMockMarketplace(tmpDir);
  const secondDir = createSecondMarketplace(tmpDir);
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    // Install first marketplace (owns test-skill)
    await install(firstDir, null, projectRoot);

    const skillPath = path.join(
      projectRoot, ".opencode", "skills", "test-skill", "SKILL.md",
    );
    const firstContent = fs.readFileSync(skillPath, "utf8");
    assert.match(firstContent, /rules\/common/);

    // Install second marketplace (has same test-skill) → should skip
    await install(secondDir, null, projectRoot);

    // First marketplace's skill preserved
    const afterContent = fs.readFileSync(skillPath, "utf8");
    assert.equal(afterContent, firstContent);

    // Marker still belongs to first marketplace
    const markerPath = path.join(
      projectRoot, ".opencode", "skills", "test-skill", ".ombc-managed",
    );
    assert.equal(readMarkerOwner(markerPath), "mock-marketplace");

    // Second marketplace registry does NOT include the skipped skill
    const registry = readRegistry(projectRoot);
    assert.equal(registry.installations["second-marketplace"].skills.includes("test-skill"), false);
  } finally {
    cleanup(tmpDir);
  }
});

test("install --force overwrites skills owned by another marketplace", async () => {
  const tmpDir = makeTempDir();
  const firstDir = createMockMarketplace(tmpDir);
  const secondDir = createSecondMarketplace(tmpDir);
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(firstDir, null, projectRoot);

    // Force install second marketplace
    await install(secondDir, null, projectRoot, { force: true });

    // Second marketplace's skill is now installed
    const skillPath = path.join(
      projectRoot, ".opencode", "skills", "test-skill", "SKILL.md",
    );
    const content = fs.readFileSync(skillPath, "utf8");
    assert.match(content, /Second marketplace skill/);

    // Marker updated to second marketplace
    const markerPath = path.join(
      projectRoot, ".opencode", "skills", "test-skill", ".ombc-managed",
    );
    assert.equal(readMarkerOwner(markerPath), "second-marketplace");

    // Second marketplace registry includes the skill
    const registry = readRegistry(projectRoot);
    assert.deepEqual(registry.installations["second-marketplace"].skills, ["test-skill"]);
  } finally {
    cleanup(tmpDir);
  }
});

test("install --force still protects user-managed skills", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = createMockMarketplace(tmpDir);
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    // Create user skill
    const userSkillDir = path.join(projectRoot, ".opencode", "skills", "test-skill");
    fs.mkdirSync(userSkillDir, { recursive: true });
    fs.writeFileSync(path.join(userSkillDir, "SKILL.md"), "user skill\n", "utf8");

    // Force install — user skills still protected
    await install(marketplaceDir, null, projectRoot, { force: true });

    const content = fs.readFileSync(path.join(userSkillDir, "SKILL.md"), "utf8");
    assert.equal(content, "user skill\n");
    assert.equal(
      fs.existsSync(path.join(userSkillDir, ".ombc-managed")),
      false,
    );
  } finally {
    cleanup(tmpDir);
  }
});

test("install skips commands owned by another marketplace (default)", async () => {
  const tmpDir = makeTempDir();
  const firstDir = createMockMarketplace(tmpDir, {
    commands: { "shared-cmd": "first marketplace command" },
  });
  const secondDir = createSecondMarketplace(tmpDir, {
    commands: { "shared-cmd": "second marketplace command" },
  });
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(firstDir, null, projectRoot);
    await install(secondDir, null, projectRoot);

    // First marketplace's command preserved
    const content = fs.readFileSync(
      path.join(projectRoot, ".opencode", "commands", "shared-cmd.md"),
      "utf8",
    );
    assert.equal(content, "first marketplace command");

    // Second marketplace registry does not include skipped command
    const registry = readRegistry(projectRoot);
    assert.equal(registry.installations["second-marketplace"].commands.includes("shared-cmd"), false);
  } finally {
    cleanup(tmpDir);
  }
});

test("install --force overwrites commands owned by another marketplace", async () => {
  const tmpDir = makeTempDir();
  const firstDir = createMockMarketplace(tmpDir, {
    commands: { "shared-cmd": "first marketplace command" },
  });
  const secondDir = createSecondMarketplace(tmpDir, {
    commands: { "shared-cmd": "second marketplace command" },
  });
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(firstDir, null, projectRoot);
    await install(secondDir, null, projectRoot, { force: true });

    // Second marketplace's command installed
    const content = fs.readFileSync(
      path.join(projectRoot, ".opencode", "commands", "shared-cmd.md"),
      "utf8",
    );
    assert.equal(content, "second marketplace command");

    const registry = readRegistry(projectRoot);
    assert.deepEqual(registry.installations["second-marketplace"].commands, ["shared-cmd"]);
  } finally {
    cleanup(tmpDir);
  }
});

test("install --force still protects user-managed commands", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = createMockMarketplace(tmpDir, {
    commands: { "my-cmd": "marketplace command" },
  });
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    const cmdDir = path.join(projectRoot, ".opencode", "commands");
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.writeFileSync(path.join(cmdDir, "my-cmd.md"), "user command\n", "utf8");

    await install(marketplaceDir, null, projectRoot, { force: true });

    const content = fs.readFileSync(path.join(cmdDir, "my-cmd.md"), "utf8");
    assert.equal(content, "user command\n");
  } finally {
    cleanup(tmpDir);
  }
});

// --- CLI --force E2E ---

test("CLI install --force works end-to-end", () => {
  const tmpDir = makeTempDir();
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    const run = spawnSync(
      process.execPath,
      [cliPath, "install", fixtureRoot, "--force"],
      { cwd: projectRoot, encoding: "utf8" },
    );

    assert.equal(run.status, 0, `stderr: ${run.stderr}`);
    assert.match(run.stdout, /OMBC INSTALL ASCII REPORT/);
    assert.match(run.stdout, /Marketplace\s+: ombc-fixture/);
  } finally {
    cleanup(tmpDir);
  }
});

test("CLI help shows --force option", () => {
  const run = spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /--force/);
});

// --- extractFileReferences ---

test("extractFileReferences extracts bare dir/file references", () => {
  const content = "Read `rules/common/review.md` and `templates/pr.md`.";
  const refs = extractFileReferences(content, ["rules", "templates"]);
  assert.deepEqual(refs.sort(), ["rules/common/review.md", "templates/pr.md"]);
});

test("extractFileReferences handles leading-slash references", () => {
  const content = "Read /rules/common/review.md and /templates/pr.md.";
  const refs = extractFileReferences(content, ["rules", "templates"]);
  assert.deepEqual(refs.sort(), ["rules/common/review.md", "templates/pr.md"]);
});

test("extractFileReferences strips .opencode/<pluginName>/ prefix", () => {
  const content = "Read `.opencode/my-plugin/rules/common/review.md` first.";
  const refs = extractFileReferences(content, ["rules"]);
  assert.deepEqual(refs, ["rules/common/review.md"]);
});

test("extractFileReferences strips plugins/<bundle>/ prefix", () => {
  const content = "@plugins/spec-driven-roundtrip-engine/rules/boundary.md";
  const refs = extractFileReferences(content, ["rules"]);
  assert.deepEqual(refs, ["rules/boundary.md"]);
});

test("extractFileReferences strips .opencode/plugins/<bundle>/ prefix", () => {
  const content = "@.opencode/plugins/spec-driven-roundtrip-engine/rules/boundary.md";
  const refs = extractFileReferences(content, ["rules"]);
  assert.deepEqual(refs, ["rules/boundary.md"]);
});

test("extractFileReferences deduplicates results", () => {
  const content = [
    "Read rules/common/review.md first.",
    "Then re-read rules/common/review.md again.",
  ].join("\n");
  const refs = extractFileReferences(content, ["rules"]);
  assert.deepEqual(refs, ["rules/common/review.md"]);
});

test("extractFileReferences ignores unknown dirs", () => {
  const content = "Read unknown/file.md and rules/common/review.md.";
  const refs = extractFileReferences(content, ["rules"]);
  assert.deepEqual(refs, ["rules/common/review.md"]);
});

// --- buildDependencyGraph ---

test("buildDependencyGraph finds direct file references", () => {
  const tmpDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmpDir, "skills", "review"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "rules", "common"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "skills", "review", "SKILL.md"),
      "Read `rules/common/review.md` first.",
      "utf8",
    );
    fs.writeFileSync(path.join(tmpDir, "rules", "common", "review.md"), "rule content", "utf8");

    const { reachableFiles, reachableDirs } = buildDependencyGraph(tmpDir);
    assert.equal(reachableFiles.has("rules/common/review.md"), true);
    assert.equal(reachableDirs.has("rules"), true);
  } finally {
    cleanup(tmpDir);
  }
});

test("buildDependencyGraph finds leading-slash file references", () => {
  const tmpDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmpDir, "skills", "review"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "rules", "common"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "skills", "review", "SKILL.md"),
      "Read `/rules/common/review.md` first.",
      "utf8",
    );
    fs.writeFileSync(path.join(tmpDir, "rules", "common", "review.md"), "rule content", "utf8");

    const { reachableFiles, reachableDirs } = buildDependencyGraph(tmpDir);
    assert.equal(reachableFiles.has("rules/common/review.md"), true);
    assert.equal(reachableDirs.has("rules"), true);
  } finally {
    cleanup(tmpDir);
  }
});

test("buildDependencyGraph follows N-depth references", () => {
  const tmpDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmpDir, "skills", "review"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "rules", "common"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "templates"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "skills", "review", "SKILL.md"),
      "Read `rules/common/review.md` first.",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "rules", "common", "review.md"),
      "See `templates/checklist.md` for details.",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "templates", "checklist.md"),
      "Checklist content",
      "utf8",
    );

    const { reachableFiles, reachableDirs } = buildDependencyGraph(tmpDir);
    assert.equal(reachableFiles.has("rules/common/review.md"), true);
    assert.equal(reachableFiles.has("templates/checklist.md"), true);
    assert.equal(reachableDirs.has("rules"), true);
    assert.equal(reachableDirs.has("templates"), true);
  } finally {
    cleanup(tmpDir);
  }
});

test("buildDependencyGraph handles cycles without infinite loop", () => {
  const tmpDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmpDir, "skills", "review"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "rules", "common"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "templates"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "skills", "review", "SKILL.md"),
      "Read `rules/common/a.md` first.",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "rules", "common", "a.md"),
      "See `templates/b.md` for more.",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "templates", "b.md"),
      "Back to `rules/common/a.md` again.",
      "utf8",
    );

    const { reachableFiles } = buildDependencyGraph(tmpDir);
    assert.equal(reachableFiles.has("rules/common/a.md"), true);
    assert.equal(reachableFiles.has("templates/b.md"), true);
  } finally {
    cleanup(tmpDir);
  }
});

test("buildDependencyGraph excludes unreferenced files", () => {
  const tmpDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmpDir, "skills", "review"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "rules", "common"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "skills", "review", "SKILL.md"),
      "Read `rules/common/review.md` first.",
      "utf8",
    );
    fs.writeFileSync(path.join(tmpDir, "rules", "common", "review.md"), "rule", "utf8");
    fs.writeFileSync(path.join(tmpDir, "rules", "common", "unused.md"), "unused", "utf8");
    fs.writeFileSync(path.join(tmpDir, "docs", "guide.md"), "guide", "utf8");

    const { reachableFiles, reachableDirs } = buildDependencyGraph(tmpDir);
    assert.equal(reachableFiles.has("rules/common/review.md"), true);
    assert.equal(reachableFiles.has("rules/common/unused.md"), false);
    assert.equal(reachableFiles.has("docs/guide.md"), false);
    assert.equal(reachableDirs.has("docs"), false);
  } finally {
    cleanup(tmpDir);
  }
});

test("buildDependencyGraph handles directory references", () => {
  const tmpDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmpDir, "skills", "review"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "rules", "common"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "skills", "review", "SKILL.md"),
      "Read all files in `rules/common/` directory.",
      "utf8",
    );
    fs.writeFileSync(path.join(tmpDir, "rules", "common", "a.md"), "rule a", "utf8");
    fs.writeFileSync(path.join(tmpDir, "rules", "common", "b.md"), "rule b", "utf8");

    const { reachableFiles } = buildDependencyGraph(tmpDir);
    assert.equal(reachableFiles.has("rules/common/a.md"), true);
    assert.equal(reachableFiles.has("rules/common/b.md"), true);
  } finally {
    cleanup(tmpDir);
  }
});

// --- Recursive reference + selective copy integration ---

test("install recursively tracks references and copies only reachable files", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = path.join(tmpDir, "recursive-mp");
  fs.mkdirSync(path.join(marketplaceDir, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "skills", "review"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "rules", "common"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "templates"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "docs"), { recursive: true });

  fs.writeFileSync(
    path.join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "recursive-mp", plugins: [{ name: "recursive-mp", source: "./" }] }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(marketplaceDir, "skills", "review", "SKILL.md"),
    "Read `rules/common/review.md` first.",
    "utf8",
  );
  fs.writeFileSync(
    path.join(marketplaceDir, "rules", "common", "review.md"),
    "See `templates/checklist.md` for details.",
    "utf8",
  );
  fs.writeFileSync(path.join(marketplaceDir, "templates", "checklist.md"), "checklist", "utf8");
  fs.writeFileSync(path.join(marketplaceDir, "templates", "unused.md"), "unused template", "utf8");
  fs.writeFileSync(path.join(marketplaceDir, "docs", "readme.md"), "docs", "utf8");

  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    const base = path.join(projectRoot, ".opencode", "recursive-mp");

    // Recursively referenced files copied
    assert.equal(fs.existsSync(path.join(base, "rules", "common", "review.md")), true);
    assert.equal(fs.existsSync(path.join(base, "templates", "checklist.md")), true);

    // Unreferenced files NOT copied
    assert.equal(fs.existsSync(path.join(base, "templates", "unused.md")), false);
    assert.equal(fs.existsSync(path.join(base, "docs")), false);

    // Content paths rewritten in copied files
    const reviewContent = fs.readFileSync(path.join(base, "rules", "common", "review.md"), "utf8");
    assert.match(reviewContent, /\.opencode\/recursive-mp\/templates\/checklist\.md/);

    // Skill paths rewritten
    const skillContent = fs.readFileSync(
      path.join(projectRoot, ".opencode", "skills", "review", "SKILL.md"),
      "utf8",
    );
    assert.match(skillContent, /\.opencode\/recursive-mp\/rules\/common\/review\.md/);
  } finally {
    cleanup(tmpDir);
  }
});

// --- filterMdContent edge cases ---

test("filterMdContent filters multi-hash headings", () => {
  const input = [
    "normal line with rules/file.md reference",
    "# H1 heading with rules/a.md",
    "## H2 heading with rules/b.md",
    "### H3 heading with rules/c.md",
    "#### H4 heading with rules/d.md",
    "another normal line with rules/e.md",
  ].join("\n");
  const result = filterMdContent(input);
  assert.match(result, /rules\/file\.md/);
  assert.match(result, /rules\/e\.md/);
  assert.doesNotMatch(result, /rules\/a\.md/);
  assert.doesNotMatch(result, /rules\/b\.md/);
  assert.doesNotMatch(result, /rules\/c\.md/);
  assert.doesNotMatch(result, /rules\/d\.md/);
});

test("filterMdContent handles nested code fences", () => {
  const input = [
    "outside before",
    "````markdown",
    "inner content should be filtered",
    "```bash",
    "npx test tests/something.ts",
    "```",
    "still inside outer fence rules/leaked.md",
    "````",
    "outside after with rules/visible.md",
  ].join("\n");
  const result = filterMdContent(input);
  assert.match(result, /outside before/);
  assert.match(result, /rules\/visible\.md/);
  assert.doesNotMatch(result, /tests\/something/);
  assert.doesNotMatch(result, /rules\/leaked\.md/);
  assert.doesNotMatch(result, /inner content/);
});

test("filterMdContent filters tilde code fences", () => {
  const input = [
    "outside before rules/visible-before.md",
    "~~~bash",
    "cat rules/leaked.md",
    "~~~",
    "outside after rules/visible-after.md",
  ].join("\n");
  const result = filterMdContent(input);
  assert.match(result, /rules\/visible-before\.md/);
  assert.match(result, /rules\/visible-after\.md/);
  assert.doesNotMatch(result, /rules\/leaked\.md/);
});

test("filterMdContent filters GFM table rows without leading pipes", () => {
  const input = [
    "name | path",
    "--- | ---",
    "rule | rules/table-only.md",
    "",
    "normal text with rules/visible.md",
  ].join("\n");
  const result = filterMdContent(input);
  assert.match(result, /rules\/visible\.md/);
  assert.doesNotMatch(result, /rules\/table-only\.md/);
});

// --- copyReachableFiles edge case ---

test("install with zero reachable files records empty placedDirs", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = path.join(tmpDir, "empty-mp");
  fs.mkdirSync(path.join(marketplaceDir, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "skills", "hello"), { recursive: true });

  fs.writeFileSync(
    path.join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "empty-mp", plugins: [{ name: "empty-mp", source: "./" }] }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(marketplaceDir, "skills", "hello", "SKILL.md"),
    "A simple skill with no external file references.",
    "utf8",
  );

  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    // Skill installed
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "skills", "hello", "SKILL.md")),
      true,
    );

    // No .opencode/<pluginName>/ directory created
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "empty-mp")),
      false,
    );

    // Registry records empty placedDirs
    const registry = readRegistry(projectRoot);
    assert.deepEqual(registry.installations["empty-mp"].placedDirs, []);
  } finally {
    cleanup(tmpDir);
  }
});

// --- source "./" with no reachable content dirs integration ---

test("install source ./ marketplace with code-block-only refs copies nothing extra", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = path.join(tmpDir, "codeblock-mp");
  fs.mkdirSync(path.join(marketplaceDir, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "commands"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(marketplaceDir, "rules"), { recursive: true });

  fs.writeFileSync(
    path.join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "codeblock-mp", plugins: [{ name: "codeblock-mp", source: "./" }] }),
    "utf8",
  );
  // Command references scripts/ only inside a code block
  fs.writeFileSync(
    path.join(marketplaceDir, "commands", "setup.md"),
    [
      "Run the setup command:",
      "```bash",
      "node scripts/setup.js --init",
      "```",
      "Done.",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(marketplaceDir, "scripts", "setup.js"), "console.log('hi')", "utf8");
  fs.writeFileSync(path.join(marketplaceDir, "rules", "style.md"), "style guide", "utf8");

  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    // Command installed
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "commands", "setup.md")),
      true,
    );

    // No content dirs copied (refs were in code blocks)
    assert.equal(fs.existsSync(path.join(projectRoot, ".opencode", "codeblock-mp")), false);
    assert.equal(fs.existsSync(path.join(projectRoot, "scripts")), false);
    assert.equal(fs.existsSync(path.join(projectRoot, "rules")), false);

    // Registry
    const registry = readRegistry(projectRoot);
    assert.deepEqual(registry.installations["codeblock-mp"].placedDirs, []);
    assert.deepEqual(registry.installations["codeblock-mp"].commands, ["setup"]);
  } finally {
    cleanup(tmpDir);
  }
});
