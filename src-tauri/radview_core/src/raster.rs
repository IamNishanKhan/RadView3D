use crate::dicom::CtVolume;
use crate::wc::WcFile;
use crate::ContourRing;

fn wc_to_pixel(x_wc: f64, z_wc: f64, origin: [f64; 3], spacing: [f64; 2]) -> [f32; 2] {
    let col = (x_wc - origin[0]) / spacing[0];
    let row = (-z_wc - origin[1]) / spacing[1];
    [col as f32, row as f32]
}

fn find_z_index(z_wc: f64, z_positions: &[f64], tol: f64) -> Option<usize> {
    if z_positions.is_empty() {
        return None;
    }
    let (idx, delta) = z_positions
        .iter()
        .enumerate()
        .map(|(i, z)| (i, (z - z_wc).abs()))
        .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))?;
    if delta <= tol {
        Some(idx)
    } else {
        None
    }
}

fn fill_polygon(mask: &mut [u8], rows: usize, cols: usize, pts: &[[f32; 2]], value: u8) {
    if pts.len() < 3 {
        return;
    }
    let mut y_min = f32::MAX;
    let mut y_max = f32::MIN;
    for p in pts {
        y_min = y_min.min(p[1]);
        y_max = y_max.max(p[1]);
    }
    let y0 = y_min.floor().max(0.0) as i32;
    let y1 = y_max.ceil().min((rows as f32) - 1.0) as i32;
    let n = pts.len();

    for y in y0..=y1 {
        let yf = y as f32;
        let mut xs: Vec<f32> = Vec::new();
        let mut j = n - 1;
        for i in 0..n {
            let y_a = pts[j][1];
            let y_b = pts[i][1];
            if (y_a <= yf && yf < y_b) || (y_b <= yf && yf < y_a) {
                let x_a = pts[j][0];
                let x_b = pts[i][0];
                let t = (yf - y_a) / (y_b - y_a + 1e-12);
                xs.push(x_a + t * (x_b - x_a));
            }
            j = i;
        }
        xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let mut k = 0;
        while k + 1 < xs.len() {
            let xa = xs[k].ceil().max(0.0) as i32;
            let xb = xs[k + 1].floor().min((cols as f32) - 1.0) as i32;
            if xa <= xb {
                let row_off = (y as usize) * cols;
                for x in xa..=xb {
                    mask[row_off + x as usize] = value;
                }
            }
            k += 2;
        }
    }
}

pub fn rasterise(
    wc_files: &[WcFile],
    volume: &CtVolume,
    z_tol: f64,
) -> (Vec<ContourRing>, Vec<u8>) {
    let rows = volume.rows;
    let cols = volume.cols;
    let nz = volume.nz;
    let mut labels = vec![0u8; nz * rows * cols];
    let mut contours = Vec::new();

    for wc in wc_files {
        let z_key = wc.z_from_name.unwrap_or(wc.z_header);
        let Some(zi) = find_z_index(z_key, &volume.z_positions, z_tol) else {
            continue;
        };
        let slice = &mut labels[zi * rows * cols..(zi + 1) * rows * cols];

        let mut items = wc.contours.clone();
        items.sort_by_key(|(id, _)| *id);

        for (sid, pts_mm) in items {
            if pts_mm.len() < 2 {
                continue;
            }
            let pts_px: Vec<[f32; 2]> = pts_mm
                .iter()
                .map(|p| wc_to_pixel(p[0], p[1], volume.origin, volume.spacing))
                .collect();
            contours.push(ContourRing {
                z_index: zi,
                struct_id: sid,
                points: pts_px.clone(),
            });
            if pts_px.len() >= 3 {
                fill_polygon(slice, rows, cols, &pts_px, sid);
            }
        }
    }

    (contours, labels)
}
