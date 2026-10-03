use radview_core::{list_studies, load_study, LoadedStudy};
use std::env;
use std::path::PathBuf;

struct AlignCheck {
    zi: usize,
    contour_row0: f32,
    contour_row1: f32,
    hu_row0: usize,
    hu_row1: usize,
}

fn body_alignment(loaded: &LoadedStudy) -> Option<AlignCheck> {
    let m = &loaded.json.meta;
    let ring = loaded
        .json
        .contours
        .iter()
        .find(|c| c.struct_id == 1 && c.points.len() >= 8)?;
    let zi = ring.z_index;
    let rows: Vec<f32> = ring.points.iter().map(|p| p[1]).collect();
    let contour_row0 = rows.iter().copied().fold(f32::MAX, f32::min);
    let contour_row1 = rows.iter().copied().fold(f32::MIN, f32::max);
    let off = zi * m.rows * m.cols;
    let mut hu_row0 = m.rows;
    let mut hu_row1 = 0;
    for r in 0..m.rows {
        let mut any = false;
        for c in 0..m.cols {
            if loaded.hu[off + r * m.cols + c] > -150 {
                any = true;
                break;
            }
        }
        if any {
            hu_row0 = hu_row0.min(r);
            hu_row1 = r;
        }
    }
    Some(AlignCheck {
        zi,
        contour_row0,
        contour_row1,
        hu_row0,
        hu_row1,
    })
}

fn main() {
    let path = env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/home/bmlab/Desktop/Viewer/Monaco/1~20230127"));

    println!("Patient: {}", path.display());
    let studies = list_studies(&path).expect("list_studies");
    for s in &studies {
        println!(
            "  study {}  dicom={}  contournames={}  {}",
            s.name, s.has_dicom, s.has_contournames, s.path
        );
    }

    for s in studies {
        println!("\n=== Loading {} ===", s.name);
        match load_study(std::path::Path::new(&s.path), 40.0, 400.0) {
            Ok((loaded, vol_u8)) => {
                let m = &loaded.json.meta;
                println!(
                    "  volume {}x{}x{}  origin={:?}  spacing={:?}  dz={:.3}",
                    m.nz, m.rows, m.cols, m.origin, m.spacing, m.slice_thickness
                );
                println!(
                    "  HU range {}..{}  windowed mean {}",
                    loaded.hu.iter().copied().min().unwrap_or(0),
                    loaded.hu.iter().copied().max().unwrap_or(0),
                    vol_u8.iter().map(|&v| v as u32).sum::<u32>() / vol_u8.len().max(1) as u32
                );
                let labelled = loaded.labels.iter().filter(|&&v| v > 0).count();
                println!(
                    "  structures {}  contour rings {}  labelled voxels {}",
                    loaded.json.structures.len(),
                    loaded.json.contours.len(),
                    labelled
                );
                for st in &loaded.json.structures {
                    println!(
                        "    [{:>2}] {:<20} rings={:<4} rgb={:?}",
                        st.id, st.name, st.contour_count, st.rgb
                    );
                }
                if let Some(z0) = m.z_positions.first() {
                    if let Some(z1) = m.z_positions.last() {
                        println!("  Z {} → {} mm", z0, z1);
                    }
                }
                if let Some(check) = body_alignment(&loaded) {
                    println!("  alignment slice {}  body contour rows {:.0}→{:.0}  HU>-150 rows {}→{}",
                        check.zi, check.contour_row0, check.contour_row1, check.hu_row0, check.hu_row1);
                }
            }
            Err(e) => println!("  ERROR: {e}"),
        }
    }
}
