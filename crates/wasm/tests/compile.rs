use xmdx_wasm::compile;
use serde::Deserialize;
use wasm_bindgen_test::*;

#[derive(Deserialize, Debug)]
struct CompileResult {
    code: String,
    frontmatter_json: String,
    headings: Vec<HeadingEntry>,
    has_user_default_export: bool,
}

#[derive(Deserialize, Debug)]
struct HeadingEntry {
    depth: u8,
    slug: String,
    text: String,
}

#[wasm_bindgen_test]
fn compile_basic_markdown() {
    let source = "# Hello World\n\nThis is **bold** text.";
    let result = compile(source, "test.mdx").expect("compile should succeed");

    let result: CompileResult = serde_wasm_bindgen::from_value(result).expect("deserialize result");

    // Check code generation
    assert!(result.code.contains("import { Fragment, jsx as __jsx }"));
    assert!(result.code.contains("createComponent"));
    assert!(result.code.contains("export const frontmatter"));
    assert!(result.code.contains("export default xmdxContent"));

    // Check headings extracted
    assert_eq!(result.headings.len(), 1);
    assert_eq!(result.headings[0].depth, 1);
    assert_eq!(result.headings[0].slug, "hello-world");
    assert_eq!(result.headings[0].text, "Hello World");

    // Check frontmatter (empty)
    assert_eq!(result.frontmatter_json, "{}");

    // No user default export
    assert!(!result.has_user_default_export);
}

#[wasm_bindgen_test]
fn compile_with_frontmatter() {
    let source = "---\ntitle: My Page\ndraft: true\n---\n\n# Content";
    let result = compile(source, "page.mdx").expect("compile should succeed");

    let result: CompileResult = serde_wasm_bindgen::from_value(result).expect("deserialize result");

    // Check frontmatter is extracted
    assert!(result.frontmatter_json.contains("\"title\""));
    assert!(result.frontmatter_json.contains("My Page"));
    assert!(result.frontmatter_json.contains("\"draft\""));

    // Check code exports frontmatter
    assert!(result.code.contains("export const frontmatter ="));
}

#[wasm_bindgen_test]
fn compile_with_imports() {
    let source = "import Button from './Button.astro';\n\n# Hello\n\n<Button />";
    let result = compile(source, "test.mdx").expect("compile should succeed");

    let result: CompileResult = serde_wasm_bindgen::from_value(result).expect("deserialize result");

    // Check import is hoisted
    assert!(result.code.contains("import Button from './Button.astro'"));

    // Heading still extracted
    assert_eq!(result.headings.len(), 1);
}

#[wasm_bindgen_test]
fn compile_with_user_default_export() {
    let source = "export default function Layout({ children }) { return children; }\n\n# Hello";
    let result = compile(source, "test.mdx").expect("compile should succeed");

    let result: CompileResult = serde_wasm_bindgen::from_value(result).expect("deserialize result");

    // User provided default export
    assert!(result.has_user_default_export);

    // Should NOT have our default export
    assert!(!result.code.contains("export default xmdxContent"));
}

#[wasm_bindgen_test]
fn compile_multiple_headings() {
    let source = "# First\n\n## Second\n\n### Third\n\n## Another Second";
    let result = compile(source, "test.mdx").expect("compile should succeed");

    let result: CompileResult = serde_wasm_bindgen::from_value(result).expect("deserialize result");

    assert_eq!(result.headings.len(), 4);
    assert_eq!(result.headings[0].depth, 1);
    assert_eq!(result.headings[1].depth, 2);
    assert_eq!(result.headings[2].depth, 3);
    assert_eq!(result.headings[3].depth, 2);
}

#[wasm_bindgen_test]
fn compile_filepath_in_output() {
    let source = "# Test";
    let result = compile(source, "/path/to/file.mdx").expect("compile should succeed");

    let result: CompileResult = serde_wasm_bindgen::from_value(result).expect("deserialize result");

    // Check filepath is included
    assert!(result.code.contains("export const file ="));
    assert!(result.code.contains("/path/to/file.mdx"));
}
