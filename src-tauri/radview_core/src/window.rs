pub fn window_hu(hu: &[i16], wl: f32, ww: f32) -> Vec<u8> {
    let width = ww.max(1.0);
    let low = wl - width / 2.0;
    let high = wl + width / 2.0;
    let scale = 255.0 / (high - low);
    let mut out = vec![0u8; hu.len()];
    for (i, &v) in hu.iter().enumerate() {
        let x = (v as f32 - low) * scale;
        out[i] = x.clamp(0.0, 255.0) as u8;
    }
    out
}
