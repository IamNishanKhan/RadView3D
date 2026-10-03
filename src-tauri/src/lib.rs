mod state;

use radview_core::{list_studies, load_study, window::window_hu, StudyInfo, StudyJson};
use state::AppState;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::Response;
use tauri::State;

#[tauri::command]
fn list_patient_studies(path: String) -> Result<Vec<StudyInfo>, String> {
    list_studies(&PathBuf::from(path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_study_json(
    state: State<AppState>,
    study_path: String,
    wl: f32,
    ww: f32,
) -> Result<StudyJson, String> {
    let (loaded, volume_u8) =
        load_study(&PathBuf::from(&study_path), wl, ww).map_err(|e| e.to_string())?;
    let json = loaded.json.clone();
    *state.hu.lock().unwrap() = Some(loaded.hu);
    *state.labels.lock().unwrap() = Some(loaded.labels);
    *state.volume_u8.lock().unwrap() = Some(volume_u8);
    *state.wl_ww.lock().unwrap() = (wl, ww);
    Ok(json)
}

#[tauri::command]
fn get_volume_u8(state: State<AppState>) -> Result<Response, String> {
    let bytes = state
        .volume_u8
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No study loaded".to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn get_labels_u8(state: State<AppState>) -> Result<Response, String> {
    let bytes = state
        .labels
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No study loaded".to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn rewindow(state: State<AppState>, wl: f32, ww: f32) -> Result<Response, String> {
    let hu = state
        .hu
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No study loaded".to_string())?;
    let volume_u8 = window_hu(&hu, wl, ww);
    *state.volume_u8.lock().unwrap() = Some(volume_u8.clone());
    *state.wl_ww.lock().unwrap() = (wl, ww);
    Ok(Response::new(volume_u8))
}

#[tauri::command]
fn clear_study(state: State<AppState>) {
    *state.hu.lock().unwrap() = None;
    *state.labels.lock().unwrap() = None;
    *state.volume_u8.lock().unwrap() = None;
    *state.wl_ww.lock().unwrap() = (40.0, 400.0);
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            hu: Mutex::new(None),
            labels: Mutex::new(None),
            volume_u8: Mutex::new(None),
            wl_ww: Mutex::new((40.0, 400.0)),
        })
        .invoke_handler(tauri::generate_handler![
            list_patient_studies,
            load_study_json,
            get_volume_u8,
            get_labels_u8,
            rewindow,
            clear_study,
            exit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
