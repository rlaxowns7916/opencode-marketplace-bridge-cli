const { COMMANDS } = require("./constants");
const { install, uninstall, list } = require("../install-service");

async function runCommand(command, projectRoot) {
  if (command.type === COMMANDS.INSTALL) {
    await install(command.source, command.pluginFilter, projectRoot, {
      force: command.force,
    });
    return;
  }

  if (command.type === COMMANDS.UNINSTALL) {
    uninstall(command.name, projectRoot);
    return;
  }

  if (command.type === COMMANDS.LIST) {
    list(projectRoot);
  }
}

module.exports = {
  runCommand,
};
