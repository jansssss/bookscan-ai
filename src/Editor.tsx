import { useEffect, useRef, useState } from "react";
import type { Quad, Mode } from "./types";
import { fullQuad } from "./types";
import { validQuad } from "./geometry";
import { correct, detect } from "./vision";
export const modeNames: Record<Mode, string> = {
  original: "컬러 원본",
  color: "보정 컬러",
  gray: "그레이",
  bw: "흑백 문서",
};
export default function Editor({
  blob,
  initial,
  mode,
  onSave,
  onClose,
}: {
  blob: Blob;
  initial: Quad | null;
  mode: Mode;
  onSave: (q: Quad, m: Mode) => Promise<void>;
  onClose: () => void;
}) {
  const [quad, setQuad] = useState<Quad>(
      initial ||
        (fullQuad.map((p) => ({
          x: 0.05 + 0.9 * p.x,
          y: 0.05 + 0.9 * p.y,
        })) as Quad),
    ),
    [selected, setSelected] = useState(mode),
    [url, setUrl] = useState(""),
    [preview, setPreview] = useState<Blob | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const drag = useRef<number | null>(null),
    stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const u = URL.createObjectURL(preview || blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob, preview]);
  async function apply() {
    setBusy(true);
    try {
      if (!validQuad(quad))
        throw Error("모서리가 교차하거나 영역이 너무 작습니다.");
      setPreview(await correct(blob, quad, selected));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-title">
        <div>
          <span className="eyebrow">PAGE EDITOR</span>
          <h2>모서리 보정</h2>
        </div>
        <button onClick={onClose}>닫기</button>
      </div>
      <p>
        자동으로 모서리를 다시 찾거나 필요한 점만 수정하세요. 원본은 보존됩니다.
      </p>
      <div
        className="edit-stage"
        ref={stage}
        onPointerMove={(e) => {
          if (drag.current === null || preview) return;
          const r = stage.current!.getBoundingClientRect();
          setQuad(
            (q) =>
              q.map((p, i) =>
                i === drag.current
                  ? {
                      x: Math.max(
                        0,
                        Math.min(1, (e.clientX - r.left) / r.width),
                      ),
                      y: Math.max(
                        0,
                        Math.min(1, (e.clientY - r.top) / r.height),
                      ),
                    }
                  : p,
              ) as Quad,
          );
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <img src={url} alt="보정할 원본 페이지" />
        {!preview && (
          <svg viewBox="0 0 1 1" preserveAspectRatio="none">
            <polygon points={quad.map((p) => `${p.x},${p.y}`).join(" ")} />
            {quad.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r=".025"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drag.current = i;
                }}
              />
            ))}
          </svg>
        )}
      </div>
      <div className="segmented">
        {Object.entries(modeNames).map(([m, label]) => (
          <button
            key={m}
            className={selected === m ? "selected" : ""}
            onClick={() => {
              setSelected(m as Mode);
              setPreview(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const bitmap = await createImageBitmap(blob);
              const canvas = document.createElement("canvas");
              canvas.width = 960;
              canvas.height = Math.round((960 * bitmap.height) / bitmap.width);
              canvas
                .getContext("2d")!
                .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
              bitmap.close();
              const found = await detect(canvas);
              if (!found.quad)
                throw Error(
                  "영역을 찾기 어렵습니다. 원본 전체를 저장하거나 필요한 점만 수정하세요.",
                );
              setQuad(found.quad);
              setPreview(null);
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          모서리 자동 찾기
        </button>
        <button
          disabled={busy}
          onClick={() => (preview ? setPreview(null) : apply())}
        >
          {preview ? "모서리 다시 수정" : "보정 미리보기"}
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              if (!validQuad(quad)) throw Error("모서리를 확인해주세요.");
              await onSave(quad, selected);
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "처리 중…" : "보정 후 저장"}
        </button>
      </div>
    </section>
  );
}
