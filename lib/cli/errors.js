class CliInputError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "CliInputError";
    this.usage = options.usage || null;
    this.showHelp = Boolean(options.showHelp);
  }
}

module.exports = {
  CliInputError,
};
