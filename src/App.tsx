import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import radviewIcon from "../src-tauri/icons/128x128.png";
import {
  ChevronRight, Copy, ExternalLink, FolderOpen, FolderPlus, Globe2, Info,
  LoaderCircle, MonitorX, SquareLibrary, Trash2, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { fitImageFrameToStage, paneAspectRatio, Renderer } from "./render";
import { WINDOW_PRESETS, type Axis, type PatientLibraryEntry, type StudyInfo, type StudyJson, type ViewMode } from "./types";

const axes: Axis[] = ["axial", "coronal", "sagittal"];
const axisNames: Record<Axis, string> = { axial: "Axial", coronal: "Coronal", sagittal: "Sagittal" };
const windowLabels: Record<string, string> = { soft: "Soft tissue", lung: "Lung", bone: "Bone" };
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const EMPTY_BYTES = new Uint8Array(0);

function displayStudyName(name: string): string {
  return name.match(/CT\d+/i)?.[0] ?? name;
}

function toU8(data: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Uint8Array.from(data);
}

function App() {
  const canvasAxial = useRef<HTMLCanvasElement>(null);
  const canvasCoronal = useRef<HTMLCanvasElement>(null);
  const canvasSagittal = useRef<HTMLCanvasElement>(null);
  const frameAxial = useRef<HTMLDivElement>(null);
  const frameCoronal = useRef<HTMLDivElement>(null);
  const frameSagittal = useRef<HTMLDivElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const closingRef = useRef(false);
  const currentPatientPath = useRef<string | null>(null);
  const returnToLibrary = useRef(false);
  const volumeBuffer = useRef<Uint8Array>(EMPTY_BYTES);
  const labelsBuffer = useRef<Uint8Array>(EMPTY_BYTES);
  const [studies, setStudies] = useState<StudyInfo[]>([]);
  const [studyPath, setStudyPath] = useState("");
  const [json, setJson] = useState<StudyJson | null>(null);
  const [renderRevision, setRenderRevision] = useState(0);
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [slices, setSlices] = useState<Record<Axis, number>>({ axial: 0, coronal: 0, sagittal: 0 });
  const [activeAxis, setActiveAxis] = useState<Axis>("axial");
  const [mode, setMode] = useState<ViewMode>("all");
  const [windowPreset, setWindowPreset] = useState("soft");
  const [loading, setLoading] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"close" | "exit" | "remove-library" | null>(null);
  const [status, setStatus] = useState("No study open");
  const [pathCopied, setPathCopied] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryPatients, setLibraryPatients] = useState<PatientLibraryEntry[]>([]);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [copiedLibraryPath, setCopiedLibraryPath] = useState<string | null>(null);
  const [pendingLibraryRemoval, setPendingLibraryRemoval] = useState<PatientLibraryEntry | null>(null);

  const folderOpen = Boolean(json && currentPatientPath.current);
  const viewerOpen = folderOpen && !libraryOpen;

  useEffect(() => {
    if (!viewerOpen) return;
    if (!canvasAxial.current || !canvasCoronal.current || !canvasSagittal.current) return;
    const activeRenderer = new Renderer(canvasAxial.current, canvasCoronal.current, canvasSagittal.current);
    renderer.current = activeRenderer;
    return () => {
      activeRenderer.clear();
      if (renderer.current === activeRenderer) renderer.current = null;
    };
  }, [viewerOpen]);

  useEffect(() => {
    if (!viewerOpen || !json || !renderer.current) return;
    renderer.current.setStudy({ volume: volumeBuffer.current, labels: labelsBuffer.current, json });
    const resizeHandlers = axes.map((axis) => {
      const frame = axis === "axial" ? frameAxial.current : axis === "coronal" ? frameCoronal.current : frameSagittal.current;
      return frame ? fitImageFrameToStage(frame, paneAspectRatio(axis, json.meta)) : () => {};
    });
    return () => resizeHandlers.forEach((dispose) => dispose());
  }, [json, viewerOpen]);

  useEffect(() => {
    if (!viewerOpen || !json || !renderer.current) return;
    renderer.current.draw({ ax: slices.axial, cor: slices.coronal, sag: slices.sagittal, visible });
  }, [json, slices, visible, renderRevision, viewerOpen]);

  const loadStudy = useCallback(async (path: string, preset = windowPreset) => {
    if (!path || loading) return;
    setLoading(true);
    setStatus("Loading study…");
    const wlww = WINDOW_PRESETS[preset] ?? WINDOW_PRESETS.soft;
    try {
      const loadedJson = await invoke<StudyJson>("load_study_json", {
        studyPath: path, wl: wlww.wl, ww: wlww.ww,
      });
      const [volBuffer, labelBuffer] = await Promise.all([
        invoke<ArrayBuffer | Uint8Array | number[]>("take_initial_volume_u8"),
        invoke<ArrayBuffer | Uint8Array | number[]>("take_initial_labels_u8"),
      ]);
      volumeBuffer.current = toU8(volBuffer);
      labelsBuffer.current = toU8(labelBuffer);
      setJson(loadedJson);
      setSlices({
        axial: Math.floor(loadedJson.meta.nz / 2),
        coronal: Math.floor(loadedJson.meta.rows / 2),
        sagittal: Math.floor(loadedJson.meta.cols / 2),
      });
      setVisible(new Set(loadedJson.structures.filter((item) => item.contour_count > 0).map((item) => item.id)));
      setStudyPath(path);
      setStatus("");
    } catch (error) {
      setStatus(String(error));
    } finally {
      setLoading(false);
    }
  }, [loading, windowPreset]);

  const openPatientPath = useCallback(async (path: string, fromLibrary = false) => {
    try {
      setLoading(true);
      setStatus("Scanning patient folder…");
      const found = await invoke<StudyInfo[]>("list_patient_studies", { path });
      const preferred = found.find((item) => item.name.includes("CT2") && item.has_dicom)
        ?? found.find((item) => item.has_dicom) ?? found[0];
      if (!preferred) throw new Error("No CT studies were found in this folder.");
      setMode("all");
      setActiveAxis("axial");
      setStudies(found);
      currentPatientPath.current = path;
      returnToLibrary.current = fromLibrary;
      setLibraryOpen(false);
      setLibraryError("");
      setStudyPath(preferred.path);
      await loadStudy(preferred.path);
    } catch (error) {
      setStatus(String(error));
      if (fromLibrary || libraryOpen) {
        setLibraryError(String(error));
        setLibraryOpen(true);
      }
    } finally {
      setLoading(false);
    }
  }, [libraryOpen, loadStudy]);

  const openPatient = useCallback(async () => {
    try {
      const path = await openDialog({
        directory: true,
        multiple: false,
        title: "Open Monaco patient folder",
      });
      if (!path) return;
      await openPatientPath(path);
    } catch (error) {
      setStatus(String(error));
    }
  }, [openPatientPath]);

  const loadPatientLibrary = useCallback(async () => {
    setLibraryBusy(true);
    setLibraryError("");
    try {
      setLibraryPatients(await invoke<PatientLibraryEntry[]>("load_patient_library"));
    } catch (error) {
      setLibraryError(String(error));
    } finally {
      setLibraryBusy(false);
    }
  }, []);

  const toggleLibrary = useCallback(() => {
    const next = !libraryOpen;
    returnToLibrary.current = next;
    setLibraryOpen(next);
    if (next) void loadPatientLibrary();
  }, [libraryOpen, loadPatientLibrary]);

  const addPatientFoldersToLibrary = useCallback(async () => {
    setLibraryError("");
    try {
      const path = await openDialog({
        directory: true,
        multiple: false,
        title: "Select a patient folder or a folder containing patient folders",
      });
      if (!path) return;
      setLibraryBusy(true);
      setLibraryPatients(await invoke<PatientLibraryEntry[]>("add_patient_folder_to_library", { path }));
    } catch (error) {
      setLibraryError(String(error));
    } finally {
      setLibraryBusy(false);
    }
  }, []);

  const removePatientFromLibrary = useCallback(async (patient: PatientLibraryEntry) => {
    setLibraryBusy(true);
    setLibraryError("");
    try {
      setLibraryPatients(await invoke<PatientLibraryEntry[]>("remove_patient_from_library", { path: patient.path }));
      setPendingLibraryRemoval(null);
    } catch (error) {
      setLibraryError(String(error));
    } finally {
      setLibraryBusy(false);
    }
  }, []);

  const closeFolder = useCallback(async () => {
    setLoading(true);
    setStatus("Closing folder…");
    try {
      await invoke("clear_study");
      renderer.current?.clear();
      currentPatientPath.current = null;
      volumeBuffer.current = EMPTY_BYTES;
      labelsBuffer.current = EMPTY_BYTES;
      setStudies([]);
      setStudyPath("");
      setJson(null);
      setVisible(new Set());
      setStatus("No study open");
      setLibraryOpen(returnToLibrary.current);
      returnToLibrary.current = false;
    } catch (error) {
      setStatus(String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const changeWindow = useCallback(async (preset: string) => {
    setWindowPreset(preset);
    if (!json) return;
    const wlww = WINDOW_PRESETS[preset] ?? WINDOW_PRESETS.soft;
    try {
      const updated = await invoke<ArrayBuffer | Uint8Array | number[]>("rewindow", { wl: wlww.wl, ww: wlww.ww });
      const pixels = toU8(updated);
      volumeBuffer.current = pixels;
      renderer.current?.updateVolume(pixels);
      setRenderRevision((revision) => revision + 1);
      setStatus("");
    } catch (error) {
      setStatus(String(error));
    }
  }, [json]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void appWindow.onCloseRequested((event) => {
      if (closingRef.current) return;
      event.preventDefault();
      setConfirmAction("exit");
    }).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!json || aboutOpen || confirmAction) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, input, [role=slider], [role=combobox], [role=checkbox]")) return;
      const axis = (target?.closest("[data-axis]") as HTMLElement | null)?.dataset.axis as Axis | undefined;
      const selectedAxis = axis ?? activeAxis;
      event.preventDefault();
      setActiveAxis(selectedAxis);
      setSlices((prior) => ({
        ...prior,
        [selectedAxis]: clamp(prior[selectedAxis] + (event.deltaY > 0 ? 1 : -1), 0,
          selectedAxis === "axial" ? json.meta.nz - 1 : selectedAxis === "coronal" ? json.meta.rows - 1 : json.meta.cols - 1),
      }));
    };
    const onKey = (event: KeyboardEvent) => {
      if (!json || aboutOpen || confirmAction) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, button, select, textarea, [role=slider], [role=combobox], [contenteditable=true]")) return;
      if (["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight", "PageUp", "PageDown", "Home", "End"].includes(event.key)) event.preventDefault();
      const delta = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1
        : event.key === "PageUp" ? -10
        : event.key === "PageDown" ? 10
        : event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : 0;
      const max = activeAxis === "axial" ? json.meta.nz - 1 : activeAxis === "coronal" ? json.meta.rows - 1 : json.meta.cols - 1;
      if (delta) setSlices((prior) => ({ ...prior, [activeAxis]: clamp(prior[activeAxis] + delta, 0, max) }));
      if (event.key === "Home") setSlices((prior) => ({ ...prior, [activeAxis]: 0 }));
      if (event.key === "End") setSlices((prior) => ({ ...prior, [activeAxis]: max }));
      if (event.key === "1") setMode("all");
      if (event.key === "2") setMode("axial");
      if (event.key === "3") setMode("coronal");
      if (event.key === "4") setMode("sagittal");
    };
    document.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("keydown", onKey);
    };
  }, [json, activeAxis, aboutOpen, confirmAction]);

  const activeContours = useMemo(() => json?.structures.filter((item) => item.contour_count > 0) ?? [], [json]);
  const currentZ = json?.meta.z_positions[slices.axial] ?? 0;
  const selectedStudy = studies.find((item) => item.path === studyPath);
  const selectedStudyLabel = selectedStudy ? displayStudyName(selectedStudy.name) : "Select CT study";
  const confirmTitle = confirmAction === "exit" ? "Exit RadView3D?"
    : confirmAction === "remove-library" ? "Remove patient from library?"
    : "Close patient folder?";
  const confirmDescription = confirmAction === "exit"
    ? "The application will close and the current study will be cleared."
    : confirmAction === "remove-library"
      ? `Remove ${pendingLibraryRemoval?.id ?? "this patient"} from the library only. Its folder and files will remain on disk.`
      : "The current study will be cleared from the viewer.";

  const confirm = async () => {
    const action = confirmAction;
    setConfirmAction(null);
    if (action === "close") await closeFolder();
    if (action === "remove-library" && pendingLibraryRemoval) await removePatientFromLibrary(pendingLibraryRemoval);
    if (action === "exit") {
      closingRef.current = true;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await invoke("exit_app");
    }
  };

  const setStructureVisible = (id: number, checked: boolean) => {
    setVisible((prior) => {
      const next = new Set(prior);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const copyPatientPath = async () => {
    const path = currentPatientPath.current;
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 1400);
    } catch (error) {
      setStatus(String(error));
    }
  };

  const copyLibraryPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setLibraryError("");
      setCopiedLibraryPath(path);
      window.setTimeout(() => setCopiedLibraryPath((current) => current === path ? null : current), 1400);
    } catch (error) {
      setLibraryError(String(error));
    }
  }, []);

  return (
    <TooltipProvider>
      <main className="app-shell">
        <header className="app-header">
          <div className="brand-lockup">
            <img className="brand-mark" src={radviewIcon} alt="" />
            <span className="brand-title">RadView3D</span>
          </div>

          <div className="header-actions">
            <Button variant="outline" size="sm" className="toolbar-open" disabled={loading || libraryBusy} onClick={() => void openPatient()}>
              {loading ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <FolderOpen data-icon="inline-start" />}
              {loading ? "Opening…" : "Open folder"}
            </Button>
            <Button variant={libraryOpen ? "secondary" : "outline"} size="sm" className="toolbar-open" disabled={loading || libraryBusy} onClick={toggleLibrary}>
              <SquareLibrary data-icon="inline-start" />
              Library
            </Button>
            {folderOpen && (
              <Button variant="outline" size="sm" className="toolbar-open" disabled={loading} onClick={() => setConfirmAction("close")}>
                <MonitorX data-icon="inline-start" />
                Close folder
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon" className="toolbar-icon" onClick={() => setAboutOpen(true)} aria-label="About RadView3D"><Info /></Button>} />
              <TooltipContent>About</TooltipContent>
            </Tooltip>
          </div>
        </header>

        <section className={`workspace ${folderOpen && !libraryOpen ? "has-study" : "empty-workspace"}`}>
          {folderOpen && !libraryOpen && (
            <aside className="structure-rail">
              <section className="sidebar-study">
                <div className="sidebar-section-heading">CT study</div>
                <div className="sidebar-study-row">
                  <Select value={studyPath} disabled={loading} onValueChange={(value) => { if (value) void loadStudy(value); }}>
                    <SelectTrigger className="sidebar-study-select"><SelectValue>{selectedStudyLabel}</SelectValue></SelectTrigger>
                    <SelectContent>
                      {studies.map((item) => <SelectItem key={item.path} value={item.path}>{displayStudyName(item.name)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Tooltip>
                    <TooltipTrigger render={<Button variant="ghost" size="icon" className="path-copy sidebar-copy" onClick={() => void copyPatientPath()} aria-label="Copy patient folder path"><Copy /></Button>} />
                    <TooltipContent>{pathCopied ? "Copied" : "Copy folder path"}</TooltipContent>
                  </Tooltip>
                </div>
              </section>
              <section className="sidebar-structures">
                <div className="structure-header">Structures</div>
                <div className="structure-content">
                  {activeContours.length ? (
                    <ScrollArea className="structure-scroll">
                      <div className="structure-list">
                        {activeContours.map((item) => (
                          <label className="structure-item" key={item.id}>
                            <Checkbox checked={visible.has(item.id)} onCheckedChange={(checked) => setStructureVisible(item.id, checked === true)} />
                            <span className="structure-swatch" style={{ backgroundColor: `rgb(${item.rgb.join(",")})` }} />
                            <span className="structure-name" title={item.name}>{item.name}</span>
                          </label>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : <div className="structure-empty">No contours</div>}
                </div>
              </section>
            </aside>
          )}

          <div className="viewer-column">
            {libraryOpen ? (
              <section className="library-view" aria-label="Patient library">
                <div className="library-header">
                  <div className="library-heading-group">
                    <span className="library-heading">Patient library</span>
                    <span className="library-count">{libraryPatients.length} {libraryPatients.length === 1 ? "patient" : "patients"}</span>
                  </div>
                  <Button variant="outline" size="sm" className="toolbar-open" disabled={libraryBusy || loading} onClick={() => void addPatientFoldersToLibrary()}>
                    {libraryBusy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <FolderPlus data-icon="inline-start" />}
                    {libraryBusy ? "Indexing…" : "Add patients"}
                  </Button>
                </div>
                {libraryError && <div className="library-error" role="alert">{libraryError}</div>}
                {libraryBusy && libraryPatients.length === 0 ? (
                  <div className="library-empty"><LoaderCircle className="empty-spinner animate-spin" /> Loading library…</div>
                ) : libraryPatients.length ? (
                  <ScrollArea className="library-scroll">
                    <div className="library-list">
                      {libraryPatients.map((patient) => (
                        <div className="library-row" key={patient.path}>
                          <Button variant="ghost" size="sm" className="library-row-open" title={`Open ${patient.id}`} disabled={libraryBusy || loading} onClick={() => void openPatientPath(patient.path, true)}>
                            <User className="library-person-icon" aria-hidden="true" />
                            <span className="library-id">{patient.id}</span>
                          </Button>
                          <Tooltip>
                            <TooltipTrigger render={<Button variant="ghost" size="icon" className="library-copy-path" aria-label={`Copy folder path for ${patient.id}`} disabled={libraryBusy || loading} onClick={() => void copyLibraryPath(patient.path)}><Copy /></Button>} />
                            <TooltipContent>{copiedLibraryPath === patient.path ? "Copied" : "Copy folder path"}</TooltipContent>
                          </Tooltip>
                          <Button variant="ghost" size="sm" className="library-row-path" title={`Open ${patient.id}`} aria-label={`Open ${patient.id}`} disabled={libraryBusy || loading} onClick={() => void openPatientPath(patient.path, true)}>
                            <span className="library-path">{patient.path}</span>
                          </Button>
                          <Button variant="ghost" size="icon" className="library-delete" aria-label={`Delete ${patient.id} from library`} title="Delete from library" disabled={libraryBusy || loading} onClick={() => { setPendingLibraryRemoval(patient); setConfirmAction("remove-library"); }}>
                            <Trash2 />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="library-empty">No patients in the library. Add a patient folder or a folder containing patient folders.</div>
                )}
              </section>
            ) : folderOpen ? (
              <>
                <div className="viewer-toolbar">
                  <div className="window-control">
                    <span className="control-label">Window</span>
                    <Select value={windowPreset} disabled={loading} onValueChange={(value) => { if (value) void changeWindow(value); }}>
                      <SelectTrigger className="window-select"><SelectValue>{windowLabels[windowPreset] ?? "Soft tissue"}</SelectValue></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="soft">Soft tissue</SelectItem>
                        <SelectItem value="lung">Lung</SelectItem>
                        <SelectItem value="bone">Bone</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <ToggleGroup multiple={false} value={[mode]} onValueChange={(values) => { if (values[0]) setMode(values[0] as ViewMode); }} variant="outline" size="sm" spacing={0} className="mode-toggle" aria-label="Viewer layout">
                    <ToggleGroupItem value="all" aria-label="Show all planes">All</ToggleGroupItem>
                    <ToggleGroupItem value="axial" aria-label="Show axial plane">Axial</ToggleGroupItem>
                    <ToggleGroupItem value="coronal" aria-label="Show coronal plane">Coronal</ToggleGroupItem>
                    <ToggleGroupItem value="sagittal" aria-label="Show sagittal plane">Sagittal</ToggleGroupItem>
                  </ToggleGroup>
                </div>

                <div className={`viewport-grid layout-${mode}`}>
                  {axes.map((axis) => {
                    const max = axis === "axial" ? json?.meta.nz ?? 0 : axis === "coronal" ? json?.meta.rows ?? 0 : json?.meta.cols ?? 0;
                    const imageWidth = axis === "sagittal" ? json?.meta.rows ?? 0 : json?.meta.cols ?? 0;
                    const imageHeight = axis === "axial" ? json?.meta.rows ?? 0 : json?.meta.nz ?? 0;
                    const crossX = axis === "sagittal" ? slices.coronal : slices.sagittal;
                    const crossY = axis === "axial" ? slices.coronal : slices.axial;
                    const slice = slices[axis];
                    const sliceText = `${slice + 1} / ${max}`;
                    const label = axis === "axial" ? `${currentZ.toFixed(1)} mm · ${sliceText}` : sliceText;
                    return (
                      <Card className={`viewport-card ${mode !== "all" && mode !== axis ? "is-hidden" : ""}`} key={axis} data-axis={axis} onMouseDown={() => setActiveAxis(axis)}>
                        <div className="viewport-card-head">
                          <span className="viewport-name">{axisNames[axis]}</span>
                          <span className="viewport-index">{label}</span>
                        </div>
                        <div className="image-stage">
                          <div className="image-frame" ref={axis === "axial" ? frameAxial : axis === "coronal" ? frameCoronal : frameSagittal}>
                            <canvas id={`canvas-${axis}`} ref={axis === "axial" ? canvasAxial : axis === "coronal" ? canvasCoronal : canvasSagittal} className="image-canvas" aria-label={`${axisNames[axis]} CT slice`} />
                            <svg className="crosshair-overlay" viewBox={`0 0 ${imageWidth} ${imageHeight}`} preserveAspectRatio="none" aria-hidden="true">
                              <line x1="0" y1={crossY + 0.5} x2={imageWidth} y2={crossY + 0.5} stroke="#ffdc50" strokeOpacity="0.7" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                              <line x1={crossX + 0.5} y1="0" x2={crossX + 0.5} y2={imageHeight} stroke="#ffdc50" strokeOpacity="0.7" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                            </svg>
                          </div>
                          <span className="corner-label corner-tl">{axis === "axial" ? "R" : "S"}</span>
                          <span className="corner-label corner-tr">{axis === "axial" ? "A" : "R"}</span>
                          <span className="corner-label corner-bl">{axis === "axial" ? "P" : "I"}</span>
                          <span className="corner-label corner-br">L</span>
                        </div>
                        <div className="slice-control">
                          <Button variant="ghost" size="icon" className="slice-step" disabled={!max || loading} onClick={() => setSlices((prior) => ({ ...prior, [axis]: clamp(prior[axis] - 1, 0, Math.max(0, max - 1)) }))} aria-label={`Previous ${axisNames[axis]} slice`}><ChevronRight className="rotate-180" /></Button>
                          <Slider aria-label={`${axisNames[axis]} slice`} min={0} max={Math.max(0, max - 1)} step={1} value={[slice]} onValueChange={(value) => setSlices((prior) => ({ ...prior, [axis]: Number(Array.isArray(value) ? value[0] ?? 0 : value) }))} disabled={!max || loading} className="slice-slider" />
                          <Button variant="ghost" size="icon" className="slice-step" disabled={!max || loading} onClick={() => setSlices((prior) => ({ ...prior, [axis]: clamp(prior[axis] + 1, 0, Math.max(0, max - 1)) }))} aria-label={`Next ${axisNames[axis]} slice`}><ChevronRight /></Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="empty-stage" role="status" aria-live="polite">
                {loading && <LoaderCircle className="empty-spinner animate-spin" />}
                <span>{loading || status !== "No study open" ? status : "No study open"}</span>
              </div>
            )}
          </div>
        </section>

        <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
          <AlertDialogContent className="confirm-content">
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
              <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="confirm-footer">
              <AlertDialogCancel onClick={() => setConfirmAction(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction className="confirm-destructive" onClick={(event) => { event.preventDefault(); void confirm(); }}>
                {confirmAction === "exit" ? "Exit application" : confirmAction === "remove-library" ? "Remove from library" : "Close folder"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
          <DialogContent className="about-content">
            <DialogHeader className="about-header">
              <img className="about-brand-mark" src={radviewIcon} alt="" />
              <DialogTitle>RadView3D</DialogTitle>
              <DialogDescription>Version 1.0.1 · Elekta / CMS Monaco</DialogDescription>
            </DialogHeader>
            <div className="about-links">
              <Button variant="outline" size="sm" onClick={() => void openUrl("https://github.com/IamNishanKhan").catch((error) => setStatus(String(error)))}><ExternalLink /> GitHub</Button>
              <Button variant="outline" size="sm" onClick={() => void openUrl("https://www.nishankhan.me/").catch((error) => setStatus(String(error)))}><Globe2 /> Website</Button>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </TooltipProvider>
  );
}

export default App;
