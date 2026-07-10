"use client";

import { FormEvent, useMemo, useState } from "react";

type BatchStatus = "queued" | "processing" | "completed" | "failed";

type ShotResult = {
  status: BatchStatus;
  imageUrl?: string;
  mediaUrls?: string[];
  savedPaths?: string[];
  requestId?: string;
  error?: string;
};

type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
  results: ShotResult[];
};

type BatchResponseItem = {
  id: string;
  status: BatchStatus;
  imageUrl?: string;
  mediaUrls?: string[];
  savedPaths?: string[];
  requestId?: string;
  error?: string;
};

const PROMPTS = [
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

const MINUTES_PER_OUTPUT = 7.5;

function emptyResults(): ShotResult[] {
  return PROMPTS.map(() => ({ status: "queued" as BatchStatus }));
}

function createUploadItem(file: File): UploadItem {
  return {
    id: crypto.randomUUID(),
    file,
    previewUrl: URL.createObjectURL(file),
    results: emptyResults(),
  };
}

function formatDuration(totalMinutes: number) {
  if (totalMinutes <= 0) {
    return "0 min";
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);

  if (hours === 0) {
    return `${minutes} min`;
  }

  return `${hours} hr ${minutes} min`;
}

export default function Home() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [outputDirectory, setOutputDirectory] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [notice, setNotice] = useState("");

  const allResults = items.flatMap((item) => item.results);
  const completedCount = allResults.filter((item) => item.status === "completed").length;
  const failedCount = allResults.filter((item) => item.status === "failed").length;
  const totalOutputs = items.length * PROMPTS.length;
  const totalEstimate = totalOutputs * MINUTES_PER_OUTPUT;

  const exportData = useMemo(
    () =>
      JSON.stringify(
        items.map((item) => ({
          sourceFile: item.file.name,
          shots: item.results.map((result, index) => ({
            prompt: PROMPTS[index].label,
            wardrobe: PROMPTS[index].wardrobe,
            status: result.status,
            imageUrl: result.imageUrl,
            mediaUrls: result.mediaUrls,
            savedPaths: result.savedPaths,
            requestId: result.requestId,
            error: result.error,
          })),
        })),
        null,
        2,
      ),
    [items],
  );

  function addFiles(files: FileList | null) {
    const imageFiles = Array.from(files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );

    if (imageFiles.length === 0) {
      return;
    }

    setItems((current) => [...current, ...imageFiles.map(createUploadItem)]);
    setNotice("");
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  async function runBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (items.length === 0) {
      setNotice("Upload at least one image before batch processing.");
      return;
    }

    if (!outputDirectory.trim()) {
      setNotice("Add an output folder path before batch processing.");
      return;
    }

    setIsRunning(true);
    setNotice(
      `Batch started. ${items.length} image${items.length === 1 ? "" : "s"} x ${
        PROMPTS.length
      } prompts = ${totalOutputs} outputs. Estimated time: ${formatDuration(
        totalEstimate,
      )}. Keep this page open while it runs.`,
    );
    setItems((current) =>
      current.map((item) => ({
        ...item,
        results: PROMPTS.map(() => ({ status: "processing" as BatchStatus })),
      })),
    );

    const formData = new FormData();
    const payloadItems: {
      id: string;
      prompt: string;
      imageField: string;
      outputName: string;
    }[] = [];

    for (const item of items) {
      const imageField = `image_${item.id}`;
      const sourceName = item.file.name.replace(/\.[^.]+$/, "");
      formData.append(imageField, item.file);

      PROMPTS.forEach((entry, index) => {
        payloadItems.push({
          id: `${item.id}__${index}`,
          prompt: entry.prompt,
          imageField,
          outputName: `${sourceName}-${entry.label}`,
        });
      });
    }

    formData.append("items", JSON.stringify(payloadItems));
    formData.append("outputDirectory", outputDirectory.trim());

    try {
      const response = await fetch("/api/higgsfield/batch", {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as {
        items?: BatchResponseItem[];
        error?: string;
      };

      if (!response.ok || !data.items) {
        throw new Error(data.error ?? "The batch request failed.");
      }

      setItems((current) =>
        current.map((item) => {
          const results = PROMPTS.map((_, index) => {
            const result = data.items?.find(
              (candidate) => candidate.id === `${item.id}__${index}`,
            );

            return result
              ? {
                  status: result.status,
                  imageUrl: result.imageUrl,
                  mediaUrls: result.mediaUrls,
                  savedPaths: result.savedPaths,
                  requestId: result.requestId,
                  error: result.error,
                }
              : { status: "failed" as BatchStatus, error: "No result returned." };
          });

          return { ...item, results };
        }),
      );

      const failures = data.items.filter((item) => item.status === "failed").length;
      setNotice(
        failures
          ? `Batch finished with ${failures} failed output${failures === 1 ? "" : "s"}.`
          : "Batch processing complete.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      setItems((current) =>
        current.map((item) => ({
          ...item,
          results: item.results.map((result) =>
            result.status === "processing"
              ? { status: "failed" as BatchStatus, error: message }
              : result,
          ),
        })),
      );
      setNotice(message);
    } finally {
      setIsRunning(false);
    }
  }

  function downloadResults() {
    const blob = new Blob([exportData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "higgsfield-three-shot-results.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-[#f7f5f1] text-[#1f1b16]">
      <form
        onSubmit={runBatch}
        className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8"
      >
        <header className="flex flex-col gap-4 border-b border-black/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-[#6b5d4d]">
              Higgsfield Three-Shot Batch
            </p>
            <h1 className="mt-2 max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
              Generate 3 campaign images per upload
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-black/60">
              Each uploaded ring image runs through the arm-crossed, raised-hand,
              and resting-hand prompts. Keep this page open until the results appear.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[380px]">
            <Stat label="Outputs" value={totalOutputs} />
            <Stat label="Done" value={completedCount} />
            <Stat label="Failed" value={failedCount} />
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[380px_1fr]">
          <aside className="flex flex-col gap-4 rounded-lg border border-black/10 bg-white p-4 shadow-sm">
            <label className="grid gap-2 text-sm font-medium">
              Upload ring images
              <input
                disabled={isRunning}
                multiple
                onChange={(event) => addFiles(event.target.files)}
                type="file"
                accept="image/*"
                className="rounded-md border border-black/15 bg-[#fbfaf8] p-3 text-sm file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-[#1f6f68] file:px-3 file:text-sm file:font-semibold file:text-white"
              />
            </label>

            <label className="grid gap-2 text-sm font-medium">
              Output folder path
              <input
                disabled={isRunning}
                value={outputDirectory}
                onChange={(event) => setOutputDirectory(event.target.value)}
                placeholder="/Users/name/Desktop/higgsfield-results"
                className="h-11 rounded-md border border-black/15 bg-[#fbfaf8] px-3 text-sm outline-none focus:border-[#1f6f68] disabled:opacity-70"
              />
            </label>

            <div className="grid gap-2 rounded-md border border-black/10 bg-[#fbfaf8] p-3">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-black/45">
                Fixed prompts
              </span>
              {PROMPTS.map((entry, index) => (
                <div key={entry.label} className="rounded-md bg-white p-2">
                  <p className="text-sm font-semibold">
                    {index + 1}. {entry.label}
                  </p>
                  <p className="text-xs text-black/50">{entry.wardrobe}</p>
                </div>
              ))}
            </div>

            <div className="rounded-md border border-[#d8c7aa] bg-[#fff8eb] p-3 text-sm leading-6 text-[#5e4b2d]">
              Uploaded images: <strong>{items.length}</strong>
              <br />
              Outputs: <strong>{totalOutputs}</strong>
              <br />
              Estimated time: <strong>{formatDuration(totalEstimate)}</strong>
              <br />
              Calculation: {items.length} x 3 x 7.5 minutes
              <br />
              Saves to: <strong>{outputDirectory.trim() || "Add folder path"}</strong>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={isRunning || items.length === 0}
                onClick={downloadResults}
                className="h-11 flex-1 rounded-md border border-black/15 bg-white px-4 text-sm font-semibold hover:bg-black/[.03] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Export
              </button>
              <button
                type="button"
                disabled={isRunning || items.length === 0}
                onClick={() => {
                  setItems([]);
                  setNotice("");
                }}
                className="h-11 flex-1 rounded-md border border-black/15 bg-white px-4 text-sm font-semibold hover:bg-black/[.03] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Clear
              </button>
            </div>

            <button
              disabled={isRunning || items.length === 0 || !outputDirectory.trim()}
              className="h-12 rounded-md bg-[#1f6f68] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#185b56] disabled:cursor-not-allowed disabled:bg-black/25"
            >
              {isRunning ? "Processing batch..." : "Generate 3 images each"}
            </button>

            {notice ? (
              <p className="rounded-md bg-[#f2e6d3] px-3 py-2 text-sm leading-6 text-[#58452f]">
                {notice}
              </p>
            ) : null}
          </aside>

          <section className="grid gap-4">
            {items.length === 0 ? (
              <div className="flex min-h-80 items-center justify-center rounded-lg border border-dashed border-black/20 bg-white p-8 text-center text-sm text-black/50">
                Uploaded images and their three outputs will appear here.
              </div>
            ) : null}

            {items.map((item, index) => (
              <article
                key={item.id}
                className="grid gap-4 rounded-lg border border-black/10 bg-white p-3 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      Image {index + 1}
                    </p>
                    <p className="truncate text-xs text-black/45">{item.file.name}</p>
                  </div>
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => removeItem(item.id)}
                    className="h-9 rounded-md border border-black/10 px-3 text-sm font-semibold text-black/55 hover:bg-black/[.03] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Remove
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-[180px_1fr]">
                  <Preview title="Source" src={item.previewUrl} />

                  <div className="grid gap-3 sm:grid-cols-3">
                    {item.results.map((result, shotIndex) => (
                      <div
                        key={PROMPTS[shotIndex].label}
                        className="rounded-md border border-black/10 bg-[#fbfaf8] p-2"
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold">
                              {PROMPTS[shotIndex].label}
                            </p>
                            <p className="truncate text-[11px] text-black/45">
                              {PROMPTS[shotIndex].wardrobe}
                            </p>
                          </div>
                          <StatusPill status={result.status} />
                        </div>

                        <Preview
                          title="Output"
                          src={result.imageUrl}
                          fallback={
                            result.status === "processing"
                              ? "Waiting"
                              : result.status === "failed"
                                ? "Failed"
                                : "Output"
                          }
                        />

                        {result.error ? (
                          <p className="mt-2 rounded-md bg-[#fbe7e5] px-2 py-1 text-[11px] font-medium leading-5 text-[#9f241c]">
                            {result.error}
                          </p>
                        ) : result.imageUrl ? (
                          <>
                            <a
                              href={result.imageUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 block text-xs font-semibold text-[#1f6f68] hover:underline"
                            >
                              Open generated image
                            </a>
                            {result.savedPaths && result.savedPaths.length > 0 ? (
                              <p className="mt-1 truncate text-[11px] text-black/45">
                                Saved: {result.savedPaths[0]}
                              </p>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </section>
        </section>
      </form>
    </main>
  );
}

function Preview({
  title,
  src,
  fallback = "Preview",
}: {
  title: string;
  src?: string;
  fallback?: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-black/10 bg-[#e9ece6]">
      <div className="border-b border-black/10 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-black/45">
        {title}
      </div>
      <div className="flex aspect-square items-center justify-center">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="px-3 text-center text-xs text-black/45">{fallback}</span>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-black/10 bg-white px-4 py-3 shadow-sm">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs font-medium uppercase tracking-[0.14em] text-black/45">
        {label}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: BatchStatus }) {
  const tone =
    status === "completed"
      ? "bg-[#dff0dd] text-[#24502a]"
      : status === "failed"
        ? "bg-[#f9dddd] text-[#8a1f17]"
        : status === "processing"
          ? "bg-[#dcebf7] text-[#1e4f78]"
          : "bg-black/[.06] text-black/55";

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${tone}`}>
      {status}
    </span>
  );
}
