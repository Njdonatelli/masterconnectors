// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

use serde::Serialize;
use std::cmp::Ordering;
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const APP_DIR_NAME: &str = ".openloomi";
const SESSIONS_DIR_NAME: &str = "sessions";
const DECK_MANIFEST_FILE: &str = "manifest.json";
const DECK_SLIDES_DIR: &str = "slides";

const ARTIFACT_EXTENSIONS: &[&str] = &[
    "7z", "aac", "avi", "csv", "doc", "docx", "flac", "gif", "gz", "htm", "html", "jpeg", "jpg",
    "json", "m4a", "md", "markdown", "mkv", "mov", "mp3", "mp4", "ogg", "pdf", "png", "ppt",
    "pptx", "rar", "svg", "tar", "txt", "wav", "webm", "webp", "xls", "xlsx", "zip",
];

const FILTERED_ARTIFACT_NAMES: &[&str] = &[
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
];

const FILTERED_ARTIFACT_SUFFIXES: &[&str] = &[
    ".bare", ".cjs", ".d.cts", ".d.ts", ".lock", ".map", ".mjs", ".pdl", ".tmpl",
];

const TRAVERSAL_SKIP_DIRS: &[&str] = &[
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".next",
    ".nuxt",
    ".cache",
    ".venv",
    "venv",
    "vendor",
    "target",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceArtifact {
    id: String,
    name: String,
    #[serde(rename = "type")]
    artifact_type: String,
    path: String,
    created_at: u64,
    modified_at: u64,
    size: u64,
    kind: String,
    is_temporary: bool,
}

#[derive(Debug)]
struct WorkspaceEntry {
    name: String,
    relative_path: String,
    absolute_path: PathBuf,
    size: u64,
    is_directory: bool,
    modified_time: SystemTime,
    file_type: Option<String>,
}

fn home_dir() -> Result<PathBuf, String> {
    #[cfg(unix)]
    {
        std::env::var("HOME")
            .map(PathBuf::from)
            .map_err(|_| "HOME environment variable not set".to_string())
    }
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE")
            .map(PathBuf::from)
            .map_err(|_| "USERPROFILE environment variable not set".to_string())
    }
    #[cfg(not(any(unix, windows)))]
    {
        Err("Unsupported platform".to_string())
    }
}

fn is_safe_path_segment(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed == value
        && !trimmed.contains('/')
        && !trimmed.contains('\\')
        && !trimmed.contains("..")
        && !trimmed.to_ascii_lowercase().contains("%2f")
        && !trimmed.to_ascii_lowercase().contains("%5c")
}

fn normalize_execution_ids(execution_ids: Option<Vec<String>>) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for execution_id in execution_ids.unwrap_or_default() {
        if !is_safe_path_segment(&execution_id) {
            return Err("invalid_execution_id".to_string());
        }
        if !seen.insert(execution_id.clone()) {
            continue;
        }
        normalized.push(execution_id);
    }
    Ok(normalized)
}

fn session_dir_for_home(home: &Path, chat_id: &str) -> Result<PathBuf, String> {
    if !is_safe_path_segment(chat_id) {
        return Err("invalid_chat_id".to_string());
    }
    Ok(home
        .join(APP_DIR_NAME)
        .join(SESSIONS_DIR_NAME)
        .join(chat_id))
}

fn path_to_workspace_relative(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn is_temporary_workspace_path(path: &str) -> bool {
    path.split('/')
        .any(|segment| segment.eq_ignore_ascii_case("temp"))
}

fn should_hide_artifact_name(name: &str) -> bool {
    let lower_name = name.trim().to_ascii_lowercase();
    if lower_name.is_empty() {
        return true;
    }
    if FILTERED_ARTIFACT_NAMES.contains(&lower_name.as_str()) {
        return true;
    }
    FILTERED_ARTIFACT_SUFFIXES
        .iter()
        .any(|suffix| lower_name.ends_with(suffix))
}

fn extension_for_name(name: &str) -> Option<String> {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .filter(|ext| !ext.is_empty())
}

fn is_artifact_file(entry: &WorkspaceEntry, include_temporary: bool) -> bool {
    if should_hide_artifact_name(&entry.name) {
        return false;
    }
    if !include_temporary && is_temporary_workspace_path(&entry.relative_path) {
        return false;
    }
    entry
        .file_type
        .as_deref()
        .is_some_and(|ext| ARTIFACT_EXTENSIONS.contains(&ext))
}

fn classify_artifact(file_type: &str) -> String {
    match file_type {
        "html" | "htm" => "website",
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" => "image",
        "xls" | "xlsx" | "csv" => "spreadsheet",
        "ppt" | "pptx" => "slide-deck",
        "mp3" | "wav" | "ogg" | "m4a" | "aac" | "flac" => "audio",
        "mp4" | "webm" | "mov" | "avi" | "mkv" => "video",
        "zip" | "tar" | "gz" | "7z" | "rar" => "archive",
        "pdf" | "doc" | "docx" | "txt" | "md" | "markdown" => "document",
        _ => "other",
    }
    .to_string()
}

fn system_time_ms(value: SystemTime) -> u64 {
    value
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn decode_percent_segment(segment: &str) -> Option<String> {
    let bytes = segment.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return None;
            }
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
            let value = u8::from_str_radix(hex, 16).ok()?;
            decoded.push(value);
            i += 3;
        } else {
            decoded.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn is_valid_deck_relative_path(path: &str) -> bool {
    let candidate = path.trim();
    if candidate.is_empty()
        || candidate != path
        || candidate.contains('\0')
        || candidate.contains('\\')
        || candidate.starts_with('/')
        || candidate.starts_with("//")
        || candidate.contains('?')
        || candidate.contains('#')
        || candidate.contains(':')
    {
        return false;
    }

    candidate.split('/').all(|segment| {
        if segment.is_empty() {
            return false;
        }
        let Some(decoded) = decode_percent_segment(segment) else {
            return false;
        };
        decoded != "."
            && decoded != ".."
            && !decoded.contains('/')
            && !decoded.contains('\0')
            && !decoded.contains('\\')
            && !decoded.contains('?')
            && !decoded.contains('#')
    })
}

fn is_starry_slides_deck(abs_deck_dir: &Path) -> bool {
    let Ok(metadata) = fs::metadata(abs_deck_dir) else {
        return false;
    };
    if !metadata.is_dir() {
        return false;
    }

    let manifest_path = abs_deck_dir.join(DECK_MANIFEST_FILE);
    let slides_dir = abs_deck_dir.join(DECK_SLIDES_DIR);
    if !manifest_path.exists() || !slides_dir.is_dir() {
        return false;
    }

    let Ok(raw_manifest) = fs::read_to_string(&manifest_path) else {
        return false;
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw_manifest) else {
        return false;
    };
    let Some(slides) = parsed.get("slides").and_then(|value| value.as_array()) else {
        return false;
    };
    if slides.is_empty() {
        return false;
    }
    if !slides.iter().all(|entry| {
        entry
            .get("file")
            .and_then(|value| value.as_str())
            .is_some_and(is_valid_deck_relative_path)
    }) {
        return false;
    }

    fs::read_dir(slides_dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.to_ascii_lowercase().ends_with(".html"))
        })
}

fn read_deck_title(deck_root: &Path, fallback_name: &str) -> String {
    let manifest_path = deck_root.join(DECK_MANIFEST_FILE);
    let Ok(raw_manifest) = fs::read_to_string(manifest_path) else {
        return fallback_name.to_string();
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw_manifest) else {
        return fallback_name.to_string();
    };
    parsed
        .get("deckTitle")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(fallback_name)
        .to_string()
}

fn should_include_for_execution_scope(entry_path: &str, execution_ids: &[String]) -> bool {
    // Execution-scoped scans are strict. The session root is the normal chat
    // workspace and is only returned by chat-wide scans without execution ids.
    if execution_ids.is_empty() {
        return true;
    }

    execution_ids.iter().any(|execution_id| {
        entry_path == execution_id || entry_path.starts_with(&format!("{execution_id}/"))
    })
}

fn collect_workspace_entries(
    session_real_dir: &Path,
    current_path: &Path,
    relative_path: &Path,
    entries: &mut Vec<WorkspaceEntry>,
) {
    let Ok(read_dir) = fs::read_dir(current_path) else {
        return;
    };

    for entry in read_dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if file_type.is_dir() && TRAVERSAL_SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        let absolute_path = entry.path();
        let Ok(metadata) = fs::metadata(&absolute_path) else {
            continue;
        };
        let Ok(real_path) = fs::canonicalize(&absolute_path) else {
            continue;
        };
        if !real_path.starts_with(session_real_dir) {
            continue;
        }

        let child_relative = relative_path.join(&name);
        let relative_path_string = path_to_workspace_relative(&child_relative);
        if relative_path_string.is_empty() {
            continue;
        }

        let is_directory = file_type.is_dir() && metadata.is_dir();
        let is_file = metadata.is_file();
        entries.push(WorkspaceEntry {
            name: name.clone(),
            relative_path: relative_path_string,
            absolute_path: absolute_path.clone(),
            size: metadata.len(),
            is_directory,
            modified_time: metadata.modified().unwrap_or(UNIX_EPOCH),
            file_type: if is_file {
                extension_for_name(&name)
            } else {
                None
            },
        });

        if is_directory {
            collect_workspace_entries(session_real_dir, &absolute_path, &child_relative, entries);
        }
    }
}

fn latest_deck_modified_time(entry: &WorkspaceEntry, entries: &[WorkspaceEntry]) -> SystemTime {
    entries
        .iter()
        .filter(|candidate| {
            !candidate.is_directory && candidate.absolute_path.starts_with(&entry.absolute_path)
        })
        .map(|candidate| candidate.modified_time)
        .max()
        .unwrap_or(entry.modified_time)
}

fn build_deck_artifact(entry: &WorkspaceEntry, entries: &[WorkspaceEntry]) -> WorkspaceArtifact {
    let name = read_deck_title(&entry.absolute_path, &entry.name);
    let modified_time = latest_deck_modified_time(entry, entries);
    WorkspaceArtifact {
        id: format!("fs-deck-{}", entry.relative_path),
        name,
        artifact_type: "slide-deck".to_string(),
        path: entry.relative_path.clone(),
        created_at: system_time_ms(modified_time),
        modified_at: system_time_ms(modified_time),
        size: entry.size,
        kind: "slide-deck".to_string(),
        is_temporary: is_temporary_workspace_path(&entry.relative_path),
    }
}

fn build_file_artifact(entry: &WorkspaceEntry) -> WorkspaceArtifact {
    let artifact_type = entry
        .file_type
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    WorkspaceArtifact {
        id: format!("fs-{}", entry.relative_path),
        name: entry.name.clone(),
        kind: classify_artifact(&artifact_type),
        artifact_type,
        path: entry.relative_path.clone(),
        created_at: system_time_ms(entry.modified_time),
        modified_at: system_time_ms(entry.modified_time),
        size: entry.size,
        is_temporary: is_temporary_workspace_path(&entry.relative_path),
    }
}

fn list_workspace_artifacts_for_home(
    home: &Path,
    chat_id: &str,
    execution_ids: Option<Vec<String>>,
    include_temporary: bool,
) -> Result<Vec<WorkspaceArtifact>, String> {
    let session_dir = session_dir_for_home(home, chat_id)?;
    if !session_dir.exists() {
        return Ok(Vec::new());
    }

    let session_real_dir =
        fs::canonicalize(&session_dir).map_err(|e| format!("Failed to resolve session: {e}"))?;
    let execution_ids = normalize_execution_ids(execution_ids)?;

    let mut entries = Vec::new();
    collect_workspace_entries(&session_real_dir, &session_dir, Path::new(""), &mut entries);
    entries
        .retain(|entry| should_include_for_execution_scope(&entry.relative_path, &execution_ids));

    let mut artifacts = Vec::new();
    let mut deck_roots = Vec::new();
    let mut seen_paths = HashSet::new();

    for entry in entries.iter().filter(|entry| entry.is_directory) {
        if !is_starry_slides_deck(&entry.absolute_path) {
            continue;
        }
        let artifact = build_deck_artifact(entry, &entries);
        if !include_temporary && artifact.is_temporary {
            continue;
        }
        deck_roots.push(entry.absolute_path.clone());
        seen_paths.insert(artifact.path.clone());
        artifacts.push(artifact);
    }

    for entry in entries.iter().filter(|entry| !entry.is_directory) {
        if deck_roots
            .iter()
            .any(|deck_root| entry.absolute_path.starts_with(deck_root))
        {
            continue;
        }
        if !is_artifact_file(entry, include_temporary) {
            continue;
        }
        let artifact = build_file_artifact(entry);
        if !seen_paths.insert(artifact.path.clone()) {
            continue;
        }
        artifacts.push(artifact);
    }

    artifacts.sort_by(|a, b| match b.created_at.cmp(&a.created_at) {
        Ordering::Equal => a.path.cmp(&b.path),
        other => other,
    });

    Ok(artifacts)
}

#[tauri::command]
pub async fn list_workspace_artifacts(
    chat_id: String,
    execution_ids: Option<Vec<String>>,
    include_temporary: Option<bool>,
) -> Result<Vec<WorkspaceArtifact>, String> {
    crate::panic_guard::flatten_spawn_result(
        tauri::async_runtime::spawn_blocking(move || {
            crate::panic_guard::catch_unwind_result("list_workspace_artifacts", || {
                let home = home_dir()?;
                list_workspace_artifacts_for_home(
                    &home,
                    &chat_id,
                    execution_ids,
                    include_temporary.unwrap_or(false),
                )
            })
        })
        .await,
        "list_workspace_artifacts",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_home() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "openloomi-workspace-artifacts-{}-{unique}",
            std::process::id()
        ))
    }

    fn write_file(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    #[test]
    fn indexes_files_by_execution_and_hides_noise() {
        let home = test_home();
        let session = session_dir_for_home(&home, "chat").unwrap();
        write_file(&session.join("report.pdf"), "root");
        write_file(&session.join("exec-1").join("report.pptx"), "execution");
        write_file(&session.join("exec-2").join("notes.md"), "notes");
        write_file(
            &session.join("exec-1").join(".inputs").join("source.pdf"),
            "input",
        );
        write_file(&session.join("exec-1").join("package.json"), "{}");
        write_file(&session.join("exec-1").join("script.py"), "print(1)");

        let artifacts =
            list_workspace_artifacts_for_home(&home, "chat", Some(vec!["exec-1".into()]), false)
                .unwrap();

        let paths = artifacts
            .into_iter()
            .map(|artifact| artifact.path)
            .collect::<Vec<_>>();
        assert_eq!(paths, vec!["exec-1/report.pptx"]);

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn indexes_artifacts_under_build_output_directories() {
        let home = test_home();
        let session = session_dir_for_home(&home, "chat").unwrap();
        write_file(&session.join("build").join("report.pdf"), "build-report");
        write_file(&session.join("dist").join("index.html"), "<html></html>");
        write_file(
            &session.join("exec-1").join("dist").join("site.html"),
            "<html></html>",
        );

        let artifacts = list_workspace_artifacts_for_home(&home, "chat", None, false).unwrap();
        let mut paths = artifacts
            .into_iter()
            .map(|artifact| artifact.path)
            .collect::<Vec<_>>();
        paths.sort();
        assert_eq!(
            paths,
            vec![
                "build/report.pdf",
                "dist/index.html",
                "exec-1/dist/site.html"
            ]
        );

        let scoped_artifacts =
            list_workspace_artifacts_for_home(&home, "chat", Some(vec!["exec-1".into()]), false)
                .unwrap();
        let scoped_paths = scoped_artifacts
            .into_iter()
            .map(|artifact| artifact.path)
            .collect::<Vec<_>>();
        assert_eq!(scoped_paths, vec!["exec-1/dist/site.html"]);

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn promotes_decks_and_suppresses_internals() {
        let home = test_home();
        let session = session_dir_for_home(&home, "chat").unwrap();
        let deck = session.join("exec-1").join("deck");
        write_file(
            &deck.join("manifest.json"),
            r#"{"deckTitle":"Quarterly Review","slides":[{"file":"slides/slide-1.html"}]}"#,
        );
        write_file(&deck.join("slides").join("slide-1.html"), "<h1>Slide</h1>");

        let artifacts =
            list_workspace_artifacts_for_home(&home, "chat", Some(vec!["exec-1".into()]), false)
                .unwrap();

        assert_eq!(artifacts.len(), 1);
        assert_eq!(artifacts[0].id, "fs-deck-exec-1/deck");
        assert_eq!(artifacts[0].name, "Quarterly Review");
        assert_eq!(artifacts[0].artifact_type, "slide-deck");
        assert_eq!(artifacts[0].path, "exec-1/deck");

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn execution_scope_only_includes_requested_execution_directories() {
        let home = test_home();
        let session = session_dir_for_home(&home, "chat").unwrap();
        write_file(&session.join("legacy-report.pdf"), "legacy");
        write_file(&session.join("child-exec").join("report.pdf"), "child");

        let artifacts = list_workspace_artifacts_for_home(
            &home,
            "chat",
            Some(vec!["parent-missing".into(), "child-exec".into()]),
            false,
        )
        .unwrap();

        let paths = artifacts
            .into_iter()
            .map(|artifact| artifact.path)
            .collect::<Vec<_>>();
        assert_eq!(paths, vec!["child-exec/report.pdf"]);

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn execution_scope_does_not_fall_back_to_session_root() {
        let home = test_home();
        let session = session_dir_for_home(&home, "chat").unwrap();
        write_file(&session.join("legacy-report.pdf"), "legacy");

        let artifacts = list_workspace_artifacts_for_home(
            &home,
            "chat",
            Some(vec!["active-exec".into()]),
            false,
        )
        .unwrap();

        assert!(artifacts.is_empty());

        let _ = fs::remove_dir_all(home);
    }

    #[cfg(unix)]
    #[test]
    fn skips_symlinks_outside_session() {
        use std::os::unix::fs::symlink;

        let home = test_home();
        let outside = test_home();
        let session = session_dir_for_home(&home, "chat").unwrap();
        fs::create_dir_all(&session).unwrap();
        fs::create_dir_all(&outside).unwrap();
        write_file(&outside.join("outside.pdf"), "outside");
        symlink(outside.join("outside.pdf"), session.join("outside.pdf")).unwrap();

        let artifacts = list_workspace_artifacts_for_home(&home, "chat", None, false).unwrap();
        assert!(artifacts.is_empty());

        let _ = fs::remove_dir_all(home);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn rejects_invalid_execution_filters() {
        let home = test_home();
        let session = session_dir_for_home(&home, "chat").unwrap();
        write_file(&session.join("report.pdf"), "root");

        let result = list_workspace_artifacts_for_home(
            &home,
            "chat",
            Some(vec!["../outside".into()]),
            false,
        );

        assert_eq!(result.unwrap_err(), "invalid_execution_id");
        let _ = fs::remove_dir_all(home);
    }
}
