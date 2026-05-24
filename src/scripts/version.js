// src/scripts/version.js
// NOTE: This file is served dynamically by server.js — the version is injected
// from package.json at request time, so edits to the hardcoded string below are
// overridden in production. Edit package.json "version" field instead.
window.NEARSEC_VERSION = window.NEARSEC_VERSION || "1.0.4";
console.log("[Nearsec] Version loaded:", window.NEARSEC_VERSION);
