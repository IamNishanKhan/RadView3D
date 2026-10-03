use crate::{MonacoError, Result};
use dicom_object::mem::InMemDicomObject;
use dicom_object::open_file;
use dicom_object::DefaultDicomObject;
use dicom_pixeldata::PixelDecoder;
use dicom_transfer_syntax_registry::entries::IMPLICIT_VR_LITTLE_ENDIAN;
use regex::Regex;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

pub struct CtVolume {
    pub hu: Vec<i16>,
    pub rows: usize,
    pub cols: usize,
    pub nz: usize,
    pub origin: [f64; 3],
    pub spacing: [f64; 2],
    pub slice_thickness: f64,
    pub z_positions: Vec<f64>,
}

struct SliceRec {
    z: f64,
    ipp: [f64; 3],
    spacing: [f64; 2],
    rows: usize,
    cols: usize,
    hu: Vec<i16>,
}

fn filename_z_dcm(path: &Path) -> Option<f64> {
    let name = path.file_name()?.to_string_lossy();
    let re = Regex::new(r"([+-]?\d+(?:\.\d+)?)\.CT\.DCM$").ok()?;
    re.captures(&name.to_ascii_uppercase())
        .and_then(|c| c.get(1)?.as_str().parse().ok())
}

fn filename_z_ct(path: &Path) -> Option<f64> {
    let name = path.file_name()?.to_string_lossy();
    let re = Regex::new(r"^T\.([+-]?\d+(?:\.\d+)?)\.CT$").ok()?;
    re.captures(&name)
        .and_then(|c| c.get(1)?.as_str().parse().ok())
}

fn parse_f64s(s: &str) -> Vec<f64> {
    s.split(['\\', '/', ','])
        .filter_map(|p| p.trim().parse::<f64>().ok())
        .collect()
}

fn obj_int(obj: &impl DicomLookup, name: &str) -> Option<i64> {
    obj.lookup_int(name)
}

fn obj_f64s(obj: &impl DicomLookup, name: &str) -> Vec<f64> {
    obj.lookup_f64s(name)
}

trait DicomLookup {
    fn lookup_int(&self, name: &str) -> Option<i64>;
    fn lookup_f64s(&self, name: &str) -> Vec<f64>;
    fn lookup_bytes(&self, name: &str) -> Option<Vec<u8>>;
}

impl DicomLookup for DefaultDicomObject {
    fn lookup_int(&self, name: &str) -> Option<i64> {
        self.element_by_name(name).ok()?.to_int().ok()
    }
    fn lookup_f64s(&self, name: &str) -> Vec<f64> {
        let Ok(el) = self.element_by_name(name) else {
            return Vec::new();
        };
        if let Ok(vals) = el.to_multi_float64() {
            return vals;
        }
        el.to_str()
            .ok()
            .map(|s| parse_f64s(&s))
            .unwrap_or_default()
    }
    fn lookup_bytes(&self, name: &str) -> Option<Vec<u8>> {
        self.element_by_name(name)
            .ok()?
            .to_bytes()
            .ok()
            .map(|b| b.into_owned())
    }
}

impl DicomLookup for InMemDicomObject<dicom_object::StandardDataDictionary> {
    fn lookup_int(&self, name: &str) -> Option<i64> {
        self.element_by_name(name).ok()?.to_int().ok()
    }
    fn lookup_f64s(&self, name: &str) -> Vec<f64> {
        let Ok(el) = self.element_by_name(name) else {
            return Vec::new();
        };
        if let Ok(vals) = el.to_multi_float64() {
            return vals;
        }
        el.to_str()
            .ok()
            .map(|s| parse_f64s(&s))
            .unwrap_or_default()
    }
    fn lookup_bytes(&self, name: &str) -> Option<Vec<u8>> {
        self.element_by_name(name)
            .ok()?
            .to_bytes()
            .ok()
            .map(|b| b.into_owned())
    }
}

fn slice_from_lookup(obj: &impl DicomLookup, path: &Path, pixels: Vec<i16>) -> Result<SliceRec> {
    let rows = obj_int(obj, "Rows").unwrap_or(512) as usize;
    let cols = obj_int(obj, "Columns").unwrap_or(512) as usize;
    let mut spacing = [1.0, 1.0];
    let ps = obj_f64s(obj, "PixelSpacing");
    if ps.len() >= 2 {
        spacing = [ps[1], ps[0]]; // [dx, dy]
    }
    let ipp_vals = obj_f64s(obj, "ImagePositionPatient");
    let ipp = if ipp_vals.len() >= 3 {
        [ipp_vals[0], ipp_vals[1], ipp_vals[2]]
    } else {
        [0.0, 0.0, filename_z_dcm(path).unwrap_or(0.0)]
    };
    let slope = obj_f64s(obj, "RescaleSlope").first().copied().unwrap_or(1.0);
    let intercept = obj_f64s(obj, "RescaleIntercept")
        .first()
        .copied()
        .unwrap_or(0.0);
    let hu: Vec<i16> = if (slope - 1.0).abs() < 1e-6 && intercept.abs() < 1e-6 {
        pixels
    } else {
        pixels
            .iter()
            .map(|&v| (v as f64 * slope + intercept).round() as i16)
            .collect()
    };
    if hu.len() != rows * cols {
        return Err(MonacoError::msg(format!(
            "{}: expected {} pixels, got {}",
            path.display(),
            rows * cols,
            hu.len()
        )));
    }
    Ok(SliceRec {
        z: ipp[2],
        ipp,
        spacing,
        rows,
        cols,
        hu,
    })
}

fn pixels_from_bytes(raw: &[u8], signed: bool) -> Vec<i16> {
    raw.chunks_exact(2)
        .map(|c| {
            let v = i16::from_le_bytes([c[0], c[1]]);
            if signed {
                v
            } else {
                u16::from_le_bytes([c[0], c[1]]) as i16
            }
        })
        .collect()
}

fn read_dicom_slice(path: &Path) -> Result<SliceRec> {
    if let Ok(obj) = open_file(path) {
        if let Ok(decoded) = obj.decode_pixel_data() {
            if let Ok(raw) = decoded.to_vec::<i16>() {
                return slice_from_lookup(&obj, path, raw);
            }
        }
    }

    let file = File::open(path)?;
    let obj = InMemDicomObject::read_dataset_with_ts(file, &IMPLICIT_VR_LITTLE_ENDIAN.erased())
        .map_err(|e| MonacoError::msg(format!("DICOM implicit {}: {e}", path.display())))?;
    let signed = obj_int(&obj, "PixelRepresentation").unwrap_or(1) == 1;
    let raw = obj
        .lookup_bytes("PixelData")
        .ok_or_else(|| MonacoError::msg(format!("{}: no PixelData", path.display())))?;
    let pixels = pixels_from_bytes(&raw, signed);
    slice_from_lookup(&obj, path, pixels)
}

fn stack_slices(mut slices: Vec<SliceRec>) -> Result<CtVolume> {
    if slices.is_empty() {
        return Err(MonacoError::msg("No readable CT slices"));
    }
    let (rows, cols) = {
        let mut counts = std::collections::HashMap::new();
        for s in &slices {
            *counts.entry((s.rows, s.cols)).or_insert(0) += 1;
        }
        counts.into_iter().max_by_key(|(_, n)| *n).unwrap().0
    };
    slices.retain(|s| s.rows == rows && s.cols == cols);
    slices.sort_by(|a, b| b.z.partial_cmp(&a.z).unwrap_or(std::cmp::Ordering::Equal));

    let nz = slices.len();
    let origin = slices[0].ipp;
    let spacing = slices[0].spacing;
    let slice_thickness = if nz > 1 {
        (slices[0].z - slices[1].z).abs()
    } else {
        1.0
    };
    let z_positions: Vec<f64> = slices.iter().map(|s| s.z).collect();
    let mut hu = vec![0i16; nz * rows * cols];
    for (zi, s) in slices.into_iter().enumerate() {
        let off = zi * rows * cols;
        hu[off..off + rows * cols].copy_from_slice(&s.hu);
    }
    Ok(CtVolume {
        hu,
        rows,
        cols,
        nz,
        origin,
        spacing,
        slice_thickness,
        z_positions,
    })
}

fn load_dicom_dir(dcm_dir: &Path) -> Result<Vec<SliceRec>> {
    let mut files: Vec<PathBuf> = fs::read_dir(dcm_dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .map(|n| n.to_string_lossy().to_ascii_lowercase().ends_with(".dcm"))
                .unwrap_or(false)
        })
        .collect();
    files.sort();
    let mut slices = Vec::new();
    for path in files {
        match read_dicom_slice(&path) {
            Ok(s) => slices.push(s),
            Err(e) => eprintln!("skip {}: {e}", path.display()),
        }
    }
    Ok(slices)
}

fn load_native_ct(study_path: &Path) -> Result<Vec<SliceRec>> {
    let mut files: Vec<PathBuf> = fs::read_dir(study_path)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .map(|n| {
                    let s = n.to_string_lossy();
                    s.starts_with("T.") && s.ends_with(".CT")
                })
                .unwrap_or(false)
        })
        .collect();
    files.sort();
    if files.is_empty() {
        return Err(MonacoError::msg("No T.*.CT files"));
    }

    let mut slices = Vec::new();
    for path in files {
        match read_native_ct(&path) {
            Ok(s) => slices.push(s),
            Err(e) => eprintln!("skip {}: {e}", path.display()),
        }
    }
    Ok(slices)
}

fn read_native_ct(path: &Path) -> Result<SliceRec> {
    let mut f = File::open(path)?;
    let mut raw = Vec::new();
    f.read_to_end(&mut raw)?;
    if raw.len() < 1024 + 2 {
        return Err(MonacoError::msg("CT file too small"));
    }
    let header_end = raw[..1024]
        .iter()
        .position(|&b| b == 0)
        .unwrap_or(1024);
    let header = String::from_utf8_lossy(&raw[..header_end]);
    let lines: Vec<&str> = header.lines().collect();

    let mut spacing = [1.0, 1.0];
    if let Some(line) = lines.get(21) {
        let ps = parse_f64s(line);
        if ps.len() >= 2 {
            spacing = [ps[0], ps[1]];
        }
    }
    let mut ipp = [0.0, 0.0, filename_z_ct(path).unwrap_or(0.0)];
    if let Some(line) = lines.get(25) {
        let vals = parse_f64s(line);
        // 1,x0,z0,slice_bmu_y
        if vals.len() >= 4 {
            ipp = [vals[1], vals[2], vals[3]];
        } else if vals.len() >= 3 {
            ipp = [vals[0], vals[1], vals[2]];
        }
    }

    let mut rows = 512;
    let mut cols = 512;
    if let Some(line) = lines.get(11) {
        let wh = parse_f64s(line);
        if wh.len() >= 2 {
            cols = wh[0] as usize;
            rows = wh[1] as usize;
        }
    }

    let expected = rows * cols;
    let pixels_be = &raw[1024..];
    if pixels_be.len() < expected * 2 {
        return Err(MonacoError::msg(format!(
            "{}: not enough pixels",
            path.display()
        )));
    }
    let hu: Vec<i16> = (0..expected)
        .map(|i| i16::from_be_bytes([pixels_be[i * 2], pixels_be[i * 2 + 1]]))
        .collect();

    Ok(SliceRec {
        z: ipp[2],
        ipp,
        spacing,
        rows,
        cols,
        hu,
    })
}

pub fn load_ct_volume(study_path: &Path) -> Result<CtVolume> {
    let dcm_dir = study_path.join("DCMData");
    let mut slices = if dcm_dir.is_dir() {
        load_dicom_dir(&dcm_dir)?
    } else {
        Vec::new()
    };
    if slices.is_empty() {
        slices = load_native_ct(study_path)?;
    }
    stack_slices(slices)
}
