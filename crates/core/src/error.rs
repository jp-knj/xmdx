use thiserror::Error;

/// Source location information for error reporting
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceLocation {
    /// Optional file path
    pub file: Option<String>,
    /// Line number (1-indexed)
    pub line: usize,
    /// Column number (1-indexed)
    pub column: usize,
}

impl SourceLocation {
    /// Create a new source location
    pub fn new(line: usize, column: usize) -> Self {
        Self {
            file: None,
            line,
            column,
        }
    }

    /// Create a source location with file information
    pub fn with_file(file: String, line: usize, column: usize) -> Self {
        Self {
            file: Some(file),
            line,
            column,
        }
    }
}

impl std::fmt::Display for SourceLocation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(file) = &self.file {
            write!(f, "{}:{}:{}", file, self.line, self.column)
        } else {
            write!(f, "{}:{}", self.line, self.column)
        }
    }
}

/// Errors that can occur during Markdown processing.
#[derive(Debug, Error)]
pub enum MarkflowError {
    /// IO error during streaming.
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    /// UTF-8 encoding error.
    #[error("Encoding error: {0}")]
    EncodingError(#[from] std::string::FromUtf8Error),
    /// markdown-rs parser error surfaced through the adapter.
    #[error("Parse error at {location}: {message}")]
    MarkdownAdapter {
        /// Error message
        message: String,
        /// Source location
        location: SourceLocation,
    },
    /// Rendering error while emitting HTML/JSX.
    #[error("Render error at {location}: {message}")]
    RenderError {
        /// Error message
        message: String,
        /// Source location
        location: SourceLocation,
    },
    /// Unknown component or directive encountered.
    #[error("Unknown component at {location}: {name}")]
    UnknownComponent {
        /// Component name
        name: String,
        /// Source location
        location: SourceLocation,
    },
    /// Internal logic error (unexpected state).
    #[error("Internal error: {0}")]
    InternalError(String),
}

impl MarkflowError {
    /// Create a parse error with location
    pub fn parse_error(message: impl Into<String>, line: usize, column: usize) -> Self {
        Self::MarkdownAdapter {
            message: message.into(),
            location: SourceLocation::new(line, column),
        }
    }

    /// Create a render error with location
    pub fn render_error(message: impl Into<String>, line: usize, column: usize) -> Self {
        Self::RenderError {
            message: message.into(),
            location: SourceLocation::new(line, column),
        }
    }

    /// Create an unknown component error with location
    pub fn unknown_component(name: impl Into<String>, line: usize, column: usize) -> Self {
        Self::UnknownComponent {
            name: name.into(),
            location: SourceLocation::new(line, column),
        }
    }
}

/// Non-fatal warnings that don't prevent rendering
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseWarning {
    /// Code fence opened but never closed
    UnclosedCodeFence {
        /// Source location where the fence started
        location: SourceLocation,
        /// Fence marker character (backtick or tilde)
        marker: char,
        /// Surrounding context for error message
        context: String,
    },
    /// Other potential warnings for future use
    SuspiciousMarkup {
        /// Source location where the suspicious markup was found
        location: SourceLocation,
        /// Warning message
        message: String,
    },
}

impl ParseWarning {
    /// Get the location of this warning
    pub fn location(&self) -> &SourceLocation {
        match self {
            ParseWarning::UnclosedCodeFence { location, .. } => location,
            ParseWarning::SuspiciousMarkup { location, .. } => location,
        }
    }
}

impl std::fmt::Display for ParseWarning {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseWarning::UnclosedCodeFence {
                location,
                marker,
                context,
            } => {
                write!(
                    f,
                    "Unclosed code fence ({}): {}, near '{}'",
                    marker, location, context
                )
            }
            ParseWarning::SuspiciousMarkup { location, message } => {
                write!(f, "{}: {}", location, message)
            }
        }
    }
}

/// Recoverable error information
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoverableError {
    /// Error message
    pub message: String,
    /// Source location
    pub location: SourceLocation,
    /// Error severity
    pub severity: ErrorSeverity,
}

/// Error severity level
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorSeverity {
    /// Error that was recovered from
    Error,
    /// Warning that doesn't prevent rendering
    Warning,
}

impl RecoverableError {
    /// Create a new recoverable error
    pub fn error(message: impl Into<String>, line: usize, column: usize) -> Self {
        Self {
            message: message.into(),
            location: SourceLocation::new(line, column),
            severity: ErrorSeverity::Error,
        }
    }

    /// Create a new warning
    pub fn warning(message: impl Into<String>, line: usize, column: usize) -> Self {
        Self {
            message: message.into(),
            location: SourceLocation::new(line, column),
            severity: ErrorSeverity::Warning,
        }
    }
}

impl std::fmt::Display for RecoverableError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let severity = match self.severity {
            ErrorSeverity::Error => "error",
            ErrorSeverity::Warning => "warning",
        };
        write!(f, "{} at {}: {}", severity, self.location, self.message)
    }
}

/// Collection of parse diagnostics (warnings and recoverable errors)
#[derive(Debug, Clone, Default)]
pub struct ParseDiagnostics {
    /// List of non-fatal warnings
    pub warnings: Vec<ParseWarning>,
    /// List of recoverable errors
    pub errors: Vec<RecoverableError>,
}

impl ParseDiagnostics {
    /// Create a new empty diagnostics collection
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a warning to the diagnostics collection
    pub fn add_warning(&mut self, warning: ParseWarning) {
        self.warnings.push(warning);
    }

    /// Add a recoverable error to the diagnostics collection
    pub fn add_error(&mut self, error: RecoverableError) {
        self.errors.push(error);
    }

    /// Add an error with location
    pub fn add_error_at(&mut self, message: impl Into<String>, line: usize, column: usize) {
        self.errors
            .push(RecoverableError::error(message, line, column));
    }

    /// Add a warning with location
    pub fn add_warning_at(&mut self, message: impl Into<String>, line: usize, column: usize) {
        self.warnings.push(ParseWarning::SuspiciousMarkup {
            location: SourceLocation::new(line, column),
            message: message.into(),
        });
    }

    /// Check if there are any warnings
    pub fn has_warnings(&self) -> bool {
        !self.warnings.is_empty()
    }

    /// Check if there are any errors
    pub fn has_errors(&self) -> bool {
        !self.errors.is_empty()
    }

    /// Check if there are any diagnostics
    pub fn has_any(&self) -> bool {
        self.has_warnings() || self.has_errors()
    }

    /// Get total count of all diagnostics
    pub fn count(&self) -> usize {
        self.warnings.len() + self.errors.len()
    }
}
