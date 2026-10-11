import { useState } from "react";
import { detect, correct, thumbnail, dewarp, spine } from "./vision";
import { fullQuad, defaults, type Page, type Project } from "./types";
import * as db from "./storage";
import { pdf, zip } from "./export";
import { recognize } from "./ocr";
export default function Diagnostics() {
  const [logs, setLogs] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const log = (s: string) => setLogs((l) => [...l, s]);
  async function run(count: number) {
    setBusy(true);
    setLogs([]);
    try {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 900;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#26372f";
      ctx.fillRect(0, 0, 640, 900);
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.moveTo(60, 60);
      ctx.lineTo(590, 90);
      ctx.lineTo(560, 840);
      ctx.lineTo(80, 820);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#101010";
      ctx.font = "24px sans-serif";
      for (const [i, t] of [
        "정보보안기사 합성 문서",
        "BookScan LOCAL OCR",
        "TCP/IP 192.168.0.1:443",
        "Linux sudo ls -la",
        "HTTPS example.com",
        "네트워크 보안 테스트",
      ].entries())
        ctx.fillText(t, 105, 190 + i * 80);
      const blob = await new Promise<Blob>((resolve) =>
        c.toBlob((b) => resolve(b!), "image/jpeg", 0.97),
      );
      const detection = await detect(c);
      if (!detection.quad) throw Error("합성 사각형 검출 실패");
      const expected = [
        { x: 60 / 640, y: 60 / 900 },
        { x: 590 / 640, y: 90 / 900 },
        { x: 560 / 640, y: 840 / 900 },
        { x: 80 / 640, y: 820 / 900 },
      ];
      if (
        detection.quad.some(
          (p, i) =>
            Math.hypot(p.x - expected[i].x, p.y - expected[i].y) > 0.035,
        )
      )
        throw Error("합성 모서리 오차 > 3.5%");
      log("PASS 실제 OpenCV Canny·윤곽·네 모서리 검출");
      let image: Blob = blob;
      for (const mode of ["original", "color", "gray", "bw"] as const) {
        image = await correct(blob, detection.quad, mode, 0.9);
        const b = await createImageBitmap(image);
        if (b.width < 400 || b.height < 650) throw Error("보정 출력 크기 오류");
        b.close();
        log("PASS 원근 보정 " + mode);
      }
      const flat = await correct(blob, detection.quad, "original");
      const halves = await Promise.all([
        correct(
          flat,
          [
            { x: 0, y: 0 },
            { x: 0.5, y: 0 },
            { x: 0.5, y: 1 },
            { x: 0, y: 1 },
          ],
          "color",
        ),
        correct(
          flat,
          [
            { x: 0.5, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0.5, y: 1 },
          ],
          "color",
        ),
      ]);
      if (halves.some((p) => !p.size)) throw Error("좌우 분리 실패");
      log(
        "PASS 좌우 페이지 독립 보정 · 책등 후보 " +
          (await spine(flat)).position.toFixed(2),
      );
      const warped = await dewarp(flat, 0.06);
      if (!warped.size) throw Error("수동 곡면 출력 실패");
      log("PASS 실험적 수동 곡면 remap 출력 (품질 평가는 별도)");
      const project: Project = {
        id: crypto.randomUUID(),
        name: `합성 자동검증 ${count}페이지`,
        subject: "테스트 전용",
        created: new Date().toISOString(),
        settings: { ...defaults },
      };
      await db.saveProject(project);
      const thumb = await thumbnail(image);
      for (let i = 1; i <= count; i++) {
        const originalId = await db.stageCapture(
          project.id,
          blob,
          fullQuad,
          [],
        );
        if (i === 1 && !(await db.pendingIds(project.id)).includes(originalId))
          throw Error("미완료 촬영 복구 실패");
        const page: Page = {
          id: crypto.randomUUID(),
          project: project.id,
          order: i,
          originalId,
          image,
          thumb,
          quad: detection.quad,
          mode: "bw",
          date: new Date().toISOString(),
          hash: [],
          text: "합성 OCR",
          confidence: null,
          words: [],
        };
        await db.savePages([page], { id: originalId, image: blob });
        if (i % 10 === 0) log("저장 " + i + "/" + count);
      }
      const saved = await db.pages(project.id);
      if (
        saved.length !== count ||
        saved.some((p) => p.image.size !== 0) ||
        saved.at(-1)!.order !== count
      )
        throw Error("페이지 복구 또는 메모리 분리 실패");
      if ((await db.pendingIds(project.id)).length)
        throw Error("완료 촬영이 미완료로 남음");
      log("PASS " + count + "페이지 순차 저장·재조회·원본 복구·썸네일 목록");
      const pdfBlob = await pdf(
        saved.slice(0, Math.min(30, count)),
        "a4",
        0.8,
        () => {},
      );
      const header = await pdfBlob.slice(0, 5).text();
      if (header !== "%PDF-") throw Error("PDF 헤더 오류");
      log("PASS " + Math.min(30, count) + "페이지 PDF 생성");
      const archive = await zip(project, saved.slice(0, 2), pdfBlob, () => {});
      const { unzipSync, strFromU8 } = await import("fflate");
      const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()));
      const meta = JSON.parse(strFromU8(entries["metadata.json"]));
      for (const p of meta.pages)
        if (!entries[p.original] || !entries[p.image])
          throw Error("ZIP 이미지 연결 오류");
      log("PASS ZIP 원본·보정 이미지·TXT·JSON 연결");
      const ocr = await recognize(flat, () => {});
      if (!ocr.text.includes("192.168.0.1"))
        throw Error("합성 OCR IP 주소 인식 실패");
      log(
        "PASS 로컬 한영 OCR · 엔진 신뢰도 " +
          ocr.confidence.toFixed(1) +
          "% (정확도와 다름)",
      );
      log("완료 · 실제 카메라와 스마트폰 연속 촬영은 실기기 검증 필요");
    } catch (e) {
      log("FAIL " + String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <h1>BookScan 합성 검증</h1>
      <p>
        저작권 없는 합성 문서를 생성하여 실제 처리 모듈을 검사합니다. 테스트
        프로젝트는 현재 브라우저에 남으며 사진을 외부로 보내지 않습니다.
      </p>
      <div className="actions">
        <button disabled={busy} onClick={() => run(30)}>
          30페이지 검사
        </button>
        <button disabled={busy} onClick={() => run(100)}>
          100페이지 검사
        </button>
      </div>
      <pre style={{ whiteSpace: "pre-wrap" }} aria-live="polite">
        {logs.join("\n")}
      </pre>
      <a href="./">앱으로 돌아가기</a>
    </main>
  );
}
