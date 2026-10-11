import type { Point, Quad, Detection } from "./types";
export function mapFromRect(q: Quad, x: number, y: number): Point {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x,
    dx2 = p3.x - p2.x,
    dx3 = p0.x - p1.x + p2.x - p3.x,
    dy1 = p1.y - p2.y,
    dy2 = p3.y - p2.y,
    dy3 = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(den) < 1e-10 ? 0 : (dx3 * dy2 - dx2 * dy3) / den,
    h = Math.abs(den) < 1e-10 ? 0 : (dx1 * dy3 - dx3 * dy1) / den;
  const z = g * x + h * y + 1;
  return {
    x: ((p1.x - p0.x + g * p1.x) * x + (p3.x - p0.x + h * p3.x) * y + p0.x) / z,
    y: ((p1.y - p0.y + g * p1.y) * x + (p3.y - p0.y + h * p3.y) * y + p0.y) / z,
  };
}
export function orderQuad(points: Point[]): Quad {
  const c = {
    x: points.reduce((s, p) => s + p.x, 0) / 4,
    y: points.reduce((s, p) => s + p.y, 0) / 4,
  };
  const sorted = [...points].sort(
    (a, b) =>
      Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x),
  );
  const i = sorted.reduce(
    (best, p, j) => (p.x + p.y < sorted[best].x + sorted[best].y ? j : best),
    0,
  );
  return [...sorted.slice(i), ...sorted.slice(0, i)] as Quad;
}
export function movement(a: Quad, b: Quad) {
  return Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));
}
export function hashDistance(a: number[], b: number[]) {
  return a.length === b.length
    ? a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length
    : Infinity;
}
export function validQuad(q: Quad) {
  const cross = q.map((p, i) => {
    const a = q[(i + 1) % 4],
      b = q[(i + 2) % 4];
    return (a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x);
  });
  return (
    q.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) &&
    cross.every((v) => v > 0.001)
  );
}
export class AutoGate {
  private previous: Quad | null = null;
  private since = 0;
  private last = 0;
  private hash: number[] = [];
  private armed = true;
  reset() {
    this.previous = null;
    this.since = 0;
    this.armed = true;
  }
  update(
    d: Detection,
    now: number,
    delay: number,
    sensitivity: number,
    enabled = true,
  ) {
    const stable =
      !!d.quad &&
      d.sharpness > 55 / sensitivity &&
      d.brightness > 45 &&
      d.brightness < 242 &&
      d.clipped < 0.4 &&
      (!this.previous || movement(this.previous, d.quad) < 0.012 * sensitivity);
    this.previous = d.quad;
    if (!d.quad || hashDistance(this.hash, d.hash) > 12) this.armed = true;
    if (!stable) {
      this.since = 0;
      return { stable: false, progress: 0, shoot: false };
    }
    if (!this.since) this.since = now;
    const progress = Math.min(1, (now - this.since) / delay);
    const shoot =
      enabled && progress === 1 && this.armed && now - this.last > 2500;
    if (shoot) {
      this.last = now;
      this.hash = d.hash;
      this.armed = false;
      this.since = 0;
    }
    return { stable: true, progress, shoot };
  }
}
