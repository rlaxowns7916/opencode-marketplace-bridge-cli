const { ARG_INDEX, COMMANDS, FLAGS, USAGE } = require("./constants");
const { CliInputError } = require("./errors");

function isHelpCommand(command) {
  return !command || command === FLAGS.HELP_SHORT || command === FLAGS.HELP_LONG;
}

function splitInstallArgs(args) {
  return {
    force: args.includes(FLAGS.FORCE),
    positional: args.filter((arg) => !arg.startsWith("--")),
  };
}

function parseInstallCommand(argv) {
  const { force, positional } = splitInstallArgs(argv.slice(ARG_INDEX.FIRST_ARG));
  const source = positional[ARG_INDEX.INSTALL_SOURCE];

  if (!source) {
    throw new CliInputError("Error: source is required", {
      usage: USAGE.INSTALL,
    });
  }

  return {
    type: COMMANDS.INSTALL,
    source,
    pluginFilter: positional[ARG_INDEX.INSTALL_PLUGIN] || null,
    force,
  };
}

function parseUninstallCommand(argv) {
  const name = argv[ARG_INDEX.UNINSTALL_NAME];

  if (!name) {
    throw new CliInputError("Error: name is required", {
      usage: USAGE.UNINSTALL,
    });
  }

  return {
    type: COMMANDS.UNINSTALL,
    name,
  };
}

function parseUpdateCommand(argv) {
  const args = argv.slice(ARG_INDEX.FIRST_ARG);
  const positional = args.filter((arg) => !arg.startsWith("--"));
  if (positional.length > 0) {
    throw new CliInputError("Error: update does not accept positional arguments", {
      usage: USAGE.UPDATE,
    });
  }

  return {
    type: COMMANDS.UPDATE,
    force: args.includes(FLAGS.FORCE),
  };
}

function parseCommand(argv) {
  const command = argv[ARG_INDEX.COMMAND];

  if (isHelpCommand(command)) {
    return { type: COMMANDS.HELP };
  }

  if (command === COMMANDS.INSTALL) {
    return parseInstallCommand(argv);
  }

  if (command === COMMANDS.UNINSTALL) {
    return parseUninstallCommand(argv);
  }

  if (command === COMMANDS.LIST) {
    return { type: COMMANDS.LIST };
  }

  if (command === COMMANDS.UPDATE) {
    return parseUpdateCommand(argv);
  }

  throw new CliInputError(`Unknown command: ${command}`, { showHelp: true });
}

module.exports = {
  parseCommand,
};
