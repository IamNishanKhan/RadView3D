use crate::{MonacoError, Result, StudyInfo};
use std::fs;
use std::path::Path;

pub fn list_studies(patient_dir: &Path) -> Result<Vec<StudyInfo>> {
    if !patient_dir.is_dir() {
        return Err(MonacoError::msg(format!(
            "Not a directory: {}",
            patient_dir.display()
        )));
    }

    let mut studies = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(patient_dir)?.filter_map(|e| e.ok()).collect();
    entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

    for entry in entries {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name.eq_ignore_ascii_case("plan") {
            continue;
        }

        let dcm = path.join("DCMData");
        let has_dicom = dcm.is_dir()
            && fs::read_dir(&dcm)
                .map(|rd| {
                    rd.filter_map(|e| e.ok()).any(|e| {
                        let n = e.file_name().to_string_lossy().to_ascii_lowercase();
                        n.ends_with(".dcm")
                    })
                })
                .unwrap_or(false);
        let has_contournames = path.join("contournames").is_file();
        if has_dicom || has_contournames {
            studies.push(StudyInfo {
                name,
                path: path.to_string_lossy().into_owned(),
                has_dicom,
                has_contournames,
            });
        }
    }

    if studies.is_empty() {
        // Allow opening a study folder directly.
        let dcm = patient_dir.join("DCMData");
        let has_dicom = dcm.is_dir();
        let has_contournames = patient_dir.join("contournames").is_file();
        if has_dicom || has_contournames {
            studies.push(StudyInfo {
                name: patient_dir
                    .file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "study".into()),
                path: patient_dir.to_string_lossy().into_owned(),
                has_dicom,
                has_contournames,
            });
        }
    }

    if studies.is_empty() {
        return Err(MonacoError::msg(
            "No Monaco CT studies found (expected */DCMData and contournames)",
        ));
    }
    Ok(studies)
}
