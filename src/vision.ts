import type { Detection, Mode, Quad } from "./types";
const worker = new Worker(new URL("./vision.worker.ts", import.meta.url), {
  type: "module",
});
let detector: Worker | undefined;
function detectionWorker() {
  if (!detector) {
    detector = new Worker(new URL("./vision.worker.ts", import.meta.url), {
      type: "module",
    });
    detector.onmessage = worker.onmessage;
    detector.onerror = worker.onerror;
  }
  return detector;
}
let next = 0;
const pending = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();
worker.onmessage = ({ data }) => {
  const p = pending.get(data.id);
  if (!p) return;
  pending.delete(data.id);
  data.error ? p.reject(Error(data.error)) : p.resolve(data.result);
};
worker.onerror = (event) => {
  for (const p of pending.values())
    p.reject(Error(event.message || "이미지 처리 Worker 오류"));
  pending.clear();
};
function request<T>(data: any, bitmap: ImageBitmap): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    (data.type === "detect" ? detectionWorker() : worker).postMessage(
      {
        ...data,
        id,
        bitmap,
        url: new URL(
          "vendor/opencv.js",
          new URL(import.meta.env.BASE_URL, location.href),
        ).href,
      },
      [bitmap],
    );
  });
}
export async function detect(image: CanvasImageSource) {
  const bitmap = await createImageBitmap(image as HTMLCanvasElement);
  return request<Detection>({ type: "detect" }, bitmap);
}
export async function correct(
  blob: Blob,
  quad: Quad,
  mode: Mode,
  quality = 0.9,
) {
  return request<Blob>(
    { type: "process", quad, mode, quality },
    await createImageBitmap(blob),
  );
}
export async function dewarp(blob: Blob, strength: number) {
  return request<Blob>(
    { type: "dewarp", strength },
    await createImageBitmap(blob),
  );
}
export async function thumbnail(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = 180;
  c.height = Math.round((180 * bitmap.height) / bitmap.width);
  c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(Error("썸네일 생성 실패"))),
      "image/jpeg",
      0.7,
    ),
  );
}
export async function spine(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, 256, 128);
  bitmap.close();
  const p = ctx.getImageData(0, 0, 256, 128).data;
  let best = Infinity,
    xBest = 128;
  const scores: number[] = [];
  for (let x = 90; x < 167; x++) {
    let s = 0;
    for (let y = 12; y < 116; y++) {
      const i = (y * 256 + x) * 4;
      s += (p[i] + p[i + 1] + p[i + 2]) / 3;
    }
    scores.push(s / 104);
    if (s < best) {
      best = s;
      xBest = x;
    }
  }
  const average = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { position: xBest / 256, confident: average - best / 104 > 12 };
}
