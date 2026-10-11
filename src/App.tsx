import { useEffect, useRef, useState } from "react";
import type { Page, Project, Quad, Mode } from "./types";
import { defaults, fullQuad } from "./types";
import * as db from "./storage";
import { correct, thumbnail, spine, dewarp } from "./vision";
import { mapFromRect } from "./geometry";
import Camera from "./Camera";
import Editor from "./Editor";
import { recognize, orientation } from "./ocr";
import { native, nativeScan } from "./native";
import { metadata, pdf, zip, saveFile, stem } from "./export";
type Editing = {
  blob: Blob;
  quad: Quad | null;
  hash: number[];
  page?: Page;
  existing?: boolean;
  stageId?: string;
};
function BlobImage({ blob, alt }: { blob: Blob; alt: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return <img src={url} alt={alt} loading="lazy" />;
}
export default function App() {
  const [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [pages, setPages] = useState<Page[]>([]),
    [tab, setTab] = useState("documents"),
    [camera, setCamera] = useState(false),
    [editing, setEditing] = useState<Editing | null>(null),
    [current, setCurrent] = useState<Page | null>(null),
    [name, setName] = useState(""),
    [subject, setSubject] = useState("시스템 보안"),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [usage, setUsage] = useState({ usage: 0, quota: 0 }),
    [range, setRange] = useState({ start: 1, end: 50 }),
    [size, setSize] = useState<"a4" | "natural">("a4"),
    [quality, setQuality] = useState(0.85),
    [filename, setFilename] = useState(""),
    [ocrSource, setOcrSource] = useState("corrected"),
    [pdfPreview, setPdfPreview] = useState(""),
    [share, setShare] = useState(false),
    [split, setSplit] = useState<number | null>(null),
    [install, setInstall] = useState<any>(null),
    [prepared, setPrepared] = useState<{ blob: Blob; name: string } | null>(
      null,
    ),
    [pending, setPending] = useState<string[]>([]),
    [curve, setCurve] = useState(0),
    [curvePreview, setCurvePreview] = useState<Blob | null>(null);
  const pagesRef = useRef(pages);
  const projectRef = useRef(project);
  projectRef.current = project;
  useEffect(() => { window.scrollTo(0, 0); }, [project?.id, current?.id, tab, editing]);
  pagesRef.current = pages;
  const input = useRef<HTMLInputElement>(null);
  const retake = useRef<Page | null>(null);
  const captureQueue = useRef(Promise.resolve());
  const [queued, setQueued] = useState(0);
  async function refresh(p = project, background = false) {
    if (p) {
      const saved = await db.pages(p.id);
      if (!background || projectRef.current?.id === p.id) {
        pagesRef.current = saved;
        setPages(saved);
        setPending(await db.pendingIds(p.id));
      }
    }
    setProjects(await db.projects());
    const e = await navigator.storage?.estimate();
    setUsage({ usage: e?.usage || 0, quota: e?.quota || 0 });
  }
  useEffect(() => {
    refresh(null).catch((e) => setError(String(e)));
    const storageBlocked = () =>
      setError(
        "저장소 갱신을 위해 다른 BookScan 탭을 닫거나 새로고침해주세요.",
      );
    window.addEventListener("bookscan-storage-blocked", storageBlocked);
    const listener = (e: Event) => {
      e.preventDefault();
      setInstall(e);
    };
    window.addEventListener("beforeinstallprompt", listener);
    return () => {
      window.removeEventListener("beforeinstallprompt", listener);
      window.removeEventListener("bookscan-storage-blocked", storageBlocked);
    };
  }, []);
  useEffect(
    () => () => {
      if (pdfPreview) URL.revokeObjectURL(pdfPreview);
    },
    [pdfPreview],
  );
  async function task(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("작업 실패 · 기존 원본과 저장된 페이지는 유지됩니다.");
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    if (!name.trim()) {
      setError("교재 이름을 입력해주세요.");
      return;
    }
    await task(async () => {
      const p: Project = {
        id: crypto.randomUUID(),
        name: name.trim(),
        subject,
        created: new Date().toISOString(),
        settings: { ...defaults },
      };
      await db.saveProject(p);
      setProject(p);
      setPages([]);
      setFilename(p.name);
      setName("");
      await refresh(p);
    });
  }
  async function settings(s: Project["settings"]) {
    if (!project) return;
    const p = { ...project, settings: s };
    try {
      await db.saveProject(p);
      setProject(p);
    } catch (e) {
      setError(String(e));
    }
  }
  async function add(
    blob: Blob,
    q: Quad,
    hash: number[],
    mode: Mode,
    replace?: Page,
    division?: number,
    stageId?: string,
    target = project,
    needsReview = false,
  ) {
    if (!target) return;
    const originalId =
        stageId || (await db.stageCapture(target.id, blob, q, hash)),
      date = new Date().toISOString();
    const regions: Quad[] =
      division !== undefined
        ? [
            [
              { x: 0, y: 0 },
              { x: division, y: 0 },
              { x: division, y: 1 },
              { x: 0, y: 1 },
            ],
            [
              { x: division, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
              { x: division, y: 1 },
            ],
          ]
        : [q];
    const source =
      division !== undefined ? await correct(blob, q, "original", 0.97) : blob;
    const start =
      replace?.order ||
      Math.max(0, ...(await db.pages(target.id)).map((p) => p.order)) + 1;
    const items: Page[] = [];
    for (let i = 0; i < regions.length; i++) {
      setStatus(`${i + 1}/${regions.length} 페이지 보정 중`);
      const image = await correct(
        source,
        regions[i],
        mode,
        target.settings.quality,
      );
      let savedQuad = regions[i];
      if (division !== undefined) {
        savedQuad = regions[i].map((p) => mapFromRect(q, p.x, p.y)) as Quad;
      }
      items.push({
        id: replace?.id || crypto.randomUUID(),
        project: target.id,
        originalId,
        order: start + i,
        image,
        thumb: await thumbnail(image),
        quad: savedQuad,
        mode,
        date,
        hash,
        text: "",
        confidence: null,
        words: [],
        needsReview,
      });
    }
    await db.savePages(items, { id: originalId, image: blob });
    setStatus(`${items.length}페이지가 기기에 저장되었습니다.`);
    await refresh(target, true);
  }
  async function photo(blob: Blob, q: Quad | null, hash: number[]) {
    setError("");
    const stageId = await db.stageCapture(project!.id, blob, q, hash);
    const replace = retake.current;
    retake.current = null;
    if (replace) {
      setCamera(false);
      setEditing({ blob, quad: q, hash, page: replace, stageId });
      return;
    }
    const target = project!;
    setQueued((n) => n + 1);
    captureQueue.current = captureQueue.current.then(async () => {
      try {
        let division: number | undefined;
        if (target.settings.spread && q) {
          const flat = await correct(blob, q, "original", 0.94);
          const found = await spine(flat);
          if (found.confident) division = found.position;
        }
        await add(
          blob,
          q || fullQuad,
          hash,
          target.settings.mode,
          undefined,
          division,
          stageId,
          target,
          !q || (target.settings.spread && division === undefined),
        );
      } catch (e) {
        setError("보정 실패 · 원본은 보관되었습니다: " + String(e));
        await refresh(target, true).catch(() => {});
      } finally {
        setQueued((n) => n - 1);
      }
    });
  }
  async function startCapture() {
    if (!project || busy) return;
    if (!native()) {
      setCamera(true);
      return;
    }
    const target = project;
    const replace = retake.current;
    retake.current = null;
    await task(async () => {
      setStatus("Google 스캐너 준비 중…");
      const urls = await nativeScan(replace ? 1 : 50);
      if (!urls.length) {
        setStatus("");
        return;
      }
      let order =
        Math.max(0, ...(await db.pages(target.id)).map((p) => p.order)) + 1;
      for (let i = 0; i < urls.length; i++) {
        setStatus(`${i + 1}/${urls.length}장 보관 중…`);
        const result = await fetch(urls[i]);
        if (!result.ok) throw Error("스캔 결과를 읽을 수 없습니다.");
        const image = await result.blob();
        const originalId = await db.stageCapture(
          target.id,
          image,
          fullQuad,
          [],
        );
        const page: Page = {
          id: replace?.id || crypto.randomUUID(),
          project: target.id,
          originalId,
          order: replace?.order || order++,
          image,
          thumb: await thumbnail(image),
          quad: fullQuad,
          mode: "original",
          date: new Date().toISOString(),
          hash: [],
          text: "",
          confidence: null,
          words: [],
          captureSource: "mlkit",
        };
        await db.savePages([page], { id: originalId, image });
        native()!.releaseScan(urls[i].split("/").pop()!);
        setProgress((i + 1) / urls.length);
        if (replace) setCurrent(page);
      }
      await refresh(target);
      setStatus(`${urls.length}장 저장 완료`);
    });
  }
  async function commit(q: Quad, m: Mode) {
    if (!editing) return;
    if (project?.settings.spread && !editing.page) {
      const flat = await correct(editing.blob, q, "original", 0.96);
      const detected = await spine(flat);
      const division = split ?? detected.position;
      if (split === null) {
        setSplit(division);
        setStatus(
          detected.confident
            ? "책등 후보를 찾았습니다. 분리 위치를 확인하고 다시 저장하세요."
            : "책등 자동 검출이 불확실합니다. 분리 위치를 직접 확인해주세요.",
        );
        return;
      }
      await add(
        editing.blob,
        q,
        editing.hash,
        m,
        undefined,
        division,
        editing.stageId,
      );
    } else if (editing.page) {
      const image = await correct(editing.blob, q, m);
      if (editing.existing) {
        await db.savePages([
          {
            ...editing.page,
            image,
            thumb: await thumbnail(image),
            quad: q,
            needsReview: false,
            mode: m,
            text: "",
            confidence: null,
            words: [],
          },
        ]);
      } else {
        await add(
          editing.blob,
          q,
          editing.hash,
          m,
          editing.page,
          undefined,
          editing.stageId,
        );
      }
      await refresh();
    } else
      await add(
        editing.blob,
        q,
        editing.hash,
        m,
        undefined,
        undefined,
        editing.stageId,
      );
    setEditing(null);
    setSplit(null);
    await refresh();
  }
  async function edit(p: Page) {
    await task(async () => {
      setEditing({
        blob: await db.original(p.originalId),
        quad: p.quad,
        hash: p.hash,
        page: p,
        existing: true,
      });
    });
  }
  async function doOcr() {
    if (!current) return;
    await task(async () => {
      setStatus("한국어·영어 OCR 준비 중…");
      const source =
        ocrSource === "original"
          ? await correct(
              await db.original(current.originalId),
              current.quad,
              "original",
            )
          : current.image;
      const r = await recognize(source, setProgress);
      const p = { ...current, ...r };
      await db.savePages([p]);
      setCurrent(p);
      await refresh();
      setStatus("OCR 완료 · 낮은 신뢰도 단어를 확인해주세요.");
    });
  }
  async function move(index: number, delta: number) {
    await task(async () => {
      const list = [...pages];
      [list[index], list[index + delta]] = [list[index + delta], list[index]];
      await db.reorder(list);
      await refresh();
    });
  }
  async function exportAs(type: string) {
    if (!project) return;
    await task(async () => {
      const selected = pages.filter(
        (p) => p.order >= range.start && p.order <= range.end,
      );
      if (!selected.length) throw Error("내보낼 페이지가 없습니다.");
      if ((type === "pdf" || type === "zip") && selected.length > 50)
        throw Error("PDF·ZIP은 한 번에 50페이지까지 선택해주세요.");
      const budget = selected.reduce(
        (sum, p) =>
          sum +
          (p.imageBytes || 0) +
          (type === "zip" ? p.originalBytes || 0 : 0),
        0,
      );
      if ((type === "pdf" || type === "zip") && budget > 120 * 1024 * 1024)
        throw Error(
          "선택 이미지가 120MB를 넘습니다. 페이지 범위를 줄여 내보내주세요.",
        );
      const file = stem(filename || project.name);
      setStatus("파일을 생성하고 있습니다…");
      let blob: Blob,
        extension = type;
      if (type === "pdf")
        blob = await pdf(selected, size, quality, setProgress);
      else if (type === "txt")
        blob = new Blob(
          [
            selected
              .map((p) => `=== ${p.order}페이지 ===\n${p.text}`)
              .join("\n\n"),
          ],
          { type: "text/plain;charset=utf-8" },
        );
      else if (type === "json")
        blob = new Blob(
          [JSON.stringify(metadata(project, selected), null, 2)],
          { type: "application/json" },
        );
      else if (type === "jpg") {
        if (selected.length !== 1)
          throw Error("JPG는 페이지 한 개를 선택해주세요.");
        blob = await db.image(selected[0].id);
        extension = "jpg";
      } else
        blob = await zip(
          project,
          selected,
          await pdf(selected, size, quality, setProgress),
          setProgress,
        );
      if (type === "pdf") {
        setPdfPreview(URL.createObjectURL(blob));
      }
      const outputName = `${file}_${String(range.start).padStart(3, "0")}-${String(Math.min(range.end, selected.at(-1)!.order)).padStart(3, "0")}.${extension}`;
      setPrepared({ blob, name: outputName });
      if (!share) await saveFile(blob, outputName);
      setStatus(
        share
          ? "파일 생성 완료 · 아래 공유 버튼을 눌러 저장하세요."
          : "파일 생성 완료 · 다운로드 결과를 확인해주세요.",
      );
    });
  }
  async function offline() {
    await task(async () => {
      if (!navigator.serviceWorker)
        throw Error("서비스 워커를 지원하지 않습니다.");
      if (!import.meta.env.PROD)
        throw Error(
          "오프라인 준비는 프로덕션 빌드 또는 배포 사이트에서 지원됩니다.",
        );
      setStatus("오프라인 OCR 모델과 이미지 엔진 다운로드 중…");
      const reg = await navigator.serviceWorker.ready;
      const paths = [
        "opencv.js",
        "worker.min.js",
        "kor.traineddata.gz",
        "eng.traineddata.gz",
        "osd.traineddata.gz",
        ...["", "-simd", "-lstm", "-simd-lstm"].flatMap((s) => [
          `tesseract-core${s}.wasm.js`,
          `tesseract-core${s}.wasm`,
        ]),
      ].map(
        (p) =>
          new URL(
            "vendor/" + p,
            new URL(import.meta.env.BASE_URL, location.href),
          ).href,
      );
      await new Promise<void>((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(
          () => reject(Error("오프라인 준비 시간 초과. 다시 시도해주세요.")),
          180000,
        );
        channel.port1.onmessage = (e) => {
          clearTimeout(timer);
          e.data.ok ? resolve() : reject(Error(e.data.error));
        };
        reg.active!.postMessage({ type: "CACHE_ASSETS", paths }, [
          channel.port2,
        ]);
      });
      setStatus("오프라인 이미지 처리·OCR 모델 준비 완료");
    });
  }
  if (camera && project)
    return (
      <>
        <Camera
          queued={queued}
          settings={project.settings}
          next={
            retake.current?.order ||
            Math.max(0, ...pages.map((p) => p.order)) + queued + 1
          }
          onPhoto={photo}
          onClose={() => {
            setCamera(false);
            retake.current = null;
          }}
          onSettings={settings}
        />
      </>
    );
  return (
    <div className={native() ? "app android-app" : "app"}>
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setProject(null);
            setPages([]);
            setCurrent(null);
          }}
        >
          <img src="./icon.svg" alt="" />
          <span>
            BookScan <b>AI</b>
          </span>
        </a>
        <span className="local-badge">
          <i /> 기기 안에서만 처리
        </span>
      </header>
      <main>
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError("")}>닫기</button>
          </div>
        )}
        {status && (
          <div className="status" role="status">
            {status}
            {busy && <progress value={progress} max={1} />}
          </div>
        )}
        {editing ? (
          <>
            <Editor
              blob={editing.blob}
              initial={editing.quad}
              mode={project!.settings.mode}
              onSave={commit}
              onClose={() => {
                setEditing(null);
                setSplit(null);
                refresh().catch((e) => setError(String(e)));
              }}
            />
            {project?.settings.spread && !editing.page && (
              <div className="panel">
                <label>
                  좌우 분리 위치 {(100 * (split ?? 0.5)).toFixed(0)}%
                  <input
                    type="range"
                    min=".25"
                    max=".75"
                    step=".005"
                    value={split ?? 0.5}
                    onChange={(e) => setSplit(+e.target.value)}
                  />
                </label>
                <p>
                  {status ||
                    "저장 시 책등 후보를 계산합니다. 위치를 확인한 후 저장하세요."}
                </p>
              </div>
            )}
          </>
        ) : tab === "settings" ? (
          <section className="panel">
            <span className="eyebrow">ON YOUR DEVICE</span>
            <h1>설정과 저장공간</h1>
            <h3>기기 저장공간</h3>
            <p>
              {(usage.usage / 1024 / 1024).toFixed(1)} MB 사용 /{" "}
              {(usage.quota / 1024 / 1024 / 1024).toFixed(1)} GB 할당
            </p>
            <progress max={usage.quota || 1} value={usage.usage} />
            <div className="actions">
              <button
                onClick={() =>
                  task(async () => {
                    const ok = await navigator.storage?.persist?.();
                    setStatus(
                      ok
                        ? "영구 저장 권한이 허용되었습니다."
                        : "영구 저장이 허용되지 않았습니다. 내보내기로 별도 보관하세요.",
                    );
                  })
                }
              >
                영구 저장 요청
              </button>
              <button disabled={busy} onClick={offline}>
                오프라인 준비
              </button>
            </div>
            <p>
              브라우저 데이터 삭제와 저장공간 회수에 대비해 PDF·ZIP을 별도로
              보관하세요.
            </p>
            {install ? (
              <button
                className="primary"
                onClick={async () => {
                  await install.prompt();
                  setInstall(null);
                }}
              >
                홈 화면에 설치
              </button>
            ) : (
              <p>
                Android: 브라우저 메뉴 → 앱 설치
                <br />
                iPhone: Safari 공유 → 홈 화면에 추가
              </p>
            )}
            {project && (
              <>
                <h3>촬영 설정</h3>
                <label>
                  자동 촬영 대기 시간{" "}
                  <select
                    value={project.settings.delay}
                    onChange={(e) =>
                      settings({ ...project.settings, delay: +e.target.value })
                    }
                  >
                    <option value={700}>0.7초</option>
                    <option value={900}>0.9초</option>
                    <option value={1200}>1.2초</option>
                    <option value={1800}>1.8초</option>
                  </select>
                </label>
                <label>
                  감지 민감도
                  <select
                    value={project.settings.sensitivity}
                    onChange={(e) =>
                      settings({
                        ...project.settings,
                        sensitivity: +e.target.value,
                      })
                    }
                  >
                    <option value={0.7}>엄격</option>
                    <option value={1}>표준</option>
                    <option value={1.4}>민감</option>
                  </select>
                </label>
                <label>
                  저장 모드
                  <select
                    value={project.settings.mode}
                    onChange={(e) =>
                      settings({
                        ...project.settings,
                        mode: e.target.value as Mode,
                      })
                    }
                  >
                    <option value="original">컬러 원본</option>
                    <option value="color">보정 컬러</option>
                    <option value="gray">그레이스케일</option>
                    <option value="bw">흑백 문서</option>
                  </select>
                </label>
                <label>
                  이미지 품질
                  <input
                    type="range"
                    min=".6"
                    max=".98"
                    step=".01"
                    value={project.settings.quality}
                    onChange={(e) =>
                      settings({
                        ...project.settings,
                        quality: +e.target.value,
                      })
                    }
                  />
                </label>
              </>
            )}
            <div className="notice">
              <strong>곡면 보정: 실험적 수동 보정</strong>
              <p>
                원근 보정과 책등 분리는 구현되어 있습니다. 수동 곡면 보정은
                지정한 휘어짐만 펼칩니다. 텍스트 행 분석과 곡률 자동 추정은
                미구현입니다. 책을 평평하게 펴거나 한 페이지씩 촬영해주세요.
              </p>
            </div>
          </section>
        ) : !project ? (
          <>
            <section className="hero">
              <span className="eyebrow">YOUR BOOKS, DIGITIZED.</span>
              <h1>
                한 장씩 담아,
                <br />
                나만의 학습 자료로.
              </h1>
              <p>
                교재 촬영부터 보정, OCR, PDF까지.
                <br />
                모든 스캔 자료는 이 기기에 보관됩니다.
              </p>
              <div className="book-art" aria-hidden="true">
                <div className="art-page">
                  <span />
                  <span />
                  <span />
                  <span />
                  <b>TCP / IP</b>
                  <span />
                  <span />
                </div>
                <div className="art-page">
                  <span />
                  <span />
                  <span />
                  <div className="art-diagram">
                    ↔<br />▢ — ▢
                  </div>
                  <span />
                  <span />
                </div>
                <div className="scan-corner tl" />
                <div className="scan-corner tr" />
                <div className="scan-corner bl" />
                <div className="scan-corner br" />
              </div>
              <span className="hero-tag">LOCAL · PRIVATE · OFFLINE</span>
            </section>
            <section className="panel new-project">
              <div className="section-title">
                <h2>새 교재 스캔</h2>
                <span className="step">01 / 시작하기</span>
              </div>
              <label>
                교재 이름
                <input
                  placeholder="예: 정보보안기사 필기"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                과목
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy} onClick={create}>
                프로젝트 만들기 <span>↗</span>
              </button>
            </section>
            <section>
              <div className="section-title">
                <h2>내 스캔 문서</h2>
                <span>{projects.length}권</span>
              </div>
              {projects.length ? (
                <div className="project-list">
                  {projects.map((p, i) => (
                    <button
                      className="project-card"
                      key={p.id}
                      onClick={() =>
                        task(async () => {
                          setProject(p);
                          setCurrent(null);
                          setFilename(p.name);
                          setTab("documents");
                          await refresh(p);
                        })
                      }
                    >
                      <span className="book-icon">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>
                        <strong>{p.name}</strong>
                        <small>
                          {p.subject} ·{" "}
                          {new Date(p.created).toLocaleDateString("ko-KR")}
                        </small>
                      </span>
                      <span>↗</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <span>▤</span>
                  <h3>첫 번째 교재를 담아보세요</h3>
                  <p>새 프로젝트를 만들면 언제든 이어서 촬영할 수 있어요.</p>
                </div>
              )}
            </section>
            <div className="privacy">
              <span>◈</span>
              <p>
                로그인 없이, 업로드 없이.
                <br />
                <small>
                  사진·OCR 텍스트는 외부 서버로 자동 전송되지 않습니다.
                </small>
              </p>
            </div>
          </>
        ) : tab === "export" ? (
          <section className="panel">
            <span className="eyebrow">READY TO STUDY</span>
            <h1>자료 내보내기</h1>
            <p>
              {project.name} · {pages.length}페이지
              <br />
              PDF·ZIP은 최대 50페이지씩 생성합니다.
            </p>
            <label>
              파일 이름
              <input
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
              />
            </label>
            <div className="range">
              <label>
                시작 페이지
                <input
                  type="number"
                  min={1}
                  value={range.start}
                  onChange={(e) =>
                    setRange({ ...range, start: +e.target.value })
                  }
                />
              </label>
              <label>
                마지막 페이지
                <input
                  type="number"
                  min={range.start}
                  value={range.end}
                  onChange={(e) => setRange({ ...range, end: +e.target.value })}
                />
              </label>
            </div>
            <label>
              PDF 크기
              <select
                value={size}
                onChange={(e) => setSize(e.target.value as "a4" | "natural")}
              >
                <option value="a4">A4 · 원본 비율 유지</option>
                <option value="natural">이미지 원본 크기</option>
              </select>
            </label>
            <label>
              PDF 이미지 품질 {Math.round(quality * 100)}%
              <input
                type="range"
                min=".5"
                max=".98"
                step=".01"
                value={quality}
                onChange={(e) => setQuality(+e.target.value)}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={share}
                onChange={(e) => setShare(e.target.checked)}
              />{" "}
              시스템 공유로 저장
            </label>
            <div className="export-grid">
              {[
                ["pdf", "PDF 문서"],
                ["txt", "OCR 텍스트"],
                ["json", "학습 메타데이터"],
                ["jpg", "JPG 한 페이지"],
                ["zip", "전체 자료 ZIP"],
              ].map(([key, label]) => (
                <button key={key} disabled={busy} onClick={() => exportAs(key)}>
                  {label} <span>↓</span>
                </button>
              ))}
            </div>
            {prepared && (
              <div className="actions">
                <button
                  onClick={() =>
                    saveFile(prepared.blob, prepared.name).catch((e) =>
                      setError(String(e)),
                    )
                  }
                >
                  생성한 파일 다운로드
                </button>
                <button
                  onClick={() =>
                    saveFile(prepared.blob, prepared.name, true).catch((e) =>
                      setError(String(e)),
                    )
                  }
                >
                  생성한 파일 공유
                </button>
              </div>
            )}
            <details className="notice">
              <summary>ZIP 구성과 PDF 안내</summary>
              <p>
                ZIP에는 PDF, 원본, 보정 이미지, OCR TXT, 연결 정보 JSON이
                포함됩니다. 현재 PDF는 이미지 PDF이며 검색 텍스트는 TXT·JSON으로
                제공합니다.
              </p>
            </details>
            {pdfPreview && (
              <a
                className="primary"
                href={pdfPreview}
                target="_blank"
                rel="noreferrer"
              >
                PDF 미리보기 ↗
              </a>
            )}
          </section>
        ) : current ? (
          <section className="panel page-detail">
            <div className="section-title">
              <h2>{current.order}페이지 · OCR</h2>
              <button
                onClick={() => {
                  setCurrent(null);
                  setCurvePreview(null);
                  setCurve(0);
                }}
              >
                닫기
              </button>
            </div>
            <div className="ocr-image">
              <BlobImage
                blob={curvePreview || current.image}
                alt={`${current.order}페이지 원본 보기`}
              />
            </div>
            {current.captureSource === "mlkit" && (
              <details className="notice">
                <summary>Google 스캔 결과</summary>
                <p>
                  보정된 JPEG를 보관합니다. Google 스캐너는 촬영 전 원본을
                  반환하지 않으므로 원본 영역도 이 JPEG 기준입니다.
                </p>
              </details>
            )}
            <div className="actions">
              <button onClick={() => edit(current)}>모서리 보정</button>
              <button
                disabled={busy}
                onClick={() =>
                  task(async () => {
                    const degrees = await orientation(current.image);
                    if (!degrees) {
                      setStatus("현재 방향이 올바릅니다.");
                      return;
                    }
                    const b = await createImageBitmap(current.image),
                      c = document.createElement("canvas");
                    const odd = degrees % 180 !== 0;
                    c.width = odd ? b.height : b.width;
                    c.height = odd ? b.width : b.height;
                    const ctx = c.getContext("2d")!;
                    ctx.translate(c.width / 2, c.height / 2);
                    ctx.rotate((-degrees * Math.PI) / 180);
                    ctx.drawImage(b, -b.width / 2, -b.height / 2);
                    b.close();
                    const image = await new Promise<Blob>((resolve, reject) =>
                      c.toBlob(
                        (v) => (v ? resolve(v) : reject(Error("회전 실패"))),
                        "image/jpeg",
                        0.95,
                      ),
                    );
                    const p = {
                      ...current,
                      image,
                      thumb: await thumbnail(image),
                      rotation: degrees,
                      text: "",
                      confidence: null,
                      words: [],
                    };
                    await db.savePages([p]);
                    setCurrent(p);
                    await refresh();
                    setStatus("텍스트 방향에 따라 자동 회전했습니다.");
                  })
                }
              >
                자동 회전
              </button>
              <button
                onClick={() =>
                  task(async () => {
                    const bitmap = await createImageBitmap(current.image),
                      c = document.createElement("canvas");
                    c.width = bitmap.height;
                    c.height = bitmap.width;
                    const ctx = c.getContext("2d")!;
                    ctx.translate(c.width, 0);
                    ctx.rotate(Math.PI / 2);
                    ctx.drawImage(bitmap, 0, 0);
                    bitmap.close();
                    const image = await new Promise<Blob>((resolve, reject) =>
                      c.toBlob(
                        (b) => (b ? resolve(b) : reject(Error("회전 실패"))),
                        "image/jpeg",
                        0.95,
                      ),
                    );
                    const p = {
                      ...current,
                      image,
                      thumb: await thumbnail(image),
                      text: "",
                      confidence: null,
                      words: [],
                    };
                    await db.savePages([p]);
                    setCurrent(p);
                    await refresh();
                  })
                }
              >
                90° 회전
              </button>
              <button
                onClick={() => {
                  retake.current = current;
                  startCapture();
                }}
              >
                재촬영
              </button>
            </div>
            <details className="notice">
              <summary>실험적 수동 곡면 보정</summary>
              <p>
                상하로 휘어진 문서의 보간 변형입니다. 곡률을 자동 추정하지
                않습니다. 글자가 손상되면 적용하지 마세요.
              </p>
              <label>
                휘어짐 조절
                <input
                  type="range"
                  min="-.12"
                  max=".12"
                  step=".005"
                  value={curve}
                  onChange={(e) => {
                    setCurve(+e.target.value);
                    setCurvePreview(null);
                  }}
                />
              </label>
              <div className="actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    task(async () =>
                      setCurvePreview(await dewarp(current.image, curve)),
                    )
                  }
                >
                  곡면 미리보기
                </button>
                <button
                  disabled={busy || !curvePreview}
                  onClick={() =>
                    task(async () => {
                      const image = curvePreview!;
                      const p = {
                        ...current,
                        image,
                        thumb: await thumbnail(image),
                        dewarp: curve,
                        text: "",
                        confidence: null,
                        words: [],
                      };
                      await db.savePages([p]);
                      setCurrent(p);
                      setCurvePreview(null);
                      await refresh();
                    })
                  }
                >
                  확인 후 적용
                </button>
                <button onClick={() => setCurvePreview(null)}>
                  미리보기 취소
                </button>
              </div>
            </details>
            <label>
              OCR 입력 이미지
              <select
                value={ocrSource}
                onChange={(e) => setOcrSource(e.target.value)}
              >
                <option value="corrected">보정 이미지</option>
                <option value="original">원본 영역</option>
              </select>
            </label>
            <button className="primary" disabled={busy} onClick={doOcr}>
              한국어 + 영어 OCR 실행
            </button>
            <p>
              신뢰도{" "}
              {current.confidence === null
                ? "미인식"
                : current.confidence.toFixed(1) + "%"}{" "}
              · 수정 전 각 입력 결과를 확인하세요.
            </p>
            <div className="low-words">
              {current.words
                .filter((w) => w.confidence < 65)
                .map((w, i) => (
                  <span
                    key={i}
                    title={`${w.confidence.toFixed(0)}% · (${w.bbox.x0}, ${w.bbox.y0})`}
                  >
                    {w.text}
                  </span>
                ))}
            </div>
            <label>
              인식 결과 직접 수정
              <textarea
                rows={5}
                value={current.text}
                onChange={(e) =>
                  setCurrent({ ...current, text: e.target.value })
                }
              />
            </label>
            <button
              disabled={busy}
              onClick={() =>
                task(async () => {
                  await db.savePages([current]);
                  await refresh();
                  setStatus("수정한 OCR 텍스트 저장 완료");
                })
              }
            >
              텍스트 저장
            </button>
            <p>
              표·그림·수식은 인식 오류가 있을 수 있습니다. 원본을 함께
              확인해주세요.
            </p>
          </section>
        ) : (
          <>
            <section className="project-header">
              <button
                className="back"
                onClick={() => {
                  setProject(null);
                  setPages([]);
                }}
              >
                ← 내 문서
              </button>
              <span className="eyebrow">{project.subject}</span>
              <h1>{project.name}</h1>
              <p>
                {pages.length}페이지 보관 중 · 다음{" "}
                {Math.max(0, ...pages.map((p) => p.order)) + 1}페이지
              </p>
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={startCapture}
                >
                  ◉ 촬영 시작
                </button>
                <button disabled={busy} onClick={() => input.current?.click()}>
                  사진 가져오기
                </button>
              </div>
              <input
                type="file"
                ref={input}
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setEditing({ blob: file, quad: null, hash: [] });
                    setSplit(null);
                  }
                  e.target.value = "";
                }}
              />
              <div className="segmented" hidden={!!native()}>
                <button
                  className={!project.settings.spread ? "selected" : ""}
                  onClick={() =>
                    settings({ ...project.settings, spread: false })
                  }
                >
                  한 페이지
                </button>
                <button
                  className={project.settings.spread ? "selected" : ""}
                  onClick={() =>
                    settings({ ...project.settings, spread: true })
                  }
                >
                  펼친 두 페이지
                </button>
              </div>
            </section>
            {pending.length > 0 && (
              <div className="notice">
                <p>중단된 촬영 원본 {pending.length}개가 보관되어 있습니다.</p>
                <button
                  onClick={() =>
                    task(async () => {
                      const p = await db.pendingCapture(pending[0]);
                      setEditing({
                        blob: p.image,
                        quad: p.quad,
                        hash: p.hash,
                        stageId: p.id,
                      });
                    })
                  }
                >
                  미완료 촬영 복구
                </button>
              </div>
            )}
            <div className="section-title">
              <h2>스캔한 페이지</h2>
              <button
                onClick={() => {
                  setRange({
                    start: 1,
                    end: Math.min(
                      50,
                      Math.max(1, ...pages.map((p) => p.order)),
                    ),
                  });
                  setTab("export");
                }}
                disabled={!pages.length}
              >
                내보내기 ↗
              </button>
            </div>
            {pages.length ? (
              <div className="page-grid">
                {pages.map((p, i) => (
                  <article className="page-card" key={p.id}>
                    <button
                      className="page-thumb"
                      onClick={() =>
                        task(async () => setCurrent(await db.loadPage(p)))
                      }
                    >
                      <BlobImage blob={p.thumb} alt={`${p.order}페이지 확인`} />
                      <span>
                        {String(p.order).padStart(3, "0")}
                        {p.needsReview ? " · 영역 확인" : ""}
                      </span>
                    </button>
                    <div className="page-meta">
                      <span>
                        {p.confidence === null
                          ? "OCR 대기"
                          : "OCR " + p.confidence.toFixed(0) + "%"}
                      </span>
                      <div>
                        <button
                          aria-label={`${p.order}페이지 앞으로 이동`}
                          disabled={i === 0 || busy}
                          onClick={() => move(i, -1)}
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`${p.order}페이지 뒤로 이동`}
                          disabled={i === pages.length - 1 || busy}
                          onClick={() => move(i, 1)}
                        >
                          ↓
                        </button>
                        <button
                          aria-label={`${p.order}페이지 삭제`}
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `${p.order}페이지를 삭제하시겠습니까?`,
                              )
                            )
                              task(async () => {
                                await db.deletePage(p);
                                await refresh();
                              });
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty">
                <span>⌑</span>
                <h3>스캔할 준비가 되었어요</h3>
                <p>촬영을 시작하거나 기존 사진을 가져오세요.</p>
              </div>
            )}
            <p className="footnote">
              촬영 후 기기에 즉시 저장됩니다. 작업을 중단해도 이 프로젝트에서
              이어갈 수 있어요.
            </p>
          </>
        )}
      </main>
      <nav className="bottom-nav">
        <button
          className={tab === "documents" ? "active" : ""}
          onClick={() => setTab("documents")}
        >
          <span>▤</span>내 문서
        </button>
        <button disabled={!project || busy} onClick={startCapture}>
          <span>⊙</span>촬영
        </button>
        <button
          className={tab === "export" ? "active" : ""}
          disabled={!project}
          onClick={() => setTab("export")}
        >
          <span>↥</span>내보내기
        </button>
        <button
          className={tab === "settings" ? "active" : ""}
          onClick={() => setTab("settings")}
        >
          <span>⚙</span>설정
        </button>
      </nav>
    </div>
  );
}
