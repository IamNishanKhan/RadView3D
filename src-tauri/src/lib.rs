mod state;

use radview_core::{list_studies, load_study, window::window_hu, LoadedStudy, StudyInfo, StudyJson};
use serde::{Deserialize, Serialize};
use state::AppState;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::ipc::Response;
use tauri::{Manager, State};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PatientLibraryEntry {
    id: String,
    path: String,
}

fn patient_library_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("patient-library.json"))
}

fn read_patient_library(app: &tauri::AppHandle) -> Result<Vec<PatientLibraryEntry>, String> {
    let path = patient_library_file(app)?;
    match std::fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.to_string()),
    }
}

fn write_patient_library(
    app: &tauri::AppHandle,
    patients: &[PatientLibraryEntry],
) -> Result<(), String> {
    let path = patient_library_file(app)?;
    let contents = serde_json::to_vec_pretty(patients).map_err(|error| error.to_string())?;
    std::fs::write(path, contents).map_err(|error| error.to_string())
}

fn looks_like_patient_folder(path: &std::path::Path) -> bool {
    if path.join("DCMData").is_dir() || path.join("contournames").is_file() {
        return true;
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return false;
    };
    entries.filter_map(|entry| entry.ok()).any(|entry| {
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            return false;
        }
        let study_path = entry.path();
        study_path.join("DCMData").is_dir() || study_path.join("contournames").is_file()
    })
}

fn add_patient_folders(
    app: tauri::AppHandle,
    selected_path: String,
) -> Result<Vec<PatientLibraryEntry>, String> {
    let root = PathBuf::from(selected_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", root.display()));
    }

    let mut candidates = Vec::new();
    if looks_like_patient_folder(&root) {
        let id = root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Patient".into());
        candidates.push(PatientLibraryEntry {
            id,
            path: root.to_string_lossy().into_owned(),
        });
    } else {
        for entry in std::fs::read_dir(&root).map_err(|error| error.to_string())? {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                continue;
            }
            let patient_path = entry.path();
            let id = entry.file_name().to_string_lossy().into_owned();
            if id.starts_with('.') || id.eq_ignore_ascii_case("plan") {
                continue;
            }
            candidates.push(PatientLibraryEntry {
                id,
                path: patient_path.to_string_lossy().into_owned(),
            });
        }
    }

    if candidates.is_empty() {
        return Err("No patient folders were found in the selected directory.".into());
    }

    let mut patients = read_patient_library(&app)?;
    for candidate in candidates {
        if !patients
            .iter()
            .any(|patient| patient.path.eq_ignore_ascii_case(&candidate.path))
        {
            patients.push(candidate);
        }
    }
    patients.sort_by(|left, right| left.id.cmp(&right.id).then(left.path.cmp(&right.path)));
    write_patient_library(&app, &patients)?;
    Ok(patients)
}

#[tauri::command]
fn load_patient_library(app: tauri::AppHandle) -> Result<Vec<PatientLibraryEntry>, String> {
    read_patient_library(&app)
}

#[tauri::command]
async fn add_patient_folder_to_library(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<PatientLibraryEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || add_patient_folders(app, path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn remove_patient_from_library(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<PatientLibraryEntry>, String> {
    let mut patients = read_patient_library(&app)?;
    patients.retain(|patient| !patient.path.eq_ignore_ascii_case(&path));
    write_patient_library(&app, &patients)?;
    Ok(patients)
}

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
    let LoadedStudy { json, hu, labels } = loaded;
    *state.hu.lock().unwrap() = Some(Arc::new(hu));
    *state.labels.lock().unwrap() = Some(labels);
    *state.volume_u8.lock().unwrap() = Some(volume_u8);
    Ok(json)
}

#[tauri::command]
fn take_initial_volume_u8(state: State<AppState>) -> Result<Response, String> {
    let bytes = state
        .volume_u8
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "No initial volume is available".to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn take_initial_labels_u8(state: State<AppState>) -> Result<Response, String> {
    let bytes = state
        .labels
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "No initial labels are available".to_string())?;
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
    Ok(Response::new(volume_u8))
}

#[tauri::command]
fn clear_study(state: State<AppState>) {
    *state.hu.lock().unwrap() = None;
    *state.labels.lock().unwrap() = None;
    *state.volume_u8.lock().unwrap() = None;
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    unsafe {
        // WebView2 reads this before its controller's initial blank frame.
        // Keep the environment mutation before Tauri/WebView2 starts any threads.
        std::env::set_var("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "0xFF0B0E12");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            hu: Mutex::new(None),
            labels: Mutex::new(None),
            volume_u8: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            load_patient_library,
            add_patient_folder_to_library,
            remove_patient_from_library,
            list_patient_studies,
            load_study_json,
            take_initial_volume_u8,
            take_initial_labels_u8,
            rewindow,
            clear_study,
            exit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
