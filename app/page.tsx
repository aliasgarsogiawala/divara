"use client";

import { FormEvent, useMemo, useState } from "react";

type BatchStatus = "queued" | "processing" | "completed" | "failed";

type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
  status: BatchStatus;
  imageUrl?: string;
  mediaUrls?: string[];
  requestId?: string;
  error?: string;
};

type BatchResponseItem = {
  id: string;
  status: BatchStatus;
  imageUrl?: string;
  mediaUrls?: string[];
  requestId?: string;
  error?: string;
};

const DEFAULT_PROMPT =
  "Create a premium jewelry product photoshoot image from the uploaded ring reference. Preserve the exact ring design, band shape, gemstone setting, engravings, metal finish, scale, and proportions. Show the ring naturally worn on a woman's hand in a clean luxury editorial setting with soft realistic lighting, refined skin texture, and no distortion or hallucinated changes to the jewelry.";

const MINUTES_PER_IMAGE = 7.5;

function createUploadItem(file: File): UploadItem {
  return {
    id: crypto.randomUUID(),
    file,
    previewUrl: URL.createObjectURL(file),
    status: "queued",
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
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [isRunning, setIsRunning] = useState(false);
  const [notice, setNotice] = useState("");

  const completedCount = items.filter((item) => item.status === "completed").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const totalEstimate = items.length * MINUTES_PER_IMAGE;
  const batchLabel = `${items.length} image${items.length === 1 ? "" : "s"}`;

  const exportData = useMemo(
    () =>
      JSON.stringify(
        items.map(({ file, status, imageUrl, mediaUrls, requestId, error }) => ({
          sourceFile: file.name,
          status,
          imageUrl,
          mediaUrls,
          requestId,
          error,
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

    if (!prompt.trim()) {
      setNotice("Add a prompt before batch processing.");
      return;
    }

    setIsRunning(true);
    setNotice(
      `Batch started. ${batchLabel} will take approximately ${formatDuration(
        totalEstimate,
      )}. Keep this page open while it runs.`,
    );
    setItems((current) =>
      current.map((item) => ({
        ...item,
        status: "processing",
        imageUrl: undefined,
        mediaUrls: undefined,
        requestId: undefined,
        error: undefined,
      })),
    );

    const formData = new FormData();
    const payloadItems = items.map((item) => {
      const imageField = `image_${item.id}`;
      formData.append(imageField, item.file);
      return {
        id: item.id,
        prompt: prompt.trim(),
        imageField,
      };
    });

    formData.append("items", JSON.stringify(payloadItems));

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
          const result = data.items?.find((candidate) => candidate.id === item.id);
          return result ? { ...item, ...result } : item;
        }),
      );

      const failures = data.items.filter((item) => item.status === "failed").length;
      setNotice(
        failures
          ? `Batch finished with ${failures} failed image${failures === 1 ? "" : "s"}.`
          : "Batch processing complete.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      setItems((current) =>
        current.map((item) =>
          item.status === "processing"
            ? { ...item, status: "failed", error: message }
            : item,
        ),
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
    link.download = "higgsfield-batch-results.json";
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
              Higgsfield Production Batch
            </p>
            <h1 className="mt-2 max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
              Upload images and process the batch
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-black/60">
              Each image takes around 7.5 minutes. Large batches will take time, so
              keep this page open until the results appear.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[380px]">
            <Stat label="Images" value={items.length} />
            <Stat label="Done" value={completedCount} />
            <Stat label="Failed" value={failedCount} />
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[380px_1fr]">
          <aside className="flex flex-col gap-4 rounded-lg border border-black/10 bg-white p-4 shadow-sm">
            <label className="grid gap-2 text-sm font-medium">
              Upload images
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
              Prompt
              <textarea
                value={prompt}
                disabled={isRunning}
                onChange={(event) => setPrompt(event.target.value)}
                className="min-h-56 resize-y rounded-md border border-black/15 px-3 py-2 text-sm leading-6 outline-none focus:border-[#1f6f68] disabled:opacity-70"
              />
            </label>

            <div className="rounded-md border border-[#d8c7aa] bg-[#fff8eb] p-3 text-sm leading-6 text-[#5e4b2d]">
              Batch size: <strong>{batchLabel}</strong>
              <br />
              Estimated time: <strong>{formatDuration(totalEstimate)}</strong>
              <br />
              Calculation: {items.length} x 7.5 minutes
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
              disabled={isRunning || items.length === 0}
              className="h-12 rounded-md bg-[#1f6f68] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#185b56] disabled:cursor-not-allowed disabled:bg-black/25"
            >
              {isRunning ? "Processing batch..." : "Batch process images"}
            </button>

            {notice ? (
              <p className="rounded-md bg-[#f2e6d3] px-3 py-2 text-sm leading-6 text-[#58452f]">
                {notice}
              </p>
            ) : null}
          </aside>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.length === 0 ? (
              <div className="col-span-full flex min-h-80 items-center justify-center rounded-lg border border-dashed border-black/20 bg-white p-8 text-center text-sm text-black/50">
                Uploaded images will appear here.
              </div>
            ) : null}

            {items.map((item, index) => (
              <article
                key={item.id}
                className="flex flex-col gap-3 rounded-lg border border-black/10 bg-white p-3 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      Image {index + 1}
                    </p>
                    <p className="truncate text-xs text-black/45">{item.file.name}</p>
                  </div>
                  <StatusPill status={item.status} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Preview title="Source" src={item.previewUrl} />
                  <Preview
                    title="Output"
                    src={item.imageUrl}
                    fallback={
                      item.status === "processing"
                        ? "Waiting"
                        : item.status === "failed"
                          ? "Failed"
                          : "Output"
                    }
                  />
                </div>

                {item.error ? (
                  <p className="rounded-md bg-[#fbe7e5] px-3 py-2 text-xs font-medium leading-5 text-[#9f241c]">
                    {item.error}
                  </p>
                ) : item.imageUrl ? (
                  <a
                    href={item.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold text-[#1f6f68] hover:underline"
                  >
                    Open generated image
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => removeItem(item.id)}
                    className="h-9 rounded-md border border-black/10 text-sm font-semibold text-black/55 hover:bg-black/[.03] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Remove
                  </button>
                )}
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
