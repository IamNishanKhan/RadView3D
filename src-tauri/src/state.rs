use std::sync::Mutex;

pub struct AppState {
    pub hu: Mutex<Option<Vec<i16>>>,
    pub labels: Mutex<Option<Vec<u8>>>,
    pub volume_u8: Mutex<Option<Vec<u8>>>,
    pub wl_ww: Mutex<(f32, f32)>,
}
