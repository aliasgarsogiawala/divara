#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"]);
const minutesPerOutput = 7.5;

const prompts = [
  {
    label: "Arm-Crossed Pose",
    wardrobe: "Muted Green Top",
    prompt:
      "A high-end lifestyle commercial shot of a woman's graceful, bare hand wearing the single ring from the input images on her ring finger. The exact design, cut, band, and structure of the ring must remain completely unchanged from the input. Her bare forearm is crossed gently over her opposite bare forearm. She is wearing a sleeveless muted olive-green textured knit top, leaving her shoulders and arms exposed. Macro focus on the diamond's brilliance. Soft, diffused studio lighting, neutral beige background, hyper-realistic skin texture, subtle hand movement.",
  },
  {
    label: "Raised Hand Profile",
    wardrobe: "Muted Brown Top",
    prompt:
      "A close-up cinematic shot of a woman's bare hand raised with fingers slightly spread, showcasing the single ring from the input images on the ring finger. Do not alter the ring's design; the structure must perfectly match the original input. She is wearing a short-sleeved brown ribbed-knit top, leaving her entire forearm and elbow visible and bare. Minimalist studio aesthetic, soft focus neutral background, shallow depth of field, premium jewelry commercial style, subtle light shimmer.",
  },
  {
    label: "Resting Hand Angle",
    wardrobe: "Cream Linen Top",
    prompt:
      "An elegant, editorial close-up shot of a woman's bare hand resting flat on her opposite bare forearm, displaying the single ring from the input images on her ring finger. The design, shape, and gem settings of the ring must be preserved perfectly without any changes or distortions. She is wearing a sleeveless cream-colored linen top, showcasing her bare wrists and lower arms. Soft natural lighting from the side, clean minimalist aesthetic, hyper-detailed skin pores, slow macro pan focusing on the jewelry.",
  },
];

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.input) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const inputDir = path.resolve(args.input);
const outputDir = path.resolve(args.output ?? "higgsfield-results");
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

const totalOutputs = files.length * prompts.length;
console.log(`Found ${files.length} image${files.length === 1 ? "" : "s"}.`);
console.log(`Each image will generate ${prompts.length} fixed campaign shots.`);
console.log(`Estimated time: ${formatDuration(totalOutputs * minutesPerOutput)}.`);
console.log(`Output folder: ${outputDir}`);
console.log("");

const startedAt = new Date().toISOString();
const results = [];

for (const [index, file] of files.entries()) {
  const label = `${index + 1}/${files.length}`;
  const name = path.basename(file);

  console.log(`[${label}] Processing ${name}`);

  const shots = [];

  for (const [promptIndex, promptEntry] of prompts.entries()) {
    console.log(`  [${promptIndex + 1}/${prompts.length}] ${promptEntry.label}`);

    const result = await runHiggsfield(file, {
      prompt: promptEntry.prompt,
      mode,
      aspectRatio,
      count,
      timeout,
      interval,
      outputDir,
      file,
      shotLabel: promptEntry.label,
    });

    shots.push({
      label: promptEntry.label,
      wardrobe: promptEntry.wardrobe,
      prompt: promptEntry.prompt,
      ...result,
    });

    await writeReports(outputDir, startedAt, [
      ...results,
      {
        sourceFile: file,
        shots,
      },
    ]);

    if (result.status === "completed") {
      console.log(`  Done: ${result.mediaUrls.join(", ")}`);
    } else {
      console.log(`  Failed: ${result.error}`);
    }
  }

  results.push({
    sourceFile: file,
    shots,
  });

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
    const savedPaths =
      mediaUrls.length > 0
        ? await saveGeneratedMedia(mediaUrls, {
            outputDir: options.outputDir,
            sourceFile: options.file,
            shotLabel: options.shotLabel,
          })
        : [];

    return {
      status: mediaUrls.length > 0 ? "completed" : "failed",
      mediaUrls,
      savedPaths,
      imageUrl: mediaUrls[0] ?? "",
      requestId: extractRequestId(raw) ?? "",
      error: mediaUrls.length > 0 ? "" : "Higgsfield finished without returning a media URL.",
      raw,
    };
  } catch (error) {
    return {
      status: "failed",
      mediaUrls: [],
      savedPaths: [],
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
        totalOutputs: results.flatMap((result) => result.shots).length,
        completed: results
          .flatMap((result) => result.shots)
          .filter((result) => result.status === "completed").length,
        failed: results
          .flatMap((result) => result.shots)
          .filter((result) => result.status === "failed").length,
        results,
      },
      null,
      2,
    ),
  );

  const csvRows = [
    [
      "source_file",
      "shot",
      "wardrobe",
      "status",
      "image_url",
      "all_media_urls",
      "saved_paths",
      "request_id",
      "error",
    ],
    ...results.flatMap((result) =>
      result.shots.map((shot) => [
        result.sourceFile,
        shot.label,
        shot.wardrobe,
        shot.status,
        shot.imageUrl,
        shot.mediaUrls.join(" | "),
        shot.savedPaths.join(" | "),
        shot.requestId,
        shot.error,
      ]),
    ),
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

async function saveGeneratedMedia(mediaUrls, { outputDir, sourceFile, shotLabel }) {
  await mkdir(outputDir, { recursive: true });

  const savedPaths = [];
  const sourceName = path.basename(sourceFile, path.extname(sourceFile));
  const shotName = slugify(shotLabel);

  for (const [index, mediaUrl] of mediaUrls.entries()) {
    const response = await fetch(mediaUrl);

    if (!response.ok) {
      continue;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const extension = extensionFor(mediaUrl, contentType);
    const suffix = mediaUrls.length > 1 ? `-${index + 1}` : "";
    const fileName = `${slugify(sourceName)}-${shotName}${suffix}${extension}`;
    const filePath = path.join(outputDir, fileName);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(filePath, buffer);
    savedPaths.push(filePath);
  }

  return savedPaths;
}

function extensionFor(fileName, contentType) {
  const parsed = fileName.match(/\.[a-z0-9]+(?=($|[?#]))/i)?.[0].toLowerCase() ?? "";

  if (/^\.(png|jpe?g|webp|gif|heic|heif|mp4|mov)$/i.test(parsed)) {
    return parsed;
  }

  if (contentType.includes("png")) {
    return ".png";
  }

  if (contentType.includes("webp")) {
    return ".webp";
  }

  if (contentType.includes("mp4")) {
    return ".mp4";
  }

  return ".jpg";
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
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
