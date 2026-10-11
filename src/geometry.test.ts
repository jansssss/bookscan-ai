import { describe, it, expect } from "vitest";
import {
  AutoGate,
  hashDistance,
  orderQuad,
  validQuad,
  mapFromRect,
} from "./geometry";
import { fullQuad, type Detection } from "./types";
describe("실제 자동 촬영 판단", () => {
  it("원근 보정된 페이지 좌표를 원본 사진으로 역변환", () => {
    const q = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.2 },
      { x: 0.8, y: 0.9 },
      { x: 0.2, y: 0.8 },
    ] as typeof fullQuad;
    for (const [x, y, i] of [
      [0, 0, 0],
      [1, 0, 1],
      [1, 1, 2],
      [0, 1, 3],
    ]) {
      const p = mapFromRect(q, x, y);
      expect(p.x).toBeCloseTo(q[i].x);
      expect(p.y).toBeCloseTo(q[i].y);
    }
    expect(mapFromRect(fullQuad, 0.5, 0.5)).toEqual({ x: 0.5, y: 0.5 });
  });
  const frame: Detection = {
    quad: fullQuad,
    sharpness: 120,
    brightness: 140,
    clipped: 0,
    shadow: 0,
    hash: Array(64).fill(100),
  };
  it("안정 시간 충족, 쿨다운, 동일 문서 재촬영 차단", () => {
    const gate = new AutoGate();
    expect(gate.update(frame, 3000, 900, 1).shoot).toBe(false);
    expect(gate.update(frame, 3901, 900, 1).shoot).toBe(true);
    expect(gate.update(frame, 7000, 900, 1).shoot).toBe(false);
    gate.update({ ...frame, quad: null }, 7100, 900, 1);
    gate.update({ ...frame, hash: Array(64).fill(140) }, 7300, 900, 1);
    expect(
      gate.update({ ...frame, hash: Array(64).fill(140) }, 8300, 900, 1).shoot,
    ).toBe(true);
  });
  it("흐림과 흔들림 이후 안정 시간 재시작", () => {
    const gate = new AutoGate();
    gate.update(frame, 3000, 900, 1);
    expect(gate.update({ ...frame, sharpness: 5 }, 4000, 900, 1).shoot).toBe(
      false,
    );
    expect(gate.update(frame, 4200, 900, 1).shoot).toBe(false);
    expect(gate.update(frame, 5200, 900, 1).shoot).toBe(true);
  });
  it("수동 모드에서 자동 촬영 잠금 상태를 소비하지 않음", () => {
    const gate = new AutoGate();
    gate.update(frame, 3000, 900, 1, false);
    expect(gate.update(frame, 4000, 900, 1, false).shoot).toBe(false);
    expect(gate.update(frame, 5000, 900, 1, true).shoot).toBe(true);
  });
  it("수동 촬영 후 같은 문서를 차단하고 비슷한 다음 페이지는 재촬영", () => {
    const gate = new AutoGate();
    gate.captured(frame.hash, 4000);
    gate.update(frame, 5000, 900, 1);
    expect(gate.update(frame, 6000, 900, 1).shoot).toBe(false);
    const next = { ...frame, hash: Array(64).fill(108) };
    expect(gate.update(next, 6200, 900, 1).shoot).toBe(true);
  });
  it("교차한 모서리 거부", () => {
    expect(validQuad(fullQuad)).toBe(true);
    expect(
      validQuad([fullQuad[0], fullQuad[2], fullQuad[1], fullQuad[3]]),
    ).toBe(false);
  });
  it("모서리 순서와 지문 비교", () => {
    expect(
      orderQuad([fullQuad[2], fullQuad[0], fullQuad[3], fullQuad[1]]),
    ).toEqual(fullQuad);
    expect(hashDistance([1, 2], [2, 3])).toBe(1);
  });
});
