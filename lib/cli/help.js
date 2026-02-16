const { HELP_LINES } = require("./constants");

function getHelpText() {
  return HELP_LINES.join("\n");
}

function printHelp(writer = console.log) {
  writer(getHelpText());
}

module.exports = {
  getHelpText,
  printHelp,
};
