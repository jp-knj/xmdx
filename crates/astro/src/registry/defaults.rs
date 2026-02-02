//! Default registry configurations for common component libraries.
//!
//! This module provides pre-configured registry settings that can be used
//! as defaults when no custom registry is provided. The primary use case
//! is providing Starlight-compatible defaults for backward compatibility.

use super::types::{
    ComponentDefinition, DirectiveMapping, PropSource, RegistryConfig, SlotNormalization,
};
use std::collections::HashMap;

/// Creates the default Starlight registry configuration.
///
/// This registry includes:
/// - Common Starlight components (Aside, Tabs, Steps, FileTree, etc.)
/// - Directive mappings for :::note, :::tip, :::caution, etc.
/// - Slot normalization rules for Steps (wrap_in_ol) and FileTree (wrap_in_ul)
///
/// # Example
///
/// ```
/// use xmdx_astro::registry::defaults::default_starlight_registry;
///
/// let registry = default_starlight_registry();
/// assert!(registry.is_supported_directive("note"));
/// assert_eq!(registry.get_directive_component("note"), Some("Aside"));
/// ```
pub fn default_starlight_registry() -> RegistryConfig {
    RegistryConfig {
        components: vec![
            ComponentDefinition {
                name: "Aside".to_string(),
                module_path: "@astrojs/starlight/components".to_string(),
                export_type: "named".to_string(),
            },
            ComponentDefinition {
                name: "Tabs".to_string(),
                module_path: "@astrojs/starlight/components".to_string(),
                export_type: "named".to_string(),
            },
            ComponentDefinition {
                name: "TabItem".to_string(),
                module_path: "@astrojs/starlight/components".to_string(),
                export_type: "named".to_string(),
            },
            ComponentDefinition {
                name: "Steps".to_string(),
                module_path: "@astrojs/starlight/components".to_string(),
                export_type: "named".to_string(),
            },
            ComponentDefinition {
                name: "FileTree".to_string(),
                module_path: "@astrojs/starlight/components".to_string(),
                export_type: "named".to_string(),
            },
            ComponentDefinition {
                name: "CardGrid".to_string(),
                module_path: "@astrojs/starlight/components".to_string(),
                export_type: "named".to_string(),
            },
            ComponentDefinition {
                name: "LinkCard".to_string(),
                module_path: "@astrojs/starlight/components".to_string(),
                export_type: "named".to_string(),
            },
            ComponentDefinition {
                name: "LinkButton".to_string(),
                module_path: "@astrojs/starlight/components".to_string(),
                export_type: "named".to_string(),
            },
            ComponentDefinition {
                name: "Card".to_string(),
                module_path: "@astrojs/starlight/components".to_string(),
                export_type: "named".to_string(),
            },
        ],
        directive_mappings: vec![
            create_aside_mapping("note"),
            create_aside_mapping("tip"),
            create_aside_mapping("info"),
            create_aside_mapping("caution"),
            create_aside_mapping("warning"),
            create_aside_mapping("danger"),
        ],
        slot_normalizations: vec![
            SlotNormalization {
                component: "Steps".to_string(),
                strategy: "wrap_in_ol".to_string(),
                wrapper_class: None,
            },
            SlotNormalization {
                component: "FileTree".to_string(),
                strategy: "wrap_in_ul".to_string(),
                wrapper_class: None,
            },
        ],
    }
}

/// Creates a directive mapping for an Aside component with type injection.
fn create_aside_mapping(directive: &str) -> DirectiveMapping {
    let mut inject_props = HashMap::new();
    inject_props.insert(
        "type".to_string(),
        PropSource {
            source: "directive_name".to_string(),
            value: None,
        },
    );

    DirectiveMapping {
        directive: directive.to_string(),
        component: "Aside".to_string(),
        inject_props: Some(inject_props),
    }
}

/// Returns the list of directive names supported by the default Starlight registry.
///
/// This is useful for the directive preprocessing step to determine which
/// `:::name` patterns should be transformed.
pub fn default_supported_directives() -> &'static [&'static str] {
    &["note", "tip", "info", "caution", "warning", "danger"]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_registry_has_aside() {
        let registry = default_starlight_registry();
        assert!(
            registry
                .components
                .iter()
                .any(|c| c.name == "Aside" && c.module_path == "@astrojs/starlight/components")
        );
    }

    #[test]
    fn test_default_registry_directive_mappings() {
        let registry = default_starlight_registry();
        assert!(registry.is_supported_directive("note"));
        assert!(registry.is_supported_directive("tip"));
        assert!(registry.is_supported_directive("caution"));
        assert!(registry.is_supported_directive("danger"));
        assert!(!registry.is_supported_directive("unknown"));
    }

    #[test]
    fn test_default_registry_slot_normalizations() {
        let registry = default_starlight_registry();

        let steps = registry.get_slot_normalization("Steps");
        assert!(steps.is_some());
        assert_eq!(steps.unwrap().strategy, "wrap_in_ol");

        let filetree = registry.get_slot_normalization("FileTree");
        assert!(filetree.is_some());
        assert_eq!(filetree.unwrap().strategy, "wrap_in_ul");
        // wrapper_class is None to match original Starlight behavior
        assert_eq!(filetree.unwrap().wrapper_class, None);
    }

    #[test]
    fn test_directive_mapping_injects_type_prop() {
        let registry = default_starlight_registry();
        let mapping = registry.get_directive_mapping("note").unwrap();

        assert_eq!(mapping.component, "Aside");
        let inject = mapping.inject_props.as_ref().unwrap();
        let type_prop = inject.get("type").unwrap();
        assert_eq!(type_prop.source, "directive_name");
    }
}
