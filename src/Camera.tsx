import { useEffect, useRef, useState } from "react";
import { AutoGate } from "./geometry";
import { detect } from "./vision";
import type { Quad, Settings, Detection } from "./types";
type Props = {
  settings: Settings;
  next: number;
  queued: number;
  onPhoto: (blob: Blob, quad: Quad | null, hash: number[]) => Promise<void>;
  onClose: () => void;
  onSettings: (s: Settings) => void;
};
export default function Camera({
  settings,
  next,
  queued,
  onPhoto,
  onClose,
  onSettings,
}: Props) {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    gate = useRef(new AutoGate()),
    latest = useRef<Detection | null>(null),
    lock = useRef(false),
    props = useRef({ settings, onPhoto, queued });
  props.current = { settings, onPhoto, queued };
  const [device, setDevice] = useState("environment"),
    [error, setError] = useState(""),
    [state, setState] = useState({ stable: false, progress: 0, bad: false }),
    [quad, setQuad] = useState<Quad | null>(null),
    [message, setMessage] = useState("카메라를 준비하고 있습니다"),
    [busy, setBusy] = useState(false),
    [caps, setCaps] = useState<any>({}),
    [torch, setTorch] = useState(false),
    [zoom, setZoom] = useState(1),
    [ratio, setRatio] = useState(4 / 3);
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw Error("카메라는 HTTPS 또는 localhost에서 사용할 수 있습니다.");
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: device },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
          audio: false,
        });
        if (!active) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        video.current!.srcObject = s;
        await video.current!.play();
        setRatio(video.current!.videoWidth / video.current!.videoHeight);
        const track = s.getVideoTracks()[0];
        setCaps(track.getCapabilities?.() || {});
        const capabilities = track.getCapabilities() as any;
        if (capabilities.focusMode?.includes("continuous"))
          await track
            .applyConstraints({
              advanced: [{ focusMode: "continuous" } as any],
            })
            .catch(() => {});
        setMessage("페이지 전체가 보이게 러프하게 맞춰주세요");
        async function tick() {
          if (!active) return;
          try {
            const v = video.current;
            if (v?.videoWidth && !lock.current) {
              const c = document.createElement("canvas");
              c.width = 480;
              c.height = Math.round((480 * v.videoHeight) / v.videoWidth);
              c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
              const d = await detect(c);
              if (!active) return;
              latest.current = d;
              setQuad(d.quad);
              const evaluation = gate.current.update(
                d,
                performance.now(),
                props.current.settings.delay,
                props.current.settings.sensitivity,
                props.current.settings.auto && props.current.queued < 5,
              );
              setState({
                ...evaluation,
                bad:
                  d.sharpness < 55 / props.current.settings.sensitivity ||
                  d.brightness < 45 ||
                  d.clipped > 0.4,
              });
              setMessage(
                !d.quad
                  ? "문서를 찾는 중 · 실패하면 수동 촬영"
                  : d.brightness < 45
                    ? "주변이 어두워요"
                    : d.clipped > 0.4
                      ? "노출을 조절해주세요"
                      : d.sharpness < 55 / props.current.settings.sensitivity
                        ? "초점이 흐려요 · 잠시 기다려주세요"
                        : evaluation.stable
                          ? "좋아요 · 움직이지 마세요"
                          : "흔들림 감지 · 카메라를 고정해주세요",
              );
              if (
                evaluation.shoot &&
                props.current.settings.auto &&
                props.current.queued < 5
              )
                await capture();
            }
          } catch (e) {
            if (active) {
              setError(String(e));
            }
          } finally {
            if (active) timer = setTimeout(tick, 180);
          }
        }
        timer = setTimeout(tick, 200);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    start();
    return () => {
      active = false;
      clearTimeout(timer);
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      gate.current.reset();
    };
  }, [device]);
  async function capture() {
    if (lock.current || props.current.queued >= 5 || !video.current?.videoWidth)
      return;
    lock.current = true;
    setBusy(true);
    try {
      const v = video.current,
        track = stream.current!.getVideoTracks()[0];
      let blob: Blob | undefined;
      let q = latest.current?.quad || null;
      const hash = latest.current?.hash || [];
      const ImageCaptureClass = (window as any).ImageCapture;
      if (ImageCaptureClass) {
        try {
          blob = await new ImageCaptureClass(track).takePhoto();
          const b = await createImageBitmap(blob!);
          const ratio = b.width / b.height,
            preview = v.videoWidth / v.videoHeight;
          const c = document.createElement("canvas");
          c.width = 480;
          c.height = Math.round(480 / ratio);
          c.getContext("2d")!.drawImage(b, 0, 0, c.width, c.height);
          b.close();
          q = (await detect(c)).quad;
          if (Math.abs(ratio - preview) / preview > 0.03) {
            setMessage("고해상도 사진의 모서리를 자동으로 확인했습니다.");
          }
        } catch {}
      }
      if (!blob) {
        const c = document.createElement("canvas");
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        c.getContext("2d")!.drawImage(v, 0, 0);
        blob = await new Promise<Blob>((resolve, reject) =>
          c.toBlob(
            (b) => (b ? resolve(b) : reject(Error("촬영 실패"))),
            "image/jpeg",
            0.97,
          ),
        );
      }
      await props.current.onPhoto(blob, q, hash);
      gate.current.captured(hash, performance.now());
      setMessage("촬영 완료 · 다음 페이지를 넘겨주세요");
    } catch (e) {
      setError(String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function control(key: string, value: any) {
    try {
      await stream
        .current!.getVideoTracks()[0]
        .applyConstraints({ advanced: [{ [key]: value }] as any });
      if (key === "torch") setTorch(value);
      else setZoom(value);
    } catch (e) {
      setError("카메라 설정을 적용할 수 없습니다: " + String(e));
    }
  }
  return (
    <section className="camera">
      <header>
        <button onClick={onClose} aria-label="촬영 종료">
          ←
        </button>
        <strong>{next}페이지 촬영</strong>
        <button
          onClick={() => {
            setError("");
            setDevice((d) => (d === "environment" ? "user" : "environment"));
          }}
        >
          전환
        </button>
      </header>
      <div
        className="viewfinder"
        style={{ maxWidth: `calc(65dvh * ${ratio})` }}
      >
        <video ref={video} playsInline muted />
        <svg
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          className="outline"
          style={{
            color: state.bad
              ? "#ed7777"
              : state.stable
                ? "#bcf59c"
                : quad
                  ? "#f4ce6e"
                  : "#ed7777",
          }}
        >
          {quad && (
            <>
              <polygon points={quad.map((p) => `${p.x},${p.y}`).join(" ")} />
              {quad.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r=".012" />
              ))}
            </>
          )}
        </svg>
        {!quad && (
          <div className="camera-hint">
            페이지 전체가 화면에 들어오게 촬영하세요
          </div>
        )}
      </div>
      <div className="camera-status" role="status">
        {busy ? "촬영 원본 보관 중…" : message}
        {queued > 0 && <span> · {queued}장 자동 보정 중 · 다음 촬영 가능</span>}
        <progress value={state.progress} max={1} />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="camera-tools">
        <button disabled={!caps.torch} onClick={() => control("torch", !torch)}>
          플래시 {torch ? "켜짐" : caps.torch ? "꺼짐" : "미지원"}
        </button>
        {caps.zoom ? (
          <label>
            줌{" "}
            <input
              aria-label="카메라 줌"
              type="range"
              min={caps.zoom.min}
              max={caps.zoom.max}
              step={caps.zoom.step || 0.1}
              value={zoom}
              onChange={(e) => control("zoom", +e.target.value)}
            />
          </label>
        ) : (
          <span>줌 미지원</span>
        )}
      </div>
      <footer>
        <button
          className={settings.auto ? "selected" : ""}
          onClick={() => onSettings({ ...settings, auto: !settings.auto })}
        >
          {settings.auto ? "자동 촬영" : "수동 촬영"}
        </button>
        <button
          className="shutter"
          disabled={busy || queued >= 5}
          onClick={capture}
          aria-label="사진 촬영"
        >
          <span />
        </button>
        <button
          className={settings.spread ? "selected" : ""}
          onClick={() => onSettings({ ...settings, spread: !settings.spread })}
        >
          {settings.spread ? "두 페이지" : "한 페이지"}
        </button>
      </footer>
      <p className="camera-note">
        촬영 후 자동 보정합니다. 인식이 어려운 사진은 원본 전체를 보관하고
        나중에 확인할 수 있어요.
      </p>
    </section>
  );
}
