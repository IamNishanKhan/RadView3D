import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openNativeFolder } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import radviewIcon from "./assets/radview3d-icon.png";
import {
  ChevronRight, Copy, ExternalLink, FolderClosed, FolderOpen,
  Globe2, Info, LoaderCircle,
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
import { fitCanvasToStage, paneAspectRatio, Renderer } from "./render";
import { WINDOW_PRESETS, type Axis, type StudyInfo, type StudyJson, type ViewMode } from "./types";

const axes: Axis[] = ["axial", "coronal", "sagittal"];
const axisNames: Record<Axis, string> = { axial: "Axial", coronal: "Coronal", sagittal: "Sagittal" };
const windowLabels: Record<string, string> = { soft: "Soft tissue", lung: "Lung", bone: "Bone" };
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

function displayStudyName(name: string): string {
  return name.match(/CT\d+/i)?.[0] ?? name;
}

function toU8(data: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (data instanceof Uint8Array) return new Uint8Array(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Uint8Array.from(data);
}

function App() {
  const canvasAxial = useRef<HTMLCanvasElement>(null);
  const canvasCoronal = useRef<HTMLCanvasElement>(null);
  const canvasSagittal = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const closingRef = useRef(false);
  const currentPatientPath = useRef<string | null>(null);
  const [studies, setStudies] = useState<StudyInfo[]>([]);
  const [studyPath, setStudyPath] = useState("");
  const [json, setJson] = useState<StudyJson | null>(null);
  const [volume, setVolume] = useState<Uint8Array>(new Uint8Array());
  const [labels, setLabels] = useState<Uint8Array>(new Uint8Array());
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [slices, setSlices] = useState<Record<Axis, number>>({ axial: 0, coronal: 0, sagittal: 0 });
  const [activeAxis, setActiveAxis] = useState<Axis>("axial");
  const [mode, setMode] = useState<ViewMode>("all");
  const [windowPreset, setWindowPreset] = useState("soft");
  const [loading, setLoading] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"close" | "exit" | null>(null);
  const [status, setStatus] = useState("No study open");
  const [pathCopied, setPathCopied] = useState(false);

  const folderOpen = Boolean(json && currentPatientPath.current);

  useEffect(() => {
    if (!folderOpen) return;
    if (!canvasAxial.current || !canvasCoronal.current || !canvasSagittal.current) return;
    renderer.current = new Renderer(canvasAxial.current, canvasCoronal.current, canvasSagittal.current);
    return () => {
      renderer.current?.clear();
      renderer.current = null;
    };
  }, [folderOpen]);

  useEffect(() => {
    if (!json || !renderer.current) return;
    renderer.current.setStudy({ volume, labels, json });
    const resizeHandlers = axes.map((axis) => {
      const canvas = axis === "axial" ? canvasAxial.current : axis === "coronal" ? canvasCoronal.current : canvasSagittal.current;
      return canvas ? fitCanvasToStage(canvas, paneAspectRatio(axis, json.meta)) : () => {};
    });
    return () => resizeHandlers.forEach((dispose) => dispose());
  }, [json, labels]);

  useEffect(() => {
    if (!json || !renderer.current) return;
    renderer.current.draw({ ax: slices.axial, cor: slices.coronal, sag: slices.sagittal, visible });
  }, [json, slices, visible, volume]);

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
        invoke<ArrayBuffer | Uint8Array | number[]>("get_volume_u8"),
        invoke<ArrayBuffer | Uint8Array | number[]>("get_labels_u8"),
      ]);
      setJson(loadedJson);
      setVolume(toU8(volBuffer));
      setLabels(toU8(labelBuffer));
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

  const openPatient = useCallback(async () => {
    try {
      const path = await openNativeFolder({
        title: "Open Monaco patient folder",
        directory: true,
        multiple: false,
      });
      if (!path) return;
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
      setStudyPath(preferred.path);
      setLoading(false);
      await loadStudy(preferred.path);
    } catch (error) {
      setLoading(false);
      setStatus(String(error));
    }
  }, [loadStudy]);

  const closeFolder = useCallback(async () => {
    setLoading(true);
    setStatus("Closing folder…");
    try {
      await invoke("clear_study");
      renderer.current?.clear();
      currentPatientPath.current = null;
      setStudies([]);
      setStudyPath("");
      setJson(null);
      setVolume(new Uint8Array());
      setLabels(new Uint8Array());
      setVisible(new Set());
      setStatus("No study open");
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
      renderer.current?.updateVolume(pixels);
      setVolume(pixels);
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
  const confirmTitle = confirmAction === "exit" ? "Exit RadView3D?" : "Close patient folder?";
  const confirmDescription = confirmAction === "exit"
    ? "The application will close and the current study will be cleared."
    : "The current study will be cleared from the viewer.";

  const confirm = async () => {
    const action = confirmAction;
    setConfirmAction(null);
    if (action === "close") await closeFolder();
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

  return (
    <TooltipProvider>
      <main className="app-shell">
        <header className="app-header">
          <div className="brand-lockup">
            <img className="brand-mark" src={radviewIcon} alt="" />
            <span className="brand-title">RadView3D</span>
          </div>

          <div className="header-actions">
            <Button variant="outline" size="sm" className="toolbar-open" disabled={loading} onClick={() => void openPatient()}>
              {loading ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <FolderOpen data-icon="inline-start" />}
              {loading ? "Opening…" : "Open folder"}
            </Button>
            {folderOpen && (
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon" className="toolbar-icon" disabled={loading} onClick={() => setConfirmAction("close")} aria-label="Close patient folder"><FolderClosed /></Button>} />
                <TooltipContent>Close folder</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon" className="toolbar-icon" onClick={() => setAboutOpen(true)} aria-label="About RadView3D"><Info /></Button>} />
              <TooltipContent>About</TooltipContent>
            </Tooltip>
          </div>
        </header>

        <section className={`workspace ${folderOpen ? "has-study" : "empty-workspace"}`}>
          {folderOpen && (
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
            {folderOpen ? (
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
                          <canvas id={`canvas-${axis}`} ref={axis === "axial" ? canvasAxial : axis === "coronal" ? canvasCoronal : canvasSagittal} className="image-canvas" aria-label={`${axisNames[axis]} CT slice`} />
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
                {confirmAction === "exit" ? "Exit application" : "Close folder"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
          <DialogContent className="about-content">
            <DialogHeader className="about-header">
              <img className="about-brand-mark" src={radviewIcon} alt="" />
              <DialogTitle>RadView3D</DialogTitle>
              <DialogDescription>Version 1.0.0 · Elekta / CMS Monaco</DialogDescription>
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
