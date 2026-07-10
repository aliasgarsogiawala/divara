#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"]);
const minutesPerImage = 7.5;

const defaultPrompt =
  "Create a premium jewelry product photoshoot image from the uploaded ring reference. Preserve the exact ring design, band shape, gemstone setting, engravings, metal finish, scale, and proportions. Show the ring naturally worn on a woman's hand in a clean luxury editorial setting with soft realistic lighting, refined skin texture, and no distortion or hallucinated changes to the jewelry.";

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.input) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const inputDir = path.resolve(args.input);
const outputDir = path.resolve(args.output ?? "higgsfield-results");
const prompt = args.prompt ?? defaultPrompt;
const mode = args.mode ?? "lifestyle_scene";
const aspectRatio = args.aspectRatio ?? "3:4";
const count = clamp(Number(args.count ?? 1), 1, 10);
const timeout = args.timeout ?? "10m";
const interval = args.interval ?? "3s";

if (!existsSync(inputDir)) {
  console.error(`Input folder does not exist: ${inputDir}`);
  process.exit(1);
}

await mkdir(outputDir, { recursive: true });

const files = (await readdir(inputDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(inputDir, entry.name))
  .filter((file) => imageExtensions.has(path.extname(file).toLowerCase()))
  .sort((a, b) => a.localeCompare(b));

if (files.length === 0) {
  console.error(`No images found in ${inputDir}`);
  process.exit(1);
}

console.log(`Found ${files.length} image${files.length === 1 ? "" : "s"}.`);
console.log(`Estimated time: ${formatDuration(files.length * minutesPerImage)}.`);
console.log(`Output folder: ${outputDir}`);
console.log("");

const startedAt = new Date().toISOString();
const results = [];

for (const [index, file] of files.entries()) {
  const label = `${index + 1}/${files.length}`;
  const name = path.basename(file);

  console.log(`[${label}] Processing ${name}`);

  const result = await runHiggsfield(file, {
    prompt,
    mode,
    aspectRatio,
    count,
    timeout,
    interval,
  });

  results.push({
    sourceFile: file,
    ...result,
  });

  await writeReports(outputDir, startedAt, results);

  if (result.status === "completed") {
    console.log(`[${label}] Done: ${result.mediaUrls.join(", ")}`);
  } else {
    console.log(`[${label}] Failed: ${result.error}`);
  }

  console.log("");
}

console.log("Batch complete.");
console.log(`Report: ${path.join(outputDir, "results.json")}`);
console.log(`CSV: ${path.join(outputDir, "results.csv")}`);

async function runHiggsfield(file, options) {
  const commandArgs = [
    "product-photoshoot",
    "create",
    "--mode",
    options.mode,
    "--prompt",
    options.prompt,
    "--image",
    file,
    "--count",
    String(options.count),
    "--aspect_ratio",
    options.aspectRatio,
    "--timeout",
    options.timeout,
    "--interval",
    options.interval,
    "--brand_context",
    "Premium fine jewelry, clean luxury editorial styling",
    "--product_context",
    "Fine jewelry ring worn naturally on a hand",
    "--json",
    "--no-color",
  ];

  try {
    const { stdout } = await execFileAsync(resolveHiggsfieldBinary(), commandArgs, {
      env: {
        ...process.env,
        PATH: [
          process.env.PATH,
          `${homedir()}/.npm-global/bin`,
          "/usr/local/bin",
          "/opt/homebrew/bin",
        ]
          .filter(Boolean)
          .join(":"),
      },
      maxBuffer: 1024 * 1024 * 8,
      timeout: 1000 * 60 * 12,
    });

    const raw = parseCliJson(stdout);
    const mediaUrls = extractMediaUrls(raw);

    return {
      status: mediaUrls.length > 0 ? "completed" : "failed",
      mediaUrls,
      imageUrl: mediaUrls[0] ?? "",
      requestId: extractRequestId(raw) ?? "",
      error: mediaUrls.length > 0 ? "" : "Higgsfield finished without returning a media URL.",
      raw,
    };
  } catch (error) {
    return {
      status: "failed",
      mediaUrls: [],
      imageUrl: "",
      requestId: "",
      error: formatCliError(error),
      raw: null,
    };
  }
}

async function writeReports(outputDir, startedAt, results) {
  const finishedAt = new Date().toISOString();
  const jsonPath = path.join(outputDir, "results.json");
  const csvPath = path.join(outputDir, "results.csv");

  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        startedAt,
        updatedAt: finishedAt,
        total: results.length,
        completed: results.filter((result) => result.status === "completed").length,
        failed: results.filter((result) => result.status === "failed").length,
        results,
      },
      null,
      2,
    ),
  );

  const csvRows = [
    ["source_file", "status", "image_url", "all_media_urls", "request_id", "error"],
    ...results.map((result) => [
      result.sourceFile,
      result.status,
      result.imageUrl,
      result.mediaUrls.join(" | "),
      result.requestId,
      result.error,
    ]),
  ];

  await writeFile(csvPath, csvRows.map((row) => row.map(csvEscape).join(",")).join("\n"));
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function printHelp() {
  console.log(`
Usage:
  npm run batch:higgsfield -- --input ./input-images --output ./higgsfield-results

Required:
  --input <folder>         Folder containing product images.

Optional:
  --output <folder>        Folder for results.json and results.csv.
  --prompt <text>          Override the default jewelry prompt.
  --mode <mode>            Higgsfield mode. Default: lifestyle_scene.
  --aspectRatio <ratio>    Default: 3:4.
  --count <number>         Variants per image, 1-10. Default: 1.
  --timeout <duration>     CLI timeout per image. Default: 10m.
  --interval <duration>    CLI poll interval. Default: 3s.

Before running:
  npm install -g @higgsfield/cli
  higgsfield auth login
`);
}

function resolveHiggsfieldBinary() {
  if (process.env.HIGGSFIELD_CLI_PATH) {
    return process.env.HIGGSFIELD_CLI_PATH;
  }

  const homeBinary = `${homedir()}/.npm-global/bin/higgsfield`;
  return existsSync(homeBinary) ? homeBinary : "higgsfield";
}

function parseCliJson(stdout) {
  const trimmed = stdout.trim();

  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonLine = trimmed
      .split(/\r?\n/)
      .reverse()
      .find((line) => line.trim().startsWith("{") || line.trim().startsWith("["));

    return jsonLine ? JSON.parse(jsonLine) : { stdout: trimmed };
  }
}

function extractMediaUrls(value) {
  const urls = new Set();

  function visit(input) {
    if (!input) {
      return;
    }

    if (typeof input === "string") {
      if (/^https?:\/\//i.test(input)) {
        urls.add(input);
      }
      return;
    }

    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }

    if (typeof input === "object") {
      Object.entries(input).forEach(([key, nested]) => {
        if (/url|media|output|image/i.test(key)) {
          visit(nested);
        } else if (typeof nested === "object") {
          visit(nested);
        }
      });
    }
  }

  visit(value);
  return [...urls];
}

function extractRequestId(value) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const id = value.request_id ?? value.requestId ?? value.id ?? value.job_id;
  return typeof id === "string" ? id : undefined;
}

function formatCliError(error) {
  if (error && typeof error === "object") {
    return (
      error.stderr?.trim() ||
      error.stdout?.trim() ||
      error.message ||
      "Higgsfield CLI failed."
    );
  }

  return "Higgsfield CLI failed.";
}

function csvEscape(value) {
  const stringValue = String(value ?? "");
  return `"${stringValue.replaceAll('"', '""')}"`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatDuration(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);

  if (hours === 0) {
    return `${minutes} min`;
  }

  return `${hours} hr ${minutes} min`;
}
