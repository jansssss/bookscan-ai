/// <reference lib="webworker" />
import type { Quad, Detection, Mode } from "./types";
import { orderQuad } from "./geometry";
let cv: any;
async function ready(url: string) {
  if (cv) return;
  const s = await fetch(url);
  if (!s.ok) throw Error("OpenCV 파일을 불러올 수 없습니다.");
  const source = await s.text();
  (0, eval)(source + "\nself.__bookscanCV=cv;");
  const loaded = (self as any).__bookscanCV;
  cv = await new Promise<any>((resolve) => {
    if (loaded?.then) loaded.then(resolve);
    else if (loaded?.Mat) resolve(loaded);
    else loaded.onRuntimeInitialized = () => resolve(loaded);
  });
}
function detect(bitmap: ImageBitmap): Detection {
  const src = new cv.Mat(bitmap.height, bitmap.width, cv.CV_8UC4);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  src.data.set(data.data);
  const gray = new cv.Mat(),
    blur = new cv.Mat(),
    edge = new cv.Mat(),
    contours = new cv.MatVector(),
    hierarchy = new cv.Mat(),
    lap = new cv.Mat(),
    mean = new cv.Mat(),
    std = new cv.Mat();
  let quad: Quad | null = null;
  let best = 0;
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.Laplacian(gray, lap, cv.CV_64F);
    cv.meanStdDev(lap, mean, std);
    const sharpness = std.doubleAt(0, 0) ** 2;
    let sum = 0,
      clipped = 0,
      dark = 0;
    for (const v of gray.data) {
      sum += v;
      if (v > 250 || v < 5) clipped++;
      if (v < 45) dark++;
    }
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    try {
      // Broken/shadowed page edges and pale pages need different candidates.
      for (let pass = 0; pass < 3; pass++) {
        if (pass === 0) cv.Canny(blur, edge, 25, 85);
        else if (pass === 1)
          cv.threshold(blur, edge, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
        else
          cv.adaptiveThreshold(
            blur,
            edge,
            255,
            cv.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv.THRESH_BINARY,
            31,
            9,
          );
        cv.morphologyEx(edge, edge, cv.MORPH_CLOSE, kernel);
        cv.findContours(
          edge,
          contours,
          hierarchy,
          cv.RETR_LIST,
          cv.CHAIN_APPROX_SIMPLE,
        );
        for (let i = 0; i < contours.size(); i++) {
          const c = contours.get(i),
            hull = new cv.Mat(),
            poly = new cv.Mat();
          try {
            const contourArea = cv.contourArea(c);
            if (contourArea < bitmap.width * bitmap.height * 0.12) continue;
            cv.convexHull(c, hull);
            for (const epsilon of [0.015, 0.025, 0.04]) {
              cv.approxPolyDP(
                hull,
                poly,
                epsilon * cv.arcLength(hull, true),
                true,
              );
              if (poly.rows !== 4 || !cv.isContourConvex(poly)) continue;
              const area = cv.contourArea(poly),
                fraction = area / (bitmap.width * bitmap.height);
              if (
                fraction < 0.12 ||
                fraction > 0.97 ||
                contourArea / area < 0.7
              )
                continue;
              const candidate = orderQuad(
                Array.from({ length: 4 }, (_, j) => ({
                  x: poly.data32S[j * 2] / bitmap.width,
                  y: poly.data32S[j * 2 + 1] / bitmap.height,
                })),
              );
              // Reject near-full-frame background and extremely skewed inner text boxes.
              const border = candidate.filter(
                (p) => p.x < 0.012 || p.x > 0.988 || p.y < 0.012 || p.y > 0.988,
              ).length;
              const angles = candidate.map((p, j) => {
                const a = candidate[(j + 3) % 4],
                  b = candidate[(j + 1) % 4];
                const ax = (a.x - p.x) * bitmap.width,
                  ay = (a.y - p.y) * bitmap.height;
                const bx = (b.x - p.x) * bitmap.width,
                  by = (b.y - p.y) * bitmap.height;
                return Math.abs(
                  (ax * bx + ay * by) /
                    (Math.hypot(ax, ay) * Math.hypot(bx, by)),
                );
              });
              if (Math.max(...angles) > 0.8) continue;
              const score =
                area * (1 - 0.18 * border) * (1 - 0.2 * Math.max(...angles));
              if (score > best) {
                quad = candidate;
                best = score;
              }
            }
          } finally {
            c.delete();
            hull.delete();
            poly.delete();
          }
        }
      }
    } finally {
      kernel.delete();
    }
    const small = new cv.Mat();
    const hash: number[] = [];
    try {
      cv.resize(gray, small, new cv.Size(8, 8));
      hash.push(...small.data);
    } finally {
      small.delete();
    }
    return {
      quad,
      sharpness,
      brightness: sum / gray.data.length,
      clipped: clipped / gray.data.length,
      shadow: dark / gray.data.length,
      hash,
    };
  } finally {
    [src, gray, blur, edge, contours, hierarchy, lap, mean, std].forEach((m) =>
      m.delete(),
    );
  }
}
function processImage(
  bitmap: ImageBitmap,
  quad: Quad,
  mode: Mode,
  quality: number,
) {
  const input = new OffscreenCanvas(bitmap.width, bitmap.height);
  input.getContext("2d")!.drawImage(bitmap, 0, 0);
  const src = new cv.Mat(bitmap.height, bitmap.width, cv.CV_8UC4);
  src.data.set(
    input.getContext("2d")!.getImageData(0, 0, bitmap.width, bitmap.height)
      .data,
  );
  const d = (a: number, b: number) =>
    Math.hypot(
      (quad[a].x - quad[b].x) * bitmap.width,
      (quad[a].y - quad[b].y) * bitmap.height,
    );
  let width = Math.round(Math.max(d(0, 1), d(2, 3))),
    height = Math.round(Math.max(d(0, 3), d(1, 2)));
  const scale = Math.min(1, 3200 / Math.max(width, height));
  width = Math.max(32, Math.round(width * scale));
  height = Math.max(32, Math.round(height * scale));
  const from = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    quad.flatMap((p) => [p.x * bitmap.width, p.y * bitmap.height]),
  );
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,
    0,
    width - 1,
    0,
    width - 1,
    height - 1,
    0,
    height - 1,
  ]);
  const transform = cv.getPerspectiveTransform(from, to),
    out = new cv.Mat(),
    gray = new cv.Mat(),
    bg = new cv.Mat(),
    normalized = new cv.Mat(),
    rgba = new cv.Mat();
  try {
    cv.warpPerspective(
      src,
      out,
      transform,
      new cv.Size(width, height),
      cv.INTER_CUBIC,
      cv.BORDER_REPLICATE,
    );
    if (mode === "original") out.copyTo(rgba);
    else {
      cv.cvtColor(out, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, bg, new cv.Size(0, 0), 25);
      cv.divide(gray, bg, normalized, 235);
      if (mode === "gray" || mode === "bw")
        cv.medianBlur(normalized, normalized, 3);
      if (mode === "bw") {
        cv.adaptiveThreshold(
          normalized,
          gray,
          255,
          cv.ADAPTIVE_THRESH_GAUSSIAN_C,
          cv.THRESH_BINARY,
          31,
          12,
        );
        cv.cvtColor(gray, rgba, cv.COLOR_GRAY2RGBA);
      } else if (mode === "gray")
        cv.cvtColor(normalized, rgba, cv.COLOR_GRAY2RGBA);
      else {
        out.copyTo(rgba);
        for (let i = 0; i < gray.data.length; i++) {
          const factor = Math.min(2, 235 / Math.max(60, bg.data[i]));
          for (let j = 0; j < 3; j++)
            rgba.data[i * 4 + j] = Math.min(255, out.data[i * 4 + j] * factor);
        }
        cv.GaussianBlur(rgba, bg, new cv.Size(0, 0), 1);
        cv.addWeighted(rgba, 1.25, bg, -0.25, 0, rgba);
      }
    }
    const canvas = new OffscreenCanvas(width, height);
    canvas
      .getContext("2d")!
      .putImageData(
        new ImageData(new Uint8ClampedArray(rgba.data), width, height),
        0,
        0,
      );
    return canvas.convertToBlob({ type: "image/jpeg", quality });
  } finally {
    [src, from, to, transform, out, gray, bg, normalized, rgba].forEach((m) =>
      m.delete(),
    );
  }
}
async function dewarp(bitmap: ImageBitmap, strength: number) {
  const w = bitmap.width,
    h = bitmap.height,
    c = new OffscreenCanvas(w, h);
  c.getContext("2d")!.drawImage(bitmap, 0, 0);
  const src = new cv.Mat(h, w, cv.CV_8UC4),
    out = new cv.Mat(),
    mx = new cv.Mat(h, w, cv.CV_32FC1),
    my = new cv.Mat(h, w, cv.CV_32FC1);
  try {
    src.data.set(c.getContext("2d")!.getImageData(0, 0, w, h).data);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        mx.data32F[i] = x;
        my.data32F[i] =
          y +
          strength *
            h *
            Math.sin((Math.PI * x) / (w - 1)) *
            Math.sin((Math.PI * y) / (h - 1));
      }
    cv.remap(src, out, mx, my, cv.INTER_CUBIC, cv.BORDER_REPLICATE);
    c.getContext("2d")!.putImageData(
      new ImageData(new Uint8ClampedArray(out.data), w, h),
      0,
      0,
    );
    return await c.convertToBlob({ type: "image/jpeg", quality: 0.95 });
  } finally {
    [src, out, mx, my].forEach((m) => m.delete());
  }
}
self.onmessage = async (event) => {
  const { id, type, url, bitmap, quad, mode, quality, strength } = event.data;
  try {
    await ready(url);
    let result;
    if (type === "detect") result = detect(bitmap);
    else if (type === "dewarp") result = await dewarp(bitmap, strength);
    else result = await processImage(bitmap, quad, mode, quality);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  } finally {
    bitmap?.close();
  }
};
