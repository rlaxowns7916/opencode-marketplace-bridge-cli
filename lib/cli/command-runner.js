const { COMMANDS } = require("./constants");
const { install, uninstall, list, update } = require("../install-service");

const COMMAND_HANDLERS = Object.freeze({
  [COMMANDS.INSTALL]: async (command, projectRoot) => install(
    command.source,
    command.pluginFilter,
    projectRoot,
    { force: command.force },
  ),
  [COMMANDS.UNINSTALL]: async (command, projectRoot) => uninstall(command.name, projectRoot),
  [COMMANDS.LIST]: async (_command, projectRoot) => list(projectRoot),
  [COMMANDS.UPDATE]: async (command, projectRoot) => update(projectRoot, { force: command.force }),
});

async function runCommand(command, projectRoot) {
  const handler = COMMAND_HANDLERS[command.type];
  if (!handler) {
    throw new Error(`Unsupported command type: ${command.type}`);
  }
  await handler(command, projectRoot);
}

module.exports = {
  runCommand,
};
