import type { Page, Project } from "./types";
import { original, image as storedImage } from "./storage";
export const stem = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_");
export function originalPath(p: Page) {
  const ext: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/heic": "heic",
  };
  return `originals/${p.originalId}.${ext[p.originalMime || "image/jpeg"] || "bin"}`;
}
export function metadata(project: Project, pages: Page[]) {
  return {
    schema: "security-pass-ai/bookscan/1",
    documentId: project.id,
    book: project.name,
    subject: project.subject,
    pages: pages.map((p) => ({
      documentId: project.id,
      pageId: p.id,
      pageNumber: p.order,
      original: originalPath(p),
      image: `images/${p.id}.jpg`,
      ocrText: p.text,
      ocrConfidence: p.confidence,
      words: p.words,
      scannedAt: p.date,
      captureSource: p.captureSource || "web",
      originalKind:
        p.captureSource === "mlkit" ? "scanner-result" : "camera-original",
      mode: p.mode,
      quad: p.quad,
      experimentalDewarp: p.dewarp || 0,
      rotation: p.rotation || 0,
    })),
  };
}
export async function pdf(
  pages: Page[],
  size: "a4" | "natural",
  quality: number,
  progress: (n: number) => void,
) {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages.length; i++) {
    let image = await storedImage(pages[i].id);
    if (quality < 0.95) {
      const b = await createImageBitmap(image);
      const c = document.createElement("canvas");
      c.width = b.width;
      c.height = b.height;
      c.getContext("2d")!.drawImage(b, 0, 0);
      b.close();
      image = await new Promise<Blob>((resolve, reject) =>
        c.toBlob(
          (v) => (v ? resolve(v) : reject(Error("PDF 압축 실패"))),
          "image/jpeg",
          quality,
        ),
      );
      c.width = c.height = 0;
    }
    const embedded = await doc.embedJpg(await image.arrayBuffer());
    const dims: [number, number] =
      size === "a4" ? [595.28, 841.89] : [embedded.width, embedded.height];
    const p = doc.addPage(dims);
    const scale = Math.min(dims[0] / embedded.width, dims[1] / embedded.height);
    p.drawImage(embedded, {
      x: (dims[0] - embedded.width * scale) / 2,
      y: (dims[1] - embedded.height * scale) / 2,
      width: embedded.width * scale,
      height: embedded.height * scale,
    });
    progress((i + 1) / pages.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return new Blob([new Uint8Array(await doc.save())], {
    type: "application/pdf",
  });
}
export async function zip(
  project: Project,
  pages: Page[],
  pdfBlob: Blob | null,
  progress: (p: number) => void,
) {
  const { Zip, ZipPassThrough, strToU8 } = await import("fflate");
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let error: Error | null = null;
  const archive = new Zip((e, data) => {
    if (e) error = e;
    else parts.push(new Uint8Array(data));
  });
  function add(name: string, data: Uint8Array) {
    const file = new ZipPassThrough(name);
    archive.add(file);
    file.push(data, true);
  }
  add(
    "metadata.json",
    strToU8(JSON.stringify(metadata(project, pages), null, 2)),
  );
  add(
    "OCR.txt",
    strToU8(
      pages.map((p) => `=== ${p.order}페이지 ===\n${p.text}`).join("\n\n"),
    ),
  );
  if (pdfBlob) add("scan.pdf", new Uint8Array(await pdfBlob.arrayBuffer()));
  const seen = new Set<string>();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    add(
      `images/${p.id}.jpg`,
      new Uint8Array(await (await storedImage(p.id)).arrayBuffer()),
    );
    if (!seen.has(p.originalId)) {
      add(
        originalPath(p),
        new Uint8Array(await (await original(p.originalId)).arrayBuffer()),
      );
      seen.add(p.originalId);
    }
    progress((i + 1) / pages.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  archive.end();
  if (error) throw error;
  return new Blob(parts, { type: "application/zip" });
}
export async function saveFile(blob: Blob, name: string, share = false) {
  const { native, nativeSave } = await import("./native");
  if (native()) return nativeSave(blob, name, share);
  const file = new File([blob], name, { type: blob.type });
  if (share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: name });
    return;
  }
  if (share)
    throw Error(
      "이 브라우저에서는 파일 공유를 지원하지 않습니다. 다운로드를 이용하세요.",
    );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
