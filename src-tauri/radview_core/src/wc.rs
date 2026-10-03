use crate::Result;
use regex::Regex;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct NamedStructure {
    pub name: String,
    pub rgb: [u8; 3],
    pub opacity: u8,
    pub type_id: i32,
}

#[derive(Debug, Clone)]
pub struct WcFile {
    pub filename: String,
    pub z_from_name: Option<f64>,
    pub z_header: f64,
    pub contours: Vec<(u8, Vec<[f64; 2]>)>,
}

pub fn parse_wc_z_from_filename(name: &str) -> Option<f64> {
    let re = Regex::new(r"^T\.([+-]?\d+(?:\.\d+)?)\.WC$").ok()?;
    re.captures(name)
        .and_then(|c| c.get(1)?.as_str().parse().ok())
}

/// Timestamp-regex parser (VarietyOne). Avoids PTV expansion false positives.
pub fn parse_contournames(path: &Path) -> Result<HashMap<u8, NamedStructure>> {
    let mut out = HashMap::new();
    if !path.is_file() {
        return Ok(out);
    }
    let text = fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    let re = Regex::new(r"^(\d+),1\.000000,(\d+),(\d+),\d{8}\.\d+,").unwrap();

    for (i, line) in lines.iter().enumerate() {
        let Some(caps) = re.captures(line.trim()) else {
            continue;
        };
        let struct_id: u8 = match caps.get(1).unwrap().as_str().parse::<u16>() {
            Ok(v) if v > 0 && v < 256 => v as u8,
            _ => continue,
        };
        let type_id: i32 = caps.get(3).unwrap().as_str().parse().unwrap_or(1);

        let mut name_i = i as i32 - 1;
        while name_i >= 0 && lines[name_i as usize].trim().is_empty() {
            name_i -= 1;
        }
        if name_i < 0 {
            continue;
        }
        let name = lines[name_i as usize].trim().to_string();
        if name.is_empty() {
            continue;
        }

        let mut zero_zero = None;
        for j in (i + 1)..(i + 15).min(lines.len()) {
            if lines[j].trim() == "0,0" {
                zero_zero = Some(j);
                break;
            }
        }
        let Some(zz) = zero_zero else {
            continue;
        };
        let opacity = lines
            .get(zz + 1)
            .and_then(|s| s.trim().parse::<i32>().ok())
            .unwrap_or(50)
            .clamp(0, 100) as u8;
        let rgb = lines
            .get(zz + 2)
            .map(|s| {
                let p: Vec<i32> = s
                    .split(',')
                    .filter_map(|v| v.trim().parse().ok())
                    .collect();
                if p.len() >= 3 {
                    [
                        p[0].clamp(0, 255) as u8,
                        p[1].clamp(0, 255) as u8,
                        p[2].clamp(0, 255) as u8,
                    ]
                } else {
                    [200, 200, 200]
                }
            })
            .unwrap_or([200, 200, 200]);

        out.entry(struct_id).or_insert(NamedStructure {
            name,
            rgb,
            opacity,
            type_id,
        });
    }
    Ok(out)
}

pub fn parse_wc_file(path: &Path) -> Result<Option<WcFile>> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(_) => return Ok(None),
    };
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() < 8 {
        return Ok(None);
    }

    let origin_parts: Vec<f64> = lines[5]
        .split(',')
        .filter_map(|v| v.trim().parse().ok())
        .collect();
    if origin_parts.len() < 3 {
        return Ok(None);
    }
    let z_header = origin_parts[2];

    let mut contours = Vec::new();
    let mut idx = 7;
    while idx < lines.len() {
        let line = lines[idx].trim();
        if line == "0" {
            if idx + 2 < lines.len()
                && lines[idx + 1].trim() == "0"
                && lines[idx + 2].trim() == "0"
            {
                break;
            }
        }
        let Ok(n_points) = line.parse::<usize>() else {
            break;
        };
        if n_points == 0 {
            idx += if idx + 1 < lines.len() { 2 } else { 1 };
            continue;
        }
        idx += 1;
        if idx >= lines.len() {
            break;
        }
        let Ok(cms_id) = lines[idx].trim().parse::<u16>() else {
            break;
        };
        idx += 1;
        if cms_id == 0 || cms_id > 255 {
            // skip data
            continue;
        }

        let mut coords = Vec::new();
        while coords.len() < n_points * 2 && idx < lines.len() {
            let data_line = lines[idx].trim();
            idx += 1;
            if data_line.is_empty() {
                continue;
            }
            for v in data_line.replace(' ', "").split(',') {
                if v.is_empty() {
                    continue;
                }
                if let Ok(f) = v.parse::<f64>() {
                    coords.push(f);
                }
            }
        }
        if coords.len() >= n_points * 2 {
            let mut pts = Vec::with_capacity(n_points);
            for i in 0..n_points {
                pts.push([coords[i * 2], coords[i * 2 + 1]]);
            }
            contours.push((cms_id as u8, pts));
        }
    }

    let filename = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(Some(WcFile {
        z_from_name: parse_wc_z_from_filename(&filename),
        filename,
        z_header,
        contours,
    }))
}

pub fn load_all_wc(study_path: &Path) -> Result<Vec<WcFile>> {
    let mut files: Vec<PathBuf> = fs::read_dir(study_path)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .map(|n| {
                    let s = n.to_string_lossy();
                    s.starts_with("T.") && s.to_ascii_uppercase().ends_with(".WC")
                })
                .unwrap_or(false)
        })
        .collect();
    files.sort();
    let mut out = Vec::new();
    for path in files {
        if let Some(parsed) = parse_wc_file(&path)? {
            out.push(parsed);
        }
    }
    Ok(out)
}
