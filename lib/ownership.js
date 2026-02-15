const fs = require("node:fs");
const path = require("node:path");

const { MANAGED_MARKER, LEGACY_MANAGED_MARKER } = require("./constants");

function readMarkerOwner(markerPath) {
  if (!fs.existsSync(markerPath)) {
    if (path.basename(markerPath) !== MANAGED_MARKER) {
      return null;
    }

    const legacyPath = path.join(path.dirname(markerPath), LEGACY_MANAGED_MARKER);
    if (!fs.existsSync(legacyPath)) {
      return null;
    }
    markerPath = legacyPath;
  }

  const content = fs.readFileSync(markerPath, "utf8").trim();
  if (!content || content.includes(" ")) return "__unknown__";
  return content;
}

function writeMarker(markerPath, marketplaceName) {
  fs.writeFileSync(markerPath, marketplaceName + "\n", "utf8");
  const legacyPath = path.join(path.dirname(markerPath), LEGACY_MANAGED_MARKER);
  if (legacyPath !== markerPath && fs.existsSync(legacyPath)) {
    fs.unlinkSync(legacyPath);
  }
}

module.exports = {
  readMarkerOwner,
  writeMarker,
};
