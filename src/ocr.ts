import { createWorker, type Worker } from "tesseract.js";
import type { Word } from "./types";
let worker: Worker | undefined;
export async function orientation(blob: Blob) {
  const base = new URL(
    "vendor/",
    new URL(import.meta.env.BASE_URL, location.href),
  ).href;
  const osd = await createWorker("osd", 0, {
    legacyCore: true,
    legacyLang: true,
    workerPath: base + "worker.min.js",
    corePath: base,
    langPath: base,
    workerBlobURL: false,
  });
  try {
    const { data } = await osd.detect(blob);
    if (!data || (data.orientation_confidence || 0) < 5)
      throw Error("자동 회전 신뢰도가 낮습니다. 90° 회전 버튼을 사용해주세요.");
    return data.orientation_degrees;
  } finally {
    await osd.terminate();
  }
}
export async function recognize(blob: Blob, progress: (p: number) => void) {
  const base = new URL(
    "vendor/",
    new URL(import.meta.env.BASE_URL, location.href),
  ).href;
  if (!worker)
    worker = await createWorker("kor+eng", 1, {
      workerPath: base + "worker.min.js",
      corePath: base,
      langPath: base,
      workerBlobURL: false,
      cacheMethod: "write",
      logger: (m) => {
        if (m.status === "recognizing text") progress(m.progress);
      },
    });
  const { data } = await worker.recognize(
    blob,
    {},
    { blocks: true, text: true },
  );
  const words: Word[] = [];
  for (const b of data.blocks || [])
    for (const p of b.paragraphs)
      for (const l of p.lines)
        for (const w of l.words)
          words.push({ text: w.text, confidence: w.confidence, bbox: w.bbox });
  return { text: data.text, confidence: data.confidence, words };
}
