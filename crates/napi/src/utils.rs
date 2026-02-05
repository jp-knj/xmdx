//! Shared string and helper utilities.

use crate::types::ImportedModule;
use serde_json::Value as JsonValue;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub(crate) fn normalize_import_key(source: &str) -> String {
    let mut key = String::with_capacity(source.len());
    let mut in_single = false;
    let mut in_double = false;
    let mut in_backtick = false;
    let mut escape = false;

    for ch in source.chars() {
        if escape {
            key.push(ch);
            escape = false;
            continue;
        }

        if ch == '\\' && (in_single || in_double || in_backtick) {
            key.push(ch);
            escape = true;
            continue;
        }

        match ch {
            '\'' if !in_double && !in_backtick => {
                in_single = !in_single;
                key.push(ch);
            }
            '"' if !in_single && !in_backtick => {
                in_double = !in_double;
                key.push(ch);
            }
            '`' if !in_single && !in_double => {
                in_backtick = !in_backtick;
                key.push(ch);
            }
            ch if ch.is_whitespace() && !(in_single || in_double || in_backtick) => {}
            _ => key.push(ch),
        }
    }

    key
}

pub(crate) fn dedupe_imports(mut imports: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::with_capacity(imports.len());
    for import in imports.drain(..) {
        let key = normalize_import_key(&import);
        if seen.insert(key) {
            deduped.push(import);
        }
    }
    deduped
}

pub(crate) fn build_import_list(layout: Option<&str>, filepath: &Path) -> Vec<ImportedModule> {
    let mut imports = Vec::new();
    if let Some(layout_path) = layout {
        let resolved = filepath
            .parent()
            .map(|dir| dir.join(layout_path))
            .unwrap_or_else(|| PathBuf::from(layout_path));
        imports.push(ImportedModule {
            path: resolved.to_string_lossy().to_string(),
            kind: "layout".to_string(),
        });
    }
    imports
}

pub(crate) fn empty_frontmatter() -> JsonValue {
    JsonValue::Object(Default::default())
}
