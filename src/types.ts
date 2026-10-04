export interface StudyInfo {
  name: string;
  path: string;
  has_dicom: boolean;
  has_contournames: boolean;
}

export interface PatientLibraryEntry {
  id: string;
  path: string;
}

export interface StudyMeta {
  patient_id: string;
  study_name: string;
  rows: number;
  cols: number;
  nz: number;
  origin: [number, number, number];
  spacing: [number, number];
  slice_thickness: number;
  z_positions: number[];
}

export interface Structure {
  id: number;
  name: string;
  rgb: [number, number, number];
  opacity: number;
  type_id: number;
  contour_count: number;
}

export interface ContourRing {
  z_index: number;
  struct_id: number;
  points: [number, number][];
}

export interface StudyJson {
  meta: StudyMeta;
  structures: Structure[];
  contours: ContourRing[];
}

export type ViewMode = "all" | "axial" | "coronal" | "sagittal";
export type Axis = "axial" | "coronal" | "sagittal";

export const WINDOW_PRESETS: Record<string, { wl: number; ww: number; label: string }> = {
  soft: { wl: 40, ww: 400, label: "Soft" },
  lung: { wl: -500, ww: 1400, label: "Lung" },
  bone: { wl: 500, ww: 2000, label: "Bone" },
};
