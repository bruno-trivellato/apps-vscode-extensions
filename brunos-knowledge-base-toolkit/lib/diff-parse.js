// Pure helpers — no `vscode` import, so they can be unit-tested in plain Node.

// Header lines that carry no content, above the first hunk of a file.
const META_RE =
  /^(diff --git |diff --cc |index |old mode |new mode |new file mode |deleted file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |Binary files |GIT binary patch|Index: |={5,}$|\*{3} |--- \/dev\/null$|Only in )/;

const HUNK_RE = /^@@+ .* @@/;

/**
 * Pull the old/new line counts out of a unified hunk header, so we know where
 * the hunk ends. Matters because a removed line whose content starts with "--"
 * is indistinguishable from a "--- a/file" header on text alone — the counts
 * tell us whether we are inside a hunk or between files.
 *
 * Handles combined diffs (@@@ -1,2 -1,2 +1,2 @@@) by summing every old range.
 * A range without a comma means one line, per the unified diff format.
 */
function parseHunkHeader(line) {
  const m = /^(@@+) (.*?) \1/.exec(line);
  if (!m) return null;
  let oldLines = 0;
  let newLines = 0;
  let sawNew = false;
  for (const range of m[2].split(" ")) {
    const r = /^([-+])\d+(?:,(\d+))?$/.exec(range);
    if (!r) return null;
    const count = r[2] === undefined ? 1 : Number(r[2]);
    if (r[1] === "+") {
      newLines += count;
      sawNew = true;
    } else {
      oldLines += count;
    }
  }
  if (!sawNew) return null;
  return { oldLines, newLines };
}

/**
 * Classify every line of a patch for rendering. Returns `{ kind, text }` in the
 * original order — nothing is dropped, reordered or rewritten, so the view is
 * always the file itself, just coloured.
 *
 * kinds: "add" | "del" | "ctx" | "hunk" | "file" | "meta"
 *   file — the "--- a/x" / "+++ b/x" pair, which starts with -/+ but is a header
 *   meta — "diff --git", "index", mode/rename lines, "\ No newline at end of file"
 */
function parseDiff(text) {
  if (typeof text !== "string") return [];
  const lines = text.split("\n");
  // Trailing newline means one empty element at the end; it is not a real line.
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  const out = [];
  let oldLeft = 0;
  let newLeft = 0;
  const inHunk = () => oldLeft > 0 || newLeft > 0;

  for (const line of lines) {
    if (!inHunk()) {
      const hunk = HUNK_RE.test(line) ? parseHunkHeader(line) : null;
      if (hunk) {
        oldLeft = hunk.oldLines;
        newLeft = hunk.newLines;
        out.push({ kind: "hunk", text: line });
        continue;
      }
      if (/^(--- |\+\+\+ )/.test(line)) {
        out.push({ kind: "file", text: line });
        continue;
      }
      out.push({ kind: META_RE.test(line) ? "meta" : "ctx", text: line });
      continue;
    }

    // Inside a hunk every line is content, and the first character says which
    // side it belongs to. "\ No newline at end of file" belongs to neither and
    // does not consume a line from either count.
    if (line.startsWith("\\")) {
      out.push({ kind: "meta", text: line });
    } else if (line.startsWith("+")) {
      newLeft--;
      out.push({ kind: "add", text: line });
    } else if (line.startsWith("-")) {
      oldLeft--;
      out.push({ kind: "del", text: line });
    } else {
      // A context line counts against both sides. An empty line inside a hunk
      // is a context line that lost its leading space, which plenty of tools
      // emit, so treat it as context rather than bailing out of the hunk.
      oldLeft--;
      newLeft--;
      out.push({ kind: "ctx", text: line });
    }
    if (oldLeft < 0) oldLeft = 0;
    if (newLeft < 0) newLeft = 0;
  }

  return out;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Count added/removed lines, for the little summary in the header.
 */
function countChanges(rows) {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.kind === "add") added++;
    else if (r.kind === "del") removed++;
  }
  return { added, removed };
}

module.exports = { parseDiff, parseHunkHeader, escapeHtml, countChanges };
