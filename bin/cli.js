#!/usr/bin/env node

const { main } = require("../lib/cli/main");

if (require.main === module) {
  main();
}

module.exports = require("../lib/public-api");
