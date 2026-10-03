import type { Axis, ContourRing, StudyJson } from "./types";

export interface ViewerBuffers {
  volume: Uint8Array;
  labels: Uint8Array;
  json: StudyJson;
}

export interface ViewState {
  ax: number;
  cor: number;
  sag: number;
  visible: Set<number>;
}

function grayImageData(
  ctx: CanvasRenderingContext2D,
  src: Uint8Array,
  w: number,
  h: number,
  imageData: ImageData,
) {
  const d = imageData.data;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const v = src[i];
    const o = i * 4;
    d[o] = v;
    d[o + 1] = v;
    d[o + 2] = v;
    d[o + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

function extractAxial(volume: Uint8Array, zi: number, rows: number, cols: number): Uint8Array {
  const off = zi * rows * cols;
  return volume.subarray(off, off + rows * cols);
}

function extractCoronal(volume: Uint8Array, yi: number, nz: number, rows: number, cols: number): Uint8Array {
  const out = new Uint8Array(nz * cols);
  for (let z = 0; z < nz; z++) {
    const src = z * rows * cols + yi * cols;
    out.set(volume.subarray(src, src + cols), z * cols);
  }
  return out;
}

function extractSagittal(volume: Uint8Array, xi: number, nz: number, rows: number, cols: number): Uint8Array {
  const out = new Uint8Array(nz * rows);
  for (let z = 0; z < nz; z++) {
    const base = z * rows * cols;
    for (let y = 0; y < rows; y++) {
      out[z * rows + y] = volume[base + y * cols + xi];
    }
  }
  return out;
}

function paintOutline(
  ctx: CanvasRenderingContext2D,
  labels: Uint8Array,
  w: number,
  h: number,
  visible: Set<number>,
  colors: Map<number, [number, number, number]>,
) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const at = (x: number, y: number) => labels[y * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = at(x, y);
      if (!id || !visible.has(id)) continue;
      const border =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        at(x - 1, y) !== id ||
        at(x + 1, y) !== id ||
        at(x, y - 1) !== id ||
        at(x, y + 1) !== id;
      if (!border) continue;
      const rgb = colors.get(id) ?? [255, 255, 0];
      const o = (y * w + x) * 4;
      d[o] = rgb[0];
      d[o + 1] = rgb[1];
      d[o + 2] = rgb[2];
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function drawPolylines(
  ctx: CanvasRenderingContext2D,
  rings: ContourRing[],
  visible: Set<number>,
  colors: Map<number, [number, number, number]>,
) {
  ctx.lineWidth = 1.25;
  ctx.lineJoin = "round";
  for (const ring of rings) {
    if (!visible.has(ring.struct_id) || ring.points.length < 2) continue;
    const rgb = colors.get(ring.struct_id) ?? [255, 255, 0];
    ctx.strokeStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    ctx.beginPath();
    ctx.moveTo(ring.points[0][0], ring.points[0][1]);
    for (let i = 1; i < ring.points.length; i++) {
      ctx.lineTo(ring.points[i][0], ring.points[i][1]);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  x: number,
  y: number,
) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,220,80,0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y + 0.5);
  ctx.lineTo(w, y + 0.5);
  ctx.moveTo(x + 0.5, 0);
  ctx.lineTo(x + 0.5, h);
  ctx.stroke();
  ctx.restore();
}

export class Renderer {
  private axial: HTMLCanvasElement;
  private coronal: HTMLCanvasElement;
  private sagittal: HTMLCanvasElement;
  private axCtx: CanvasRenderingContext2D;
  private corCtx: CanvasRenderingContext2D;
  private sagCtx: CanvasRenderingContext2D;
  private axImg: ImageData | null = null;
  private corImg: ImageData | null = null;
  private sagImg: ImageData | null = null;
  private buffers: ViewerBuffers | null = null;
  private colors = new Map<number, [number, number, number]>();
  private axialByZ = new Map<number, ContourRing[]>();

  constructor(axial: HTMLCanvasElement, coronal: HTMLCanvasElement, sagittal: HTMLCanvasElement) {
    this.axial = axial;
    this.coronal = coronal;
    this.sagittal = sagittal;
    this.axCtx = axial.getContext("2d", { willReadFrequently: true })!;
    this.corCtx = coronal.getContext("2d", { willReadFrequently: true })!;
    this.sagCtx = sagittal.getContext("2d", { willReadFrequently: true })!;
  }

  setStudy(buffers: ViewerBuffers) {
    this.buffers = buffers;
    const { rows, cols, nz } = buffers.json.meta;
    this.axial.width = cols;
    this.axial.height = rows;
    this.coronal.width = cols;
    this.coronal.height = nz;
    this.sagittal.width = rows;
    this.sagittal.height = nz;
    this.axImg = this.axCtx.createImageData(cols, rows);
    this.corImg = this.corCtx.createImageData(cols, nz);
    this.sagImg = this.sagCtx.createImageData(rows, nz);
    this.colors.clear();
    for (const s of buffers.json.structures) {
      this.colors.set(s.id, s.rgb);
    }
    this.axialByZ.clear();
    for (const ring of buffers.json.contours) {
      const list = this.axialByZ.get(ring.z_index) ?? [];
      list.push(ring);
      this.axialByZ.set(ring.z_index, list);
    }
  }

  updateVolume(volume: Uint8Array) {
    if (this.buffers) this.buffers.volume = volume;
  }

  clear() {
    this.buffers = null;
    this.axImg = null;
    this.corImg = null;
    this.sagImg = null;
    this.colors.clear();
    this.axialByZ.clear();
    for (const canvas of [this.axial, this.coronal, this.sagittal]) {
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, 1, 1);
    }
  }

  draw(state: ViewState) {
    const b = this.buffers;
    if (!b || !this.axImg || !this.corImg || !this.sagImg) return;
    const { rows, cols, nz } = b.json.meta;
    const ax = clamp(state.ax, 0, nz - 1);
    const cor = clamp(state.cor, 0, rows - 1);
    const sag = clamp(state.sag, 0, cols - 1);

    grayImageData(this.axCtx, extractAxial(b.volume, ax, rows, cols), cols, rows, this.axImg);
    drawPolylines(this.axCtx, this.axialByZ.get(ax) ?? [], state.visible, this.colors);
    drawCrosshair(this.axCtx, cols, rows, sag, cor);

    const corSlice = extractCoronal(b.volume, cor, nz, rows, cols);
    grayImageData(this.corCtx, corSlice, cols, nz, this.corImg);
    const corLabels = extractCoronal(b.labels, cor, nz, rows, cols);
    paintOutline(this.corCtx, corLabels, cols, nz, state.visible, this.colors);
    drawCrosshair(this.corCtx, cols, nz, sag, ax);

    const sagSlice = extractSagittal(b.volume, sag, nz, rows, cols);
    grayImageData(this.sagCtx, sagSlice, rows, nz, this.sagImg);
    const sagLabels = extractSagittal(b.labels, sag, nz, rows, cols);
    paintOutline(this.sagCtx, sagLabels, rows, nz, state.visible, this.colors);
    drawCrosshair(this.sagCtx, rows, nz, cor, ax);
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function paneAspectRatio(
  axis: Axis,
  meta: { rows: number; cols: number; nz: number; spacing: [number, number]; slice_thickness: number; z_positions: number[] },
): number {
  const [dx, dy] = meta.spacing;
  const zGaps = meta.z_positions
    .slice(1)
    .map((position, index) => Math.abs(position - meta.z_positions[index]))
    .filter((gap) => Number.isFinite(gap) && gap > 0)
    .sort((a, b) => a - b);
  const medianGap = zGaps.length ? zGaps[Math.floor(zGaps.length / 2)] : 0;
  const dz = medianGap || meta.slice_thickness || dx;
  if (axis === "axial") {
    return (meta.cols * dx) / (meta.rows * dy);
  }
  if (axis === "coronal") {
    return (meta.cols * dx) / (meta.nz * dz);
  }
  return (meta.rows * dy) / (meta.nz * dz);
}

export function fitCanvasToStage(canvas: HTMLCanvasElement, aspect: number): () => void {
  const stage = canvas.parentElement;
  if (!stage) return () => {};

  const fit = () => {
    const { width, height } = stage.getBoundingClientRect();
    if (!width || !height || !Number.isFinite(aspect) || aspect <= 0) return;
    const fittedWidth = Math.min(width, height * aspect);
    const fittedHeight = fittedWidth / aspect;
    canvas.style.width = `${fittedWidth}px`;
    canvas.style.height = `${fittedHeight}px`;
  };

  const observer = new ResizeObserver(fit);
  observer.observe(stage);
  fit();
  return () => observer.disconnect();
}
