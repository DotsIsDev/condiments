import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const TEXT_EXTENSIONS = new Set([
  ".axaml", ".c", ".cc", ".cfg", ".conf", ".cpp", ".cs", ".csproj",
  ".css", ".csv", ".go", ".gradle", ".h", ".hpp", ".html", ".ini",
  ".java", ".js", ".json", ".json5", ".jsx", ".kt", ".kts", ".md",
  ".mjs", ".mm", ".plist", ".properties", ".py", ".rb", ".rs", ".scss",
  ".sh", ".sql", ".storyboard", ".swift", ".toml", ".ts", ".tsx",
  ".txt", ".vue", ".xml", ".yaml", ".yml",
]);

const TEXT_FILENAMES = new Set([
  "Dockerfile", "Gemfile", "Makefile", "Podfile", "Procfile",
]);

const ORIENTATION_FILENAMES = new Set([
  "AGENTS.md", "CLAUDE.md", "README", "README.md", "README.txt",
]);

const IGNORED_DIRECTORIES = new Set([
  ".git", ".next", ".nuxt", ".output", ".pytest_cache", ".turbo",
  ".venv", ".yarn", "bin", "build", "coverage", "dist", "node_modules",
  "obj", "out", "target", "vendor",
]);

const IGNORED_FILENAMES = new Set([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Podfile.lock",
]);

export const DEFAULT_TOKEN_CHARS = 4;
export const DEFAULT_WINDOW_LINES = 8;
export const DEFAULT_MAX_FILE_BYTES = 2_000_000;

export async function evaluateRepository(options) {
  const root = path.resolve(options.root);
  const query = String(options.query ?? "");
  const windowLines = positiveInteger(options.windowLines, DEFAULT_WINDOW_LINES);
  const maxFileBytes = positiveInteger(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
  const tokenChars = positiveNumber(options.tokenChars, DEFAULT_TOKEN_CHARS);

  if (!query) throw new Error("Evaluation query must not be empty.");
  const rootStats = await stat(root);
  if (!rootStats.isDirectory()) throw new Error(`Repository is not a directory: ${root}`);

  const relativePaths = await discoverTextFiles(root, maxFileBytes);
  const files = [];
  let skippedBinary = 0;

  for (const relativePath of relativePaths) {
    const absolutePath = path.join(root, relativePath);
    const buffer = await readFile(absolutePath);
    if (buffer.includes(0)) {
      skippedBinary += 1;
      continue;
    }
    const content = buffer.toString("utf8");
    const lines = content.split(/\r?\n/);
    const matchLines = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].includes(query)) matchLines.push(index);
    }
    files.push({ relativePath: slash(relativePath), content, lines, matchLines });
  }

  const matchedFiles = files.filter((file) => file.matchLines.length > 0);
  const orientationFiles = files.filter((file) => isOrientationFile(file.relativePath));
  const totalMatches = matchedFiles.reduce((sum, file) => sum + file.matchLines.length, 0);
  if (totalMatches === 0) throw new Error(`Query '${query}' has no matches in ${root}.`);

  const baselineBytes = files.reduce((sum, file) => sum + framedBytes(file.relativePath, file.content), 0);
  const someFiles = uniqueFiles([...matchedFiles, ...orientationFiles]);
  const someBytes = someFiles.reduce((sum, file) => sum + framedBytes(file.relativePath, file.content), 0);

  let fullBytes = 0;
  let regionCount = 0;
  for (const file of matchedFiles) {
    const ranges = mergeRanges(
      file.matchLines.map((line) => [
        Math.max(0, line - windowLines),
        Math.min(file.lines.length - 1, line + windowLines),
      ]),
    );
    regionCount += ranges.length;
    for (const [start, end] of ranges) {
      const label = `${file.relativePath}:${start + 1}-${end + 1}`;
      fullBytes += framedBytes(label, file.lines.slice(start, end + 1).join("\n"));
    }
  }

  const mode = (contextBytes, includedFiles, includedRegions) => ({
    contextBytes,
    estimatedTokens: Math.ceil(contextBytes / tokenChars),
    includedFiles,
    includedRegions,
    matchRecall: 1,
    reductionVsBaseline: baselineBytes === 0
      ? 0
      : round(1 - contextBytes / baselineBytes, 4),
  });

  return {
    name: options.name || path.basename(root),
    root,
    query,
    methodology: "offline-context-proxy-v1",
    tokenEstimate: `ceil(UTF-8 bytes / ${tokenChars})`,
    eligibleFiles: files.length,
    skippedBinary,
    queryMatches: totalMatches,
    matchedFiles: matchedFiles.map((file) => file.relativePath),
    modes: {
      baseline: mode(baselineBytes, files.length, files.length),
      some: mode(someBytes, someFiles.length, someFiles.length),
      full: mode(fullBytes, matchedFiles.length, regionCount),
    },
  };
}

async function discoverTextFiles(root, maxFileBytes) {
  const found = [];
  async function walk(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relativePath = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await walk(path.join(directory, entry.name), relativePath);
        }
        continue;
      }
      if (!entry.isFile() || !isTextCandidate(entry.name)) continue;
      const details = await stat(path.join(directory, entry.name));
      if (details.size <= maxFileBytes) found.push(relativePath);
    }
  }
  await walk(root);
  return found;
}

function isTextCandidate(filename) {
  if (IGNORED_FILENAMES.has(filename)) return false;
  return TEXT_FILENAMES.has(filename) || TEXT_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function isOrientationFile(relativePath) {
  const normalized = slash(relativePath);
  return !normalized.includes("/") && ORIENTATION_FILENAMES.has(path.basename(relativePath));
}

function uniqueFiles(files) {
  return [...new Map(files.map((file) => [file.relativePath, file])).values()];
}

function mergeRanges(ranges) {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range[0] > previous[1] + 1) {
      merged.push([...range]);
    } else {
      previous[1] = Math.max(previous[1], range[1]);
    }
  }
  return merged;
}

function framedBytes(label, content) {
  return Buffer.byteLength(`--- ${label} ---\n${content}\n`, "utf8");
}

function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("Expected a positive integer.");
  return parsed;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("Expected a positive number.");
  return parsed;
}

function round(value, places) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function slash(value) {
  return value.split(path.sep).join("/");
}

