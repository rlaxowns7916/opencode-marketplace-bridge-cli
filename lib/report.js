function formatNameList(items) {
  if (!items || items.length === 0) return "(none)";
  return items.join(", ");
}

function formatInstallReport(summary) {
  const {
    marketplaceName,
    source,
    pluginFilter,
    plugins,
    placedDirs,
    skills,
    commands,
    agents,
  } = summary;

  return [
    "+=================================================================+",
    "|                    OMBC INSTALL ASCII REPORT                    |",
    "+=================================================================+",
    ` Marketplace : ${marketplaceName}`,
    ` Source      : ${source}`,
    ` Plugin      : ${pluginFilter || "(all)"}`,
    ` Plugins     : ${formatNameList(plugins)}`,
    ` Placed  (${placedDirs.length}) : ${formatNameList(placedDirs)}`,
    " -----------------------------------------------------------------",
    ` Skills   (${skills.length}) : ${formatNameList(skills)}`,
    ` Commands (${commands.length}) : ${formatNameList(commands)}`,
    ` Agents   (${agents.length}) : ${formatNameList(agents)}`,
    "+=================================================================+",
  ].join("\n");
}

function formatMarketplaceListReport(entries) {
  if (entries.length === 0) {
    return [
      "+===============================================================+",
      "|                 OMBC MARKETPLACE LIST REPORT                |",
      "+===============================================================+",
      " No marketplaces installed.",
      "+===============================================================+",
    ].join("\n");
  }

  const lines = [
    "+===============================================================+",
    "|                 OMBC MARKETPLACE LIST REPORT                |",
    "+===============================================================+",
  ];

  for (const [name, entry] of entries) {
    lines.push(` Marketplace : ${name}`);
    lines.push(` Plugins     : ${formatNameList(entry.plugins || [])}`);
    lines.push(` Skills      : ${formatNameList(entry.skills || [])}`);
    lines.push(` Commands    : ${formatNameList(entry.commands || [])}`);
    lines.push(` Agents      : ${formatNameList(entry.agents || [])}`);
    if (entry.lastUpdated) {
      lines.push(` LastUpdate  : ${entry.lastUpdated}`);
    }
    lines.push(" ---------------------------------------------------------------");
  }

  lines.push("+===============================================================+");
  return lines.join("\n");
}

module.exports = {
  formatInstallReport,
  formatMarketplaceListReport,
};
