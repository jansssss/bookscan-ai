import { mkdir, copyFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const root = "public/vendor";
await mkdir(root, { recursive: true });
await copyFile(
  require.resolve("@techstark/opencv-js/dist/opencv.js"),
  join(root, "opencv.js"),
);
await copyFile(
  require.resolve("tesseract.js/dist/worker.min.js"),
  join(root, "worker.min.js"),
);
const tessRequire = createRequire(require.resolve("tesseract.js"));
const core = dirname(tessRequire.resolve("tesseract.js-core"));
for (const name of await readdir(core))
  if (/\.wasm(\.js)?$/.test(name))
    await copyFile(join(core, name), join(root, name));
for (const lang of ["kor", "eng", "osd"]) {
  const r = await fetch(
    `https://tessdata.projectnaptha.com/4.0.0/${lang}.traineddata.gz`,
  );
  if (!r.ok) throw Error(`Language asset ${lang}: ${r.status}`);
  await writeFile(
    join(root, `${lang}.traineddata.gz`),
    new Uint8Array(await r.arrayBuffer()),
  );
}
console.log(
  "OpenCV, OCR worker, WASM and Korean/English models copied locally.",
);

await mkdir(join(root, "licenses"), { recursive: true });
for (const pkg of [
  "@techstark/opencv-js",
  "tesseract.js",
  "pdf-lib",
  "react",
  "react-dom",
  "fflate",
  "idb",
]) {
  const dir = dirname(require.resolve(pkg + "/package.json"));
  for (const file of await readdir(dir))
    if (/^licen[cs]e/i.test(file))
      await copyFile(
        join(dir, file),
        join(root, "licenses", pkg.replaceAll("/", "-") + "-" + file),
      );
}
