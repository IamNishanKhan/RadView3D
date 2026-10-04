pub mod detect;
pub mod dicom;
pub mod raster;
pub mod wc;
pub mod window;

use serde::{Deserialize, Serialize};
use std::path::Path;

pub const Z_TOLERANCE_MM: f64 = 0.11;

#[derive(Debug, thiserror::Error)]
pub enum MonacoError {
    #[error("{0}")]
    Message(String),
    #[error("IO: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, MonacoError>;

impl MonacoError {
    pub fn msg(s: impl Into<String>) -> Self {
        Self::Message(s.into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyInfo {
    pub name: String,
    pub path: String,
    pub has_dicom: bool,
    pub has_contournames: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyMeta {
    pub patient_id: String,
    pub study_name: String,
    pub rows: usize,
    pub cols: usize,
    pub nz: usize,
    pub origin: [f64; 3],
    pub spacing: [f64; 2],
    pub slice_thickness: f64,
    pub z_positions: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Structure {
    pub id: u8,
    pub name: String,
    pub rgb: [u8; 3],
    pub opacity: u8,
    pub type_id: i32,
    pub contour_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContourRing {
    pub z_index: usize,
    pub struct_id: u8,
    pub points: Vec<[f32; 2]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyJson {
    pub meta: StudyMeta,
    pub structures: Vec<Structure>,
    pub contours: Vec<ContourRing>,
}

pub struct LoadedStudy {
    pub json: StudyJson,
    pub hu: Vec<i16>,
    pub labels: Vec<u8>,
}

pub fn list_studies(patient_dir: &Path) -> Result<Vec<StudyInfo>> {
    detect::list_studies(patient_dir)
}

pub fn load_study(study_path: &Path, wl: f32, ww: f32) -> Result<(LoadedStudy, Vec<u8>)> {
    let _ = (wl, ww);
    let volume = dicom::load_ct_volume(study_path)?;
    let structures_map = wc::parse_contournames(&study_path.join("contournames"))?;
    let wc_slices = wc::load_all_wc(study_path)?;

    let (contours, labels) = raster::rasterise(
        &wc_slices,
        &volume,
        Z_TOLERANCE_MM,
    );

    let mut contour_counts = [0usize; 256];
    for contour in &contours {
        contour_counts[contour.struct_id as usize] += 1;
    }

    let mut structures: Vec<Structure> = structures_map
        .into_iter()
        .map(|(id, s)| Structure {
            id,
            name: s.name,
            rgb: s.rgb,
            opacity: s.opacity,
            type_id: s.type_id,
            contour_count: contour_counts[id as usize],
        })
        .collect();
    structures.sort_by_key(|s| s.id);

    // Include IDs that appear in WC but not contournames.
    let known: std::collections::HashSet<u8> = structures.iter().map(|s| s.id).collect();
    let mut extra: Vec<u8> = contours
        .iter()
        .map(|c| c.struct_id)
        .filter(|id| !known.contains(id))
        .collect();
    extra.sort_unstable();
    extra.dedup();
    for id in extra {
        structures.push(Structure {
            id,
            name: format!("Structure {id}"),
            rgb: default_rgb(id),
            opacity: 80,
            type_id: 1,
            contour_count: contour_counts[id as usize],
        });
    }

    let patient_id = study_path
        .parent()
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "unknown".into());
    let study_name = study_path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "study".into());

    let json = StudyJson {
        meta: StudyMeta {
            patient_id,
            study_name,
            rows: volume.rows,
            cols: volume.cols,
            nz: volume.nz,
            origin: volume.origin,
            spacing: volume.spacing,
            slice_thickness: volume.slice_thickness,
            z_positions: volume.z_positions.clone(),
        },
        structures,
        contours,
    };

    let loaded = LoadedStudy {
        json,
        hu: volume.hu,
        labels,
    };
    let volume_u8 = window::window_hu(&loaded.hu, wl, ww);
    Ok((loaded, volume_u8))
}

fn default_rgb(id: u8) -> [u8; 3] {
    const COLORS: [[u8; 3]; 12] = [
        [0, 255, 0],
        [192, 192, 192],
        [0, 128, 128],
        [255, 0, 0],
        [255, 165, 0],
        [128, 0, 128],
        [32, 255, 128],
        [255, 128, 192],
        [128, 150, 0],
        [255, 0, 255],
        [55, 55, 255],
        [255, 128, 0],
    ];
    COLORS[(id.saturating_sub(1) as usize) % COLORS.len()]
}
