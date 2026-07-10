import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const maxDuration = 7200;

type PromptItem = {
  id: string;
  prompt: string;
  imageField: string;
};

type BatchOptions = {
  mode?: string;
  aspectRatio?: string;
  count?: number;
  brandContext?: string;
  productContext?: string;
  preserveStructure?: boolean;
};

type BatchResult = {
  id: string;
  prompt: string;
  status: "completed" | "failed";
  imageUrl?: string;
  mediaUrls?: string[];
  requestId?: string;
  error?: string;
  raw?: unknown;
};

const execFileAsync = promisify(execFile);
const defaultMode = "lifestyle_scene";

export async function POST(request: Request) {
  let workingDirectory = "";

  try {
    const formData = await request.formData();
    const items = parseItems(formData.get("items"));
    const options = defaultOptions();

    if (items.length === 0) {
      return Response.json({ error: "Add at least one prompt and image." }, { status: 400 });
    }

    workingDirectory = `${tmpdir()}/higgsfield-batch-${Date.now()}`;
    await mkdir(workingDirectory, { recursive: true });

    const prepared = await Promise.all(
      items.map(async (item) => {
        const file = formData.get(item.imageField);

        if (!(file instanceof File) || file.size === 0) {
          return { item, imagePath: null };
        }

        const imagePath = await saveUpload(file, workingDirectory, item.id);
        return { item, imagePath };
      }),
    );

    const results = await mapWithConcurrency(prepared, 1, async ({ item, imagePath }) => {
      if (!imagePath) {
        return {
          id: item.id,
          prompt: item.prompt,
          status: "failed" as const,
          error: "Missing product image.",
        };
      }

      return runProductPhotoshoot(item, imagePath, options);
    });

    return Response.json({ items: results });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to process the Higgsfield batch.",
      },
      { status: 500 },
    );
  } finally {
    if (workingDirectory) {
      await rm(workingDirectory, { force: true, recursive: true });
    }
  }
}

function parseItems(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as PromptItem[];
    return Array.isArray(parsed)
      ? parsed
          .map((item) => ({
            id: String(item.id ?? ""),
            prompt: String(item.prompt ?? "").trim(),
            imageField: String(item.imageField ?? ""),
          }))
          .filter((item) => item.id && item.prompt && item.imageField)
          .slice(0, 25)
      : [];
  } catch {
    return [];
  }
}

function defaultOptions(): Required<BatchOptions> {
  return {
    mode: defaultMode,
    aspectRatio: "3:4",
    count: 1,
    brandContext: "Premium fine jewelry, clean luxury editorial styling",
    productContext: "Fine jewelry ring worn naturally on a hand",
    preserveStructure: true,
  };
}

async function saveUpload(file: File, directory: string, id: string) {
  const extension = extensionFor(file.name, file.type);
  const imagePath = `${directory}/${safeName(id)}${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(imagePath, buffer);
  return imagePath;
}

async function runProductPhotoshoot(
  item: PromptItem,
  imagePath: string,
  options: Required<BatchOptions>,
): Promise<BatchResult> {
  const prompt = options.preserveStructure
    ? `${item.prompt}. Preserve the exact product geometry, gemstone setting, engravings, material finish, and proportions. Keep hallucination low and avoid changing the ring structure.`
    : item.prompt;

  const args = [
    "product-photoshoot",
    "create",
    "--mode",
    options.mode,
    "--prompt",
    prompt,
    "--image",
    imagePath,
    "--count",
    String(options.count),
    "--aspect_ratio",
    options.aspectRatio,
    "--timeout",
    "10m",
    "--interval",
    "3s",
    "--json",
    "--no-color",
  ];

  if (options.brandContext.trim()) {
    args.push("--brand_context", options.brandContext.trim());
  }

  if (options.productContext.trim()) {
    args.push("--product_context", options.productContext.trim());
  }

  try {
    const { stdout } = await execFileAsync(resolveHiggsfieldBinary(), args, {
      env: {
        ...process.env,
        PATH: [
          process.env.PATH,
          `${process.env.HOME ?? ""}/.npm-global/bin`,
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
      id: item.id,
      prompt: item.prompt,
      status: mediaUrls.length > 0 ? "completed" : "failed",
      imageUrl: mediaUrls[0],
      mediaUrls,
      requestId: extractRequestId(raw),
      error: mediaUrls.length > 0 ? undefined : "Higgsfield finished without returning a media URL.",
      raw,
    };
  } catch (error) {
    return {
      id: item.id,
      prompt: item.prompt,
      status: "failed",
      error: formatCliError(error),
    };
  }
}

function resolveHiggsfieldBinary() {
  if (process.env.HIGGSFIELD_CLI_PATH) {
    return process.env.HIGGSFIELD_CLI_PATH;
  }

  const homeBinary = `${process.env.HOME ?? ""}/.npm-global/bin/higgsfield`;
  return existsSync(homeBinary) ? homeBinary : "higgsfield";
}

function parseCliJson(stdout: string) {
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

function extractMediaUrls(value: unknown): string[] {
  const urls = new Set<string>();

  function visit(input: unknown) {
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

function extractRequestId(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const id = record.request_id ?? record.requestId ?? record.id ?? record.job_id;
  return typeof id === "string" ? id : undefined;
}

function formatCliError(error: unknown) {
  if (error && typeof error === "object") {
    const record = error as { stderr?: string; stdout?: string; message?: string };
    return record.stderr?.trim() || record.stdout?.trim() || record.message || "Higgsfield CLI failed.";
  }

  return "Higgsfield CLI failed.";
}

function extensionFor(fileName: string, contentType: string) {
  const parsed = fileName.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase() ?? "";

  if (/^\.(png|jpe?g|webp|gif|heic|heif)$/i.test(parsed)) {
    return parsed;
  }

  if (contentType.includes("png")) {
    return ".png";
  }

  if (contentType.includes("webp")) {
    return ".webp";
  }

  return ".jpg";
}

function safeName(value: string) {
  return value.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(runners);
  return results;
}
