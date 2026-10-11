export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];
export type Mode = "original" | "color" | "gray" | "bw";
export type Project = {
  id: string;
  name: string;
  subject: string;
  created: string;
  settings: Settings;
};
export type Settings = {
  auto: boolean;
  delay: number;
  sensitivity: number;
  spread: boolean;
  mode: Mode;
  quality: number;
};
export const defaults: Settings = {
  auto: false,
  delay: 900,
  sensitivity: 1,
  spread: false,
  mode: "color",
  quality: 0.9,
};
export type Word = {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};
export type Page = {
  id: string;
  project: string;
  order: number;
  originalId: string;
  image: Blob;
  thumb: Blob;
  quad: Quad;
  mode: Mode;
  date: string;
  hash: number[];
  text: string;
  confidence: number | null;
  words: Word[];
  dewarp?: number;
  needsReview?: boolean;
  rotation?: number;
  imageBytes?: number;
  originalBytes?: number;
  originalMime?: string;
};
export type Detection = {
  quad: Quad | null;
  sharpness: number;
  brightness: number;
  clipped: number;
  shadow: number;
  hash: number[];
};
export const fullQuad: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
