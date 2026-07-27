// Pure helpers — no `vscode` import, so they can be unit-tested in plain Node.

const path = require("path");

/**
 * Resolve a link href (relative or absolute path, possibly with #fragment/?query)
 * against a base directory. Returns null for pure anchors/queries.
 * `filePath` is the resolved fsPath, `fragment` the #anchor (without "#"),
 * `filePart` the decoded path portion of the href (used in error messages).
 */
function resolveTarget(baseDir, href) {
  if (typeof href !== "string") return null;
  const splitIdx = href.search(/[#?]/);
  let filePart = splitIdx === -1 ? href : href.slice(0, splitIdx);
  const suffix = splitIdx === -1 ? "" : href.slice(splitIdx);
  if (!filePart) return null; // pure "#anchor" / "?query" — nothing to open
  try {
    filePart = decodeURIComponent(filePart);
  } catch (_) {
    /* leave as-is if it isn't valid percent-encoding */
  }
  return {
    filePath: path.resolve(baseDir, filePart),
    fragment: suffix.startsWith("#") ? suffix.slice(1) : "",
    filePart,
  };
}

// Relative date, e.g. "3 days ago". `now` is injectable so tests stay deterministic.
function relTime(iso, now = Date.now()) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const s = Math.max(0, Math.floor((now - then) / 1000));
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [name, secs] of units) {
    const v = Math.floor(s / secs);
    if (v >= 1) return `${v} ${name}${v > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

// Parse `git log --format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e` output.
// \x1f = field sep, \x1e = record sep — safe against subjects with newlines.
function parseGitLog(stdout) {
  if (typeof stdout !== "string") return [];
  return stdout
    .split("\x1e")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((rec) => {
      const [hash, author, email, date, subject] = rec.split("\x1f");
      return { hash, shortHash: (hash || "").slice(0, 7), author, email, date, subject };
    })
    .filter((c) => c.hash);
}

module.exports = { resolveTarget, relTime, parseGitLog };
