import { openDB } from "idb";
import type { Page, Project } from "./types";
const db = openDB("bookscan-ai", 2, {
  upgrade(db, old, _new, tx) {
    if (old < 1) {
      db.createObjectStore("projects", { keyPath: "id" });
      const p = db.createObjectStore("pages", { keyPath: "id" });
      p.createIndex("project", "project");
      db.createObjectStore("originals", { keyPath: "id" });
      db.createObjectStore("images", { keyPath: "id" });
    }
    if (old < 2) {
      tx.objectStore("originals").createIndex(
        "pendingProject",
        "pendingProject",
      );
    }
  },
  blocking() {
    db.then((database) => database.close());
  },
  blocked() {
    window.dispatchEvent(new Event("bookscan-storage-blocked"));
  },
});
export async function projects(): Promise<Project[]> {
  return (await db).getAll("projects");
}
export async function saveProject(p: Project) {
  return (await db).put("projects", p);
}
export async function pages(project: string): Promise<Page[]> {
  return (await db)
    .getAllFromIndex("pages", "project", project)
    .then((p) => p.sort((a, b) => a.order - b.order));
}
export async function savePages(
  items: Page[],
  original?: { id: string; image: Blob },
) {
  const tx = (await db).transaction(
    ["pages", "originals", "images"],
    "readwrite",
  );
  if (original) await tx.objectStore("originals").put(original);
  for (const p of items) {
    if (p.image.size)
      await tx.objectStore("images").put({ id: p.id, image: p.image });
    await tx.objectStore("pages").put({
      ...p,
      imageBytes: p.image.size || p.imageBytes || 0,
      originalBytes: original?.image.size || p.originalBytes || 0,
      originalMime: original?.image.type || p.originalMime || "image/jpeg",
      image: new Blob([]),
    });
  }
  await tx.done;
}
export async function image(id: string): Promise<Blob> {
  const v = await (await db).get("images", id);
  if (!v) throw Error("보정 이미지를 찾을 수 없습니다.");
  return v.image;
}
export async function loadPage(p: Page): Promise<Page> {
  return { ...p, image: await image(p.id) };
}
export async function original(id: string): Promise<Blob> {
  const v = await (await db).get("originals", id);
  if (!v) throw Error("원본을 찾을 수 없습니다.");
  return v.image;
}
export async function deletePage(p: Page) {
  const database = await db;
  const tx = database.transaction(
    ["pages", "originals", "images"],
    "readwrite",
  );
  await tx.objectStore("pages").delete(p.id);
  await tx.objectStore("images").delete(p.id);
  const all = await tx.objectStore("pages").getAll();
  if (!all.some((x) => x.originalId === p.originalId))
    await tx.objectStore("originals").delete(p.originalId);
  await tx.done;
}
export async function reorder(items: Page[]) {
  await savePages(items.map((p, i) => ({ ...p, order: i + 1 })));
}

export async function stageCapture(
  project: string,
  image: Blob,
  quad: any,
  hash: number[],
) {
  const id = crypto.randomUUID();
  await (
    await db
  ).put("originals", { id, image, quad, hash, pendingProject: project });
  return id;
}
export async function pendingIds(project: string) {
  return (await db).getAllKeysFromIndex(
    "originals",
    "pendingProject",
    project,
  ) as Promise<string[]>;
}
export async function pendingCapture(id: string) {
  return (await db).get("originals", id);
}
