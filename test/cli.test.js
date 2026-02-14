const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const cliPath = path.resolve(__dirname, "..", "bin", "cli.js");
const fixtureRoot = path.resolve(__dirname, "fixtures", "ombc-source");
const {
  rewriteCachedPaths,
  normalizeToolsField,
  normalizeModelField,
  filterMdContent,
  findReferencedDirs,
  transformContent,
  readMarkerOwner,
  resolveSource,
  parseMarketplace,
  readRegistry,
  install,
  uninstall,
  list,
  CACHE_DIR,
} = require(cliPath);

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ombc-cli-test-"));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
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

// --- rewriteCachedPaths ---

test("rewriteCachedPaths rewrites rules path with cache prefix", () => {
  const source = "Read `rules/common/review-baseline.md` first.";
  const rewritten = rewriteCachedPaths(source, ".opencode/plugins/cache/test/", ["rules"]);
  assert.equal(
    rewritten,
    "Read `.opencode/plugins/cache/test/rules/common/review-baseline.md` first.",
  );
});

test("rewriteCachedPaths rewrites multiple references", () => {
  const source = [
    "1. `rules/common/review-baseline.md`",
    "2. `rules/typescript/review.md`",
  ].join("\n");
  const rewritten = rewriteCachedPaths(source, ".opencode/plugins/cache/tp/", ["rules"]);
  assert.match(rewritten, /\.opencode\/plugins\/cache\/tp\/rules\/common\/review-baseline\.md/);
  assert.match(rewritten, /\.opencode\/plugins\/cache\/tp\/rules\/typescript\/review\.md/);
});

test("rewriteCachedPaths uses dynamic prefix", () => {
  const source = "rules/common/test.md";
  assert.equal(
    rewriteCachedPaths(source, ".opencode/plugins/cache/alpha/", ["rules"]),
    ".opencode/plugins/cache/alpha/rules/common/test.md",
  );
  assert.equal(
    rewriteCachedPaths(source, ".opencode/plugins/cache/beta/", ["rules"]),
    ".opencode/plugins/cache/beta/rules/common/test.md",
  );
});

test("rewriteCachedPaths skips URLs", () => {
  const source = "See https://example.com/rules/foo for details.";
  const rewritten = rewriteCachedPaths(source, ".opencode/plugins/cache/x/", ["rules"]);
  assert.equal(rewritten, source);
});

test("rewriteCachedPaths skips already rewritten paths", () => {
  const source = ".opencode/plugins/cache/ombc-fixture/rules/common/test.md";
  const rewritten = rewriteCachedPaths(source, ".opencode/plugins/cache/ombc-fixture/", ["rules"]);
  assert.equal(rewritten, source);
});

test("rewriteCachedPaths skips old-style rewritten paths", () => {
  const source = ".opencode/ombc-fixture/rules/common/test.md";
  const rewritten = rewriteCachedPaths(source, ".opencode/plugins/cache/ombc-fixture/", ["rules"]);
  assert.equal(rewritten, source);
});

test("rewriteCachedPaths boundary: does not match mid-word", () => {
  const source = "therules/common/test.md should not match";
  const rewritten = rewriteCachedPaths(source, ".opencode/plugins/cache/x/", ["rules"]);
  assert.equal(rewritten, source);
});

test("rewriteCachedPaths boundary: matches after backtick, paren, quote", () => {
  const prefix = ".opencode/plugins/cache/p/";
  const cases = [
    ["`rules/common/test.md`", `\`${prefix}rules/common/test.md\``],
    ['("rules/a.md")', `("${prefix}rules/a.md")`],
    ["'rules/a.md'", `'${prefix}rules/a.md'`],
  ];
  for (const [input, expected] of cases) {
    assert.equal(rewriteCachedPaths(input, prefix, ["rules"]), expected, `input: ${input}`);
  }
});

test("rewriteCachedPaths rewrites multiple directory types", () => {
  const source = "Read `rules/common/review.md` and `templates/pr.md` for context.";
  const rewritten = rewriteCachedPaths(source, ".opencode/plugins/cache/mp/", ["rules", "templates"]);
  assert.match(rewritten, /\.opencode\/plugins\/cache\/mp\/rules\/common\/review\.md/);
  assert.match(rewritten, /\.opencode\/plugins\/cache\/mp\/templates\/pr\.md/);
});

test("rewriteCachedPaths returns content unchanged when cachedDirs is empty", () => {
  const source = "rules/common/test.md";
  assert.equal(rewriteCachedPaths(source, ".opencode/plugins/cache/x/", []), source);
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

// --- transformContent combines rewrite + normalize ---

test("transformContent applies path rewrite, tools normalization, and model normalization", () => {
  const input = '---\nmodel: sonnet\ntools: ["Read", "Grep"]\n---\nRead rules/common/test.md for review.';
  const result = transformContent(input, ".opencode/plugins/cache/test/", ["rules"]);
  assert.match(result, /model: anthropic\/claude-sonnet-4-5/);
  assert.match(result, /tools:\n {2}read: true\n {2}grep: true/);
  assert.match(result, /\.opencode\/plugins\/cache\/test\/rules\/common\/test\.md/);
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

// --- install: cache-based ---

test("install caches marketplace and creates skills with rewritten paths", async () => {
  const tmpDir = makeTempDir();
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(fixtureRoot, null, projectRoot);

    // Cache created
    const cacheDir = path.join(projectRoot, CACHE_DIR, "ombc-fixture");
    assert.equal(fs.existsSync(cacheDir), true);

    // Rules exist in cache (NOT copied separately)
    const ruleFile = path.join(cacheDir, "rules", "common", "review-baseline.md");
    assert.equal(fs.existsSync(ruleFile), true);

    // Skills created with rewritten paths pointing to cache
    const codeReviewSkill = path.join(
      projectRoot, ".opencode", "skills", "code-review", "SKILL.md",
    );
    const prCreateSkill = path.join(
      projectRoot, ".opencode", "skills", "pr-create", "SKILL.md",
    );
    assert.equal(fs.existsSync(codeReviewSkill), true);
    assert.equal(fs.existsSync(prCreateSkill), true);

    // Path rewriting points to cache location
    const skillContent = fs.readFileSync(codeReviewSkill, "utf8");
    assert.match(skillContent, /\.opencode\/plugins\/cache\/ombc-fixture\/rules\/common\/review-baseline\.md/);

    // Markers created
    const marker = path.join(
      projectRoot, ".opencode", "skills", "code-review", ".ombc-managed",
    );
    assert.equal(fs.existsSync(marker), true);

    // No old-style rules directory
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "ombc-fixture", "rules")),
      false,
    );

    // Registry created with cacheDir field
    const registry = readRegistry(projectRoot);
    assert.equal("ombc-fixture" in registry.installations, true);
    const entry = registry.installations["ombc-fixture"];
    assert.deepEqual(entry.plugins, ["ombc-fixture"]);
    assert.deepEqual(entry.skills, ["code-review", "pr-create"]);
    assert.deepEqual(entry.commands, []);
    assert.deepEqual(entry.agents, []);
    assert.equal(entry.cacheDir, ".opencode/plugins/cache/ombc-fixture");
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

    // Content rewritten with cache path
    const content = fs.readFileSync(skillPath, "utf8");
    assert.match(content, /\.opencode\/plugins\/cache\/mock-marketplace\/rules\/common\/test-rule\.md/);
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

// --- install commands and agents ---

test("install copies commands with path rewriting to cache", async () => {
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

    // Path rewriting points to cache
    const content = fs.readFileSync(reviewCmd, "utf8");
    assert.match(content, /\.opencode\/plugins\/cache\/mock-marketplace\/rules\/common\/test-rule\.md/);

    // Registry tracks commands
    const registry = readRegistry(projectRoot);
    const entry = registry.installations["mock-marketplace"];
    assert.deepEqual(entry.commands.sort(), ["deploy", "review"]);
  } finally {
    cleanup(tmpDir);
  }
});

test("install copies agents with path rewriting to cache", async () => {
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

    // Path rewriting points to cache
    const content = fs.readFileSync(agentFile, "utf8");
    assert.match(content, /\.opencode\/plugins\/cache\/mock-marketplace\/rules\/common\/test-rule\.md/);

    // Registry tracks agents
    const registry = readRegistry(projectRoot);
    assert.deepEqual(registry.installations["mock-marketplace"].agents, ["reviewer"]);
  } finally {
    cleanup(tmpDir);
  }
});

test("install caches only referenced directories (smart cache)", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = path.join(tmpDir, "smart-cache-mp");
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

    const cacheDir = path.join(projectRoot, CACHE_DIR, "smart-mp");

    // Referenced dirs cached
    assert.equal(fs.existsSync(path.join(cacheDir, "rules", "common", "test.md")), true);
    assert.equal(fs.existsSync(path.join(cacheDir, "templates", "pr.md")), true);

    // Unreferenced dirs/files NOT cached
    assert.equal(fs.existsSync(path.join(cacheDir, "docs")), false);
    assert.equal(fs.existsSync(path.join(cacheDir, "package.json")), false);
    assert.equal(fs.existsSync(path.join(cacheDir, "LICENSE")), false);

    // Skills still installed with rewritten paths
    const skillContent = fs.readFileSync(
      path.join(projectRoot, ".opencode", "skills", "review", "SKILL.md"),
      "utf8",
    );
    assert.match(skillContent, /\.opencode\/plugins\/cache\/smart-mp\/rules\/common\/test\.md/);
    assert.match(skillContent, /\.opencode\/plugins\/cache\/smart-mp\/templates\/pr\.md/);
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

    // Path rewriting also applied
    assert.match(content, /\.opencode\/plugins\/cache\/mock-marketplace\/rules\/common\/test-rule\.md/);
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

    // Path rewriting applied
    assert.match(content, /\.opencode\/plugins\/cache\/tools-test\/rules\/common\/test\.md/);
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

    // Cache exists
    assert.equal(
      fs.existsSync(path.join(projectRoot, CACHE_DIR, "mock-marketplace")),
      true,
    );

    // Registry tracks all
    const registry = readRegistry(projectRoot);
    const entry = registry.installations["mock-marketplace"];
    assert.deepEqual(entry.skills, ["test-skill"]);
    assert.deepEqual(entry.commands, ["hello"]);
    assert.deepEqual(entry.agents, ["oracle"]);
    assert.equal(entry.cacheDir, ".opencode/plugins/cache/mock-marketplace");
  } finally {
    cleanup(tmpDir);
  }
});

// --- Idempotency ---

test("install is idempotent — reinstall replaces cache and files", async () => {
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

    // Cache still exists
    assert.equal(
      fs.existsSync(path.join(projectRoot, CACHE_DIR, "ombc-fixture")),
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

test("uninstall removes skills, commands, agents, cache, and registry entry", async () => {
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

    // Cache removed
    assert.equal(
      fs.existsSync(path.join(projectRoot, CACHE_DIR, "mock-marketplace")),
      false,
    );

    // Empty parent directories cleaned up
    assert.equal(
      fs.existsSync(path.join(projectRoot, CACHE_DIR)),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "plugins")),
      false,
    );

    // Registry entry removed
    const registry = readRegistry(projectRoot);
    assert.equal("mock-marketplace" in registry.installations, false);
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
    assert.match(output[0], /skills: test-skill/);
    assert.match(output[0], /commands: hello/);
    assert.match(output[0], /agents: oracle/);
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
    assert.match(run.stdout, /Installed ombc-fixture/);

    // Skills exist
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "skills", "code-review", "SKILL.md")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "skills", "pr-create", "SKILL.md")),
      true,
    );

    // Cache exists with rules
    assert.equal(
      fs.existsSync(
        path.join(projectRoot, ".opencode", "plugins", "cache", "ombc-fixture", "rules", "common", "review-baseline.md"),
      ),
      true,
    );

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
    assert.match(run.stdout, /skills: code-review, pr-create/);
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

    // Cache removed
    assert.equal(
      fs.existsSync(path.join(projectRoot, ".opencode", "plugins", "cache", "ombc-fixture")),
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

test("install from mock marketplace caches and rewrites correctly", async () => {
  const tmpDir = makeTempDir();
  const marketplaceDir = createMockMarketplace(tmpDir);
  const projectRoot = path.join(tmpDir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });

  try {
    await install(marketplaceDir, null, projectRoot);

    // Skill installed with cache-based rewritten paths
    const skillPath = path.join(
      projectRoot, ".opencode", "skills", "test-skill", "SKILL.md",
    );
    const content = fs.readFileSync(skillPath, "utf8");
    assert.match(content, /\.opencode\/plugins\/cache\/mock-marketplace\/rules\//);
    assert.doesNotMatch(content, /(?<!\.opencode\/plugins\/cache\/mock-marketplace\/)rules\//);

    // Rules in cache directory
    const ruleFile = path.join(
      projectRoot, CACHE_DIR, "mock-marketplace", "rules", "common", "test-rule.md",
    );
    assert.equal(fs.existsSync(ruleFile), true);

    // Registry uses marketplace name as key with cacheDir
    const registry = readRegistry(projectRoot);
    assert.equal("mock-marketplace" in registry.installations, true);
    assert.deepEqual(registry.installations["mock-marketplace"].plugins, ["mock-plugin"]);
    assert.equal(
      registry.installations["mock-marketplace"].cacheDir,
      ".opencode/plugins/cache/mock-marketplace",
    );
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
    assert.match(firstContent, /mock-marketplace/);

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
    assert.match(content, /second-marketplace/);

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
    assert.match(run.stdout, /Installed ombc-fixture/);
  } finally {
    cleanup(tmpDir);
  }
});

test("CLI help shows --force option", () => {
  const run = spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /--force/);
});
