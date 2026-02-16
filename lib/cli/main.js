const {
  COMMANDS,
  EXIT_CODES,
  PROCESS_ARG_OFFSET,
} = require("./constants");
const { CliInputError } = require("./errors");
const { parseCommand } = require("./argv");
const { printHelp } = require("./help");
const { runCommand } = require("./command-runner");

const runtimeDefault = Object.freeze({
  cwd: () => process.cwd(),
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
  exit: (code) => process.exit(code),
});

function printCliInputError(error, runtime) {
  runtime.stderr(error.message);
  if (error.usage) {
    runtime.stderr(error.usage);
  }
  if (error.showHelp) {
    printHelp(runtime.stdout);
  }
}

async function main(argv = process.argv.slice(PROCESS_ARG_OFFSET), runtime = runtimeDefault) {
  try {
    const parsed = parseCommand(argv);
    if (parsed.type === COMMANDS.HELP) {
      printHelp(runtime.stdout);
      return;
    }

    await runCommand(parsed, runtime.cwd());
  } catch (error) {
    if (error instanceof CliInputError) {
      printCliInputError(error, runtime);
    } else {
      runtime.stderr(String(error.message || error));
    }
    runtime.exit(EXIT_CODES.FAILURE);
  }
}

module.exports = {
  main,
};
