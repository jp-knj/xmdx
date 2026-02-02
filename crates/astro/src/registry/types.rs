//! Registry type definitions for component and directive mappings.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Configuration for the component registry passed from JavaScript.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RegistryConfig {
    /// Available components.
    pub components: Vec<ComponentDefinition>,
    /// Directive to component mappings.
    pub directive_mappings: Vec<DirectiveMapping>,
    /// Slot normalization rules for components like Steps, FileTree.
    #[serde(default)]
    pub slot_normalizations: Vec<SlotNormalization>,
}

/// A single component definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentDefinition {
    /// Component name (e.g., "Aside", "Tabs").
    pub name: String,
    /// Module path for import (e.g., "@astrojs/starlight/components").
    pub module_path: String,
    /// Export type: "named" or "default".
    pub export_type: String,
}

/// Deprecated alias for `ComponentDefinition`.
///
/// Use `ComponentDefinition` instead for new code.
#[deprecated(since = "0.5.0", note = "Use ComponentDefinition instead")]
pub type ComponentDef = ComponentDefinition;

/// Slot normalization configuration for components that require specific slot structures.
///
/// Some components (like Starlight's Steps and FileTree) require their slot content
/// to be wrapped in specific HTML structures. This configuration allows the registry
/// to define these requirements without hardcoding them in the core renderer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotNormalization {
    /// Component name this normalization applies to (e.g., "Steps", "FileTree").
    pub component: String,
    /// Normalization strategy to apply.
    /// - "wrap_in_ol": Wrap content in a single `<ol>` element
    /// - "wrap_in_ul": Wrap content in a single `<ul>` element
    pub strategy: String,
    /// Optional CSS class to add to the wrapper element.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wrapper_class: Option<String>,
}

/// Mapping from a directive name to a component.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectiveMapping {
    /// Directive name (e.g., "note", "tip").
    pub directive: String,
    /// Target component name (e.g., "Aside").
    pub component: String,
    /// Optional props to inject when mapping.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inject_props: Option<HashMap<String, PropSource>>,
}

/// Source for an injected prop value.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropSource {
    /// Source type: "directive_name", "bracket_title", or "literal".
    pub source: String,
    /// Literal value when source is "literal".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

impl RegistryConfig {
    /// Check if a directive name is supported.
    pub fn is_supported_directive(&self, name: &str) -> bool {
        self.directive_mappings.iter().any(|m| m.directive == name)
    }

    /// Get the component name for a directive.
    pub fn get_directive_component(&self, directive: &str) -> Option<&str> {
        self.directive_mappings
            .iter()
            .find(|m| m.directive == directive)
            .map(|m| m.component.as_str())
    }

    /// Get the module path for a component.
    pub fn get_component_module(&self, name: &str) -> Option<&str> {
        self.components
            .iter()
            .find(|c| c.name == name)
            .map(|c| c.module_path.as_str())
    }

    /// Get the full directive mapping for a directive name.
    pub fn get_directive_mapping(&self, directive: &str) -> Option<&DirectiveMapping> {
        self.directive_mappings
            .iter()
            .find(|m| m.directive == directive)
    }

    /// Get slot normalization configuration for a component.
    pub fn get_slot_normalization(&self, component: &str) -> Option<&SlotNormalization> {
        self.slot_normalizations
            .iter()
            .find(|n| n.component == component)
    }
}
