use std::sync::{Arc, Mutex};

pub struct AppState {
    pub hu: Mutex<Option<Arc<Vec<i16>>>>,
    pub labels: Mutex<Option<Vec<u8>>>,
    pub volume_u8: Mutex<Option<Vec<u8>>>,
}
