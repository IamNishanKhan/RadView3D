import { invoke } from "@tauri-apps/api/core";
import { paneSizeCss, Renderer } from "./render";
import {
  WINDOW_PRESETS,
  type Axis,
  type StudyInfo,
  type StudyJson,
  type ViewMode,
} from "./types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let studies: StudyInfo[] = [];
let json: StudyJson | null = null;
let renderer: Renderer | null = null;
let volume: Uint8Array = new Uint8Array();
let labels: Uint8Array = new Uint8Array();
let ax = 0;
let cor = 0;
let sag = 0;
let visible = new Set<number>();
let activeAxis: Axis = "axial";
let loading = false;

function setStatus(msg: string) {
  $("status").textContent = msg;
}

async function pickFolder() {
  try {
    const path = await invoke<string | null>("pick_patient_folder");
    if (!path) return;
    await openPatient(path);
  } catch (e) {
    setStatus(String(e));
  }
}

async function openPatient(path: string) {
  setStatus("Scanning studies…");
  try {
    studies = await invoke<StudyInfo[]>("list_patient_studies", { path });
  } catch (e) {
    setStatus(String(e));
    return;
  }
  $("folder-path").textContent = path;
  const sel = $("study-select") as HTMLSelectElement;
  sel.innerHTML = "";
  for (const s of studies) {
    const opt = document.createElement("option");
    opt.value = s.path;
    const mark = s.has_dicom ? "" : " (no DICOM)";
    opt.textContent = s.name + mark;
    sel.appendChild(opt);
  }
  const preferred =
    studies.find((s) => s.name.includes("CT2") && s.has_dicom) ??
    studies.find((s) => s.has_dicom) ??
    studies[0];
  if (preferred) {
    sel.value = preferred.path;
    await loadSelectedStudy();
  } else {
    setStatus("No studies found");
  }
}

async function loadSelectedStudy() {
  const sel = $("study-select") as HTMLSelectElement;
  const studyPath = sel.value;
  if (!studyPath || loading) return;
  loading = true;
  const preset = WINDOW_PRESETS[($("window-select") as HTMLSelectElement).value] ?? WINDOW_PRESETS.soft;
  setStatus("Loading study (one-time)…");
  try {
    const loadedJson = await invoke<StudyJson>("load_study_json", {
      studyPath,
      wl: preset.wl,
      ww: preset.ww,
    });
    json = loadedJson;
    const [volBuf, labBuf] = await Promise.all([
      invoke<ArrayBuffer | Uint8Array | number[]>("get_volume_u8"),
      invoke<ArrayBuffer | Uint8Array | number[]>("get_labels_u8"),
    ]);
    volume = toU8(volBuf);
    labels = toU8(labBuf);
    const { nz, rows, cols } = loadedJson.meta;
    ax = Math.floor(nz / 2);
    cor = Math.floor(rows / 2);
    sag = Math.floor(cols / 2);
    visible = new Set(
      loadedJson.structures.filter((s) => s.contour_count > 0).map((s) => s.id),
    );
    buildStructureList();
    bindSliders();
    applyAspect();
    renderer?.setStudy({ volume, labels, json: loadedJson });
    redraw();
    const rings = loadedJson.contours.length;
    setStatus(
      `${loadedJson.meta.patient_id} / ${loadedJson.meta.study_name}   ${nz} slices   ${loadedJson.structures.length} structures   ${rings} rings`,
    );
  } catch (e) {
    setStatus(String(e));
  } finally {
    loading = false;
  }
}

async function changeWindow() {
  if (!json) return;
  const preset = WINDOW_PRESETS[($("window-select") as HTMLSelectElement).value] ?? WINDOW_PRESETS.soft;
  setStatus("Rewindowing…");
  try {
    const volBuf = await invoke<ArrayBuffer | Uint8Array | number[]>("rewindow", {
      wl: preset.wl,
      ww: preset.ww,
    });
    volume = toU8(volBuf);
    renderer?.setStudy({ volume, labels, json });
    redraw();
    setStatus(`${json.meta.patient_id} / ${json.meta.study_name}   WL ${preset.wl} / WW ${preset.ww}`);
  } catch (e) {
    setStatus(String(e));
  }
}

function buildStructureList() {
  const box = $("struct-list");
  box.innerHTML = "";
  if (!json) return;
  const drawable = json.structures.filter((s) => s.contour_count > 0);
  const empty = json.structures.filter((s) => s.contour_count === 0);
  if (drawable.length === 0) {
    box.innerHTML = `<div class="empty">No contours in this study</div>`;
    return;
  }
  for (const s of drawable) {
    const row = document.createElement("label");
    row.className = "struct-row";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = `rgb(${s.rgb[0]},${s.rgb[1]},${s.rgb[2]})`;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = visible.has(s.id);
    cb.addEventListener("change", () => {
      if (cb.checked) visible.add(s.id);
      else visible.delete(s.id);
      redraw();
    });
    const name = document.createElement("span");
    name.className = "struct-name";
    name.textContent = s.name;
    const count = document.createElement("span");
    count.className = "struct-count";
    count.textContent = String(s.contour_count);
    row.append(cb, swatch, name, count);
    box.appendChild(row);
  }
  if (empty.length) {
    const hint = document.createElement("div");
    hint.className = "empty";
    hint.textContent = `${empty.length} unused template structures hidden`;
    box.appendChild(hint);
  }
}

function bindSliders() {
  if (!json) return;
  const { nz, rows, cols } = json.meta;
  const sa = $("slider-axial") as HTMLInputElement;
  const sc = $("slider-coronal") as HTMLInputElement;
  const ss = $("slider-sagittal") as HTMLInputElement;
  sa.max = String(Math.max(0, nz - 1));
  sc.max = String(Math.max(0, rows - 1));
  ss.max = String(Math.max(0, cols - 1));
  sa.value = String(ax);
  sc.value = String(cor);
  ss.value = String(sag);
}

function applyAspect() {
  if (!json) return;
  for (const axis of ["axial", "coronal", "sagittal"] as Axis[]) {
    const { aspect } = paneSizeCss(axis, json.meta);
    const canvas = $(`canvas-${axis}`);
    canvas.style.aspectRatio = aspect;
  }
}

function updateLabels() {
  if (!json) return;
  const z = json.meta.z_positions[ax] ?? 0;
  $("label-axial").textContent = `Axial  Z=${z.toFixed(1)} mm  [${ax + 1}/${json.meta.nz}]`;
  $("label-coronal").textContent = `Coronal  row=${cor}  [${cor + 1}/${json.meta.rows}]`;
  $("label-sagittal").textContent = `Sagittal  col=${sag}  [${sag + 1}/${json.meta.cols}]`;
  ($("slider-axial") as HTMLInputElement).value = String(ax);
  ($("slider-coronal") as HTMLInputElement).value = String(cor);
  ($("slider-sagittal") as HTMLInputElement).value = String(sag);
}

function redraw() {
  if (!renderer || !json) return;
  renderer.draw({ ax, cor, sag, visible });
  updateLabels();
}

function setViewMode(mode: ViewMode) {
  const grid = $("view-grid");
  grid.dataset.mode = mode;
  document.querySelectorAll("[data-mode-btn]").forEach((el) => {
    el.classList.toggle("active", (el as HTMLElement).dataset.modeBtn === mode);
  });
}

function step(axis: Axis, delta: number) {
  if (!json) return;
  if (axis === "axial") ax = clamp(ax + delta, 0, json.meta.nz - 1);
  if (axis === "coronal") cor = clamp(cor + delta, 0, json.meta.rows - 1);
  if (axis === "sagittal") sag = clamp(sag + delta, 0, json.meta.cols - 1);
  redraw();
}

function toU8(data: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (data instanceof Uint8Array) return new Uint8Array(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Uint8Array.from(data);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function axisFromTarget(t: EventTarget | null): Axis | null {
  const el = t as HTMLElement | null;
  const pane = el?.closest?.("[data-axis]") as HTMLElement | null;
  return (pane?.dataset.axis as Axis) ?? null;
}

window.addEventListener("DOMContentLoaded", () => {
  renderer = new Renderer(
    $("canvas-axial") as HTMLCanvasElement,
    $("canvas-coronal") as HTMLCanvasElement,
    $("canvas-sagittal") as HTMLCanvasElement,
  );

  $("btn-open").addEventListener("click", () => void pickFolder());
  $("study-select").addEventListener("change", () => void loadSelectedStudy());
  $("window-select").addEventListener("change", () => void changeWindow());

  document.querySelectorAll("[data-mode-btn]").forEach((el) => {
    el.addEventListener("click", () => setViewMode((el as HTMLElement).dataset.modeBtn as ViewMode));
  });

  $("slider-axial").addEventListener("input", (e) => {
    ax = Number((e.target as HTMLInputElement).value);
    redraw();
  });
  $("slider-coronal").addEventListener("input", (e) => {
    cor = Number((e.target as HTMLInputElement).value);
    redraw();
  });
  $("slider-sagittal").addEventListener("input", (e) => {
    sag = Number((e.target as HTMLInputElement).value);
    redraw();
  });

  document.addEventListener("wheel", (e) => {
    const axis = axisFromTarget(e.target) ?? activeAxis;
    if (!json) return;
    e.preventDefault();
    step(axis, e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  document.addEventListener("mousedown", (e) => {
    const axis = axisFromTarget(e.target);
    if (axis) activeAxis = axis;
  });

  document.addEventListener("keydown", (e) => {
    if (!json) return;
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") step(activeAxis, -1);
    if (e.key === "ArrowDown" || e.key === "ArrowRight") step(activeAxis, 1);
    if (e.key === "PageUp") step(activeAxis, -10);
    if (e.key === "PageDown") step(activeAxis, 10);
    if (e.key === "Home") {
      if (activeAxis === "axial") ax = 0;
      if (activeAxis === "coronal") cor = 0;
      if (activeAxis === "sagittal") sag = 0;
      redraw();
    }
    if (e.key === "End") {
      if (activeAxis === "axial") ax = json.meta.nz - 1;
      if (activeAxis === "coronal") cor = json.meta.rows - 1;
      if (activeAxis === "sagittal") sag = json.meta.cols - 1;
      redraw();
    }
    if (e.key === "1") setViewMode("all");
    if (e.key === "2") setViewMode("axial");
    if (e.key === "3") setViewMode("coronal");
    if (e.key === "4") setViewMode("sagittal");
  });

  const defaultPath = "/home/bmlab/Desktop/Viewer/Monaco/1~20230127";
  void openPatient(defaultPath);
});
