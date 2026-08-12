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

// ---- edit-mode write-back ---------------------------------------------------
//
// Vditor's getValue() is Lute reprinting the parse tree, not the file. Whatever
// the tree does not record is lost: trailing double-space hard breaks, table
// column padding, the blank line before a table. Replacing the file with that
// output rewrites all 40 untouched lines to save an edit on one.
//
// So treat Lute's view of the file at load time as a common ancestor and do a
// three-way merge: `baseline` is Lute(origin) when the editor opened, `origin`
// is the bytes on disk, `next` is Lute(edited DOM). Differences between
// baseline and origin are Lute's normalization; differences between baseline
// and next are the user's real edits. Merging over the ancestor cancels the
// normalization out, so untouched lines keep their original bytes.
//
// Where both sides touched the same lines (editing a row inside a table) the
// user's edit wins and that region does get reformatted. That is inherent to
// editing through a parse tree.

const LCS_CELL_BUDGET = 4000000; // ~4M cells, past which we stop being clever

// Diff two line arrays. Returns ops replacing a[start..end) with `lines`,
// sorted by start and non-overlapping.
function diffOps(a, b) {
  let p = 0;
  const maxP = Math.min(a.length, b.length);
  while (p < maxP && a[p] === b[p]) p++;
  let ea = a.length;
  let eb = b.length;
  while (ea > p && eb > p && a[ea - 1] === b[eb - 1]) { ea--; eb--; }

  const am = a.slice(p, ea);
  const bm = b.slice(p, eb);
  if (!am.length && !bm.length) return [];
  // Pathological sizes: fall back to one coarse op rather than allocate a
  // gigantic table. Correct, just less precise.
  if (am.length * bm.length > LCS_CELL_BUDGET) return [{ start: p, end: ea, lines: bm }];

  const n = am.length;
  const m = bm.length;
  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = am[i] === bm[j]
        ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }

  const ops = [];
  let pending = null;
  const close = () => { if (pending) { ops.push(pending); pending = null; } };
  const open = (i) => pending || (pending = { start: p + i, end: p + i, lines: [] });

  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && am[i] === bm[j]) { close(); i++; j++; continue; }
    const cur = open(i);
    if (j < m && (i >= n || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) {
      cur.lines.push(bm[j++]);
    } else {
      i++;
      cur.end = p + i;
    }
  }
  close();
  return ops;
}

// Three-way merge over a common ancestor. `mine` wins any overlap.
function merge3(ancestor, theirs, mine) {
  const anc = ancestor.split("\n");
  const theirOps = diffOps(anc, theirs.split("\n"));
  const myOps = diffOps(anc, mine.split("\n"));

  // Keep every edit of mine, plus each of theirs that does not collide.
  // A pure insertion is zero-width, so it only truly collides when it lands
  // strictly inside a replaced range. Sitting on a boundary is fine: both ops
  // apply, insertion first (see the sort below).
  const inside = (z, y) => y.start < z.start && z.start < y.end;
  const overlaps = (x, y) => {
    if (x.start === x.end) return inside(x, y);
    if (y.start === y.end) return inside(y, x);
    return x.start < y.end && y.start < x.end;
  };
  const ops = myOps.concat(theirOps.filter((t) => !myOps.some((o) => overlaps(t, o))));
  ops.sort((x, y) => x.start - y.start || x.end - y.end);

  const out = [];
  let at = 0;
  for (const op of ops) {
    if (op.start < at) continue; // defensive: drop anything still overlapping
    for (let k = at; k < op.start; k++) out.push(anc[k]);
    out.push(...op.lines);
    at = op.end;
  }
  for (let k = at; k < anc.length; k++) out.push(anc[k]);
  return out.join("\n");
}

module.exports = { resolveTarget, relTime, parseGitLog, diffOps, merge3 };
