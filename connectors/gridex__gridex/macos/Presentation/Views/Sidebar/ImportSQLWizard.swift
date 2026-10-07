// ImportSQLWizard.swift
// Gridex
//
// Preview dialog shown after picking a .sql file for import.
// Displays file metadata and a syntax-highlighted preview of the first
// 100,000 characters before executing against the database.

import SwiftUI
import AppKit

/// Result returned from an SQL import run, displayed inline in the wizard.
struct ImportSQLResult {
    let success: Int
    let total: Int
    let firstError: String?

    var isSuccess: Bool { firstError == nil && success == total }
}

struct ImportSQLWizard: View {
    let fileURL: URL
    let onImport: (_ content: String) async -> ImportSQLResult

    @Environment(\.dismiss) private var dismiss
    @State private var encoding: String = "utf8"
    @State private var fileContent: String = ""
    @State private var fileSize: Int = 0
    @State private var loadError: String?
    @State private var isImporting: Bool = false
    @State private var importResult: ImportSQLResult?

    private let encodings = ["utf8", "ascii", "latin1", "utf16"]
    private let previewLimit = 100_000

    var body: some View {
        VStack(spacing: 0) {
            // Title
            Text("Import SQL Wizard")
                .font(.system(size: 14, weight: .semibold))
                .padding(.top, 16)
                .padding(.bottom, 12)

            Divider()

            // Header: encoding picker + file info
            HStack {
                Text("Encoding")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                Picker("", selection: $encoding) {
                    ForEach(encodings, id: \.self) { enc in
                        Text(enc).tag(enc)
                    }
                }
                .labelsHidden()
                .frame(width: 100)
                .onChange(of: encoding) { _, _ in loadFile() }

                Spacer()

                Text("\(fileURL.lastPathComponent)  ·  \(formattedSize)")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            HStack {
                Text("First 100,000 characters of the SQL file")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 6)

            // Preview
            if let loadError {
                VStack {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.title)
                        .foregroundStyle(.red)
                    Text(loadError)
                        .font(.system(size: 12))
                        .foregroundStyle(.red)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding()
            } else {
                SQLPreviewView(text: fileContent)
                    .padding(.horizontal, 16)
            }

            // Inline result banner (shown after clicking Import)
            if let result = importResult {
                Divider()
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: result.isSuccess ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(result.isSuccess ? .green : .orange)
                        .font(.system(size: 14))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(result.isSuccess
                             ? "✓ Imported \(result.success) statements successfully"
                             : "Imported \(result.success) / \(result.total) statements")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(result.isSuccess ? .green : .primary)
                        if let err = result.firstError {
                            Text("First error: \(err)")
                                .font(.system(size: 10))
                                .foregroundStyle(.red)
                                .lineLimit(3)
                                .textSelection(.enabled)
                        }
                    }
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(result.isSuccess
                            ? Color.green.opacity(0.08)
                            : Color.orange.opacity(0.08))
            }

            Divider()

            // Buttons
            HStack {
                if isImporting {
                    ProgressView().controlSize(.small)
                    Text("Importing…")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Close") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                    .pointerCursor()
                Button("Import") {
                    Task { await runImport() }
                }
                .buttonStyle(.borderedProminent)
                .pointerCursor()
                .disabled(fileContent.isEmpty || isImporting)
            }
            .padding(16)
        }
        .frame(width: 760, height: 600)
        .onAppear { loadFile() }
    }

    private func runImport() async {
        isImporting = true
        importResult = nil
        defer { isImporting = false }
        do {
            let full = try String(contentsOf: fileURL, encoding: stringEncoding)
            let result = await onImport(full)
            importResult = result
        } catch {
            loadError = "Failed to read file: \(error.localizedDescription)"
        }
    }

    private var stringEncoding: String.Encoding {
        switch encoding {
        case "ascii": return .ascii
        case "latin1": return .isoLatin1
        case "utf16": return .utf16
        default: return .utf8
        }
    }

    private var formattedSize: String {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useKB, .useMB]
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(fileSize))
    }

    private func loadFile() {
        loadError = nil
        do {
            let attrs = try FileManager.default.attributesOfItem(atPath: fileURL.path)
            fileSize = (attrs[.size] as? Int) ?? 0

            let fullContent = try String(contentsOf: fileURL, encoding: stringEncoding)
            // Only show first N characters in preview
            if fullContent.count > previewLimit {
                fileContent = String(fullContent.prefix(previewLimit))
            } else {
                fileContent = fullContent
            }
        } catch {
            loadError = "Failed to read file: \(error.localizedDescription)"
            fileContent = ""
        }
    }
}

// MARK: - Syntax-highlighted SQL preview

private struct SQLPreviewView: NSViewRepresentable {
    let text: String

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.borderType = .bezelBorder

        let textView = NSTextView()
        textView.isEditable = false
        textView.isSelectable = true
        textView.isRichText = false
        textView.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        textView.textContainerInset = NSSize(width: 8, height: 8)
        textView.backgroundColor = NSColor.textBackgroundColor
        textView.drawsBackground = true
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = true
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = false
        textView.textContainer?.containerSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )

        scrollView.documentView = textView
        applyText(to: textView)
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        if let textView = scrollView.documentView as? NSTextView {
            applyText(to: textView)
        }
    }

    private func applyText(to textView: NSTextView) {
        let attributed = highlightSQL(text)
        textView.textStorage?.setAttributedString(attributed)
    }

    private func highlightSQL(_ sql: String) -> NSAttributedString {
        let base = NSMutableAttributedString(
            string: sql,
            attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular),
                .foregroundColor: NSColor(white: 0.85, alpha: 1)
            ]
        )

        // Line numbers would add complexity — rely on SQL keyword highlighting + comments
        let nsText = sql as NSString
        let fullRange = NSRange(location: 0, length: nsText.length)

        // Comments (-- to end of line)
        if let commentRegex = try? NSRegularExpression(pattern: "--[^\\n]*") {
            commentRegex.enumerateMatches(in: sql, range: fullRange) { match, _, _ in
                if let r = match?.range {
                    base.addAttribute(.foregroundColor, value: NSColor.systemGreen, range: r)
                }
            }
        }

        // Strings 'single-quoted'
        if let stringRegex = try? NSRegularExpression(pattern: "'(?:[^']|'')*'") {
            stringRegex.enumerateMatches(in: sql, range: fullRange) { match, _, _ in
                if let r = match?.range {
                    base.addAttribute(.foregroundColor, value: NSColor.systemOrange, range: r)
                }
            }
        }

        // Double-quoted identifiers (highlighted subtly)
        if let idRegex = try? NSRegularExpression(pattern: "\"[^\"]*\"") {
            idRegex.enumerateMatches(in: sql, range: fullRange) { match, _, _ in
                if let r = match?.range {
                    base.addAttribute(.foregroundColor, value: NSColor.systemTeal, range: r)
                }
            }
        }

        // Keywords
        let keywords = [
            "CREATE", "TABLE", "SEQUENCE", "INDEX", "DROP", "IF", "NOT", "EXISTS",
            "INSERT", "INTO", "VALUES", "SELECT", "FROM", "WHERE", "AND", "OR",
            "UPDATE", "SET", "DELETE", "ALTER", "ADD", "COLUMN", "CONSTRAINT",
            "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "UNIQUE", "NULL", "DEFAULT",
            "ON", "CASCADE", "USING", "BTREE", "HASH", "GIN", "GIST",
            "BEGIN", "COMMIT", "ROLLBACK", "TRUE", "FALSE", "AS"
        ]
        let kwPattern = "\\b(" + keywords.joined(separator: "|") + ")\\b"
        if let kwRegex = try? NSRegularExpression(pattern: kwPattern, options: .caseInsensitive) {
            kwRegex.enumerateMatches(in: sql, range: fullRange) { match, _, _ in
                if let r = match?.range {
                    base.addAttribute(.foregroundColor, value: NSColor(red: 0.75, green: 0.45, blue: 0.9, alpha: 1), range: r)
                    base.addAttribute(.font, value: NSFont.monospacedSystemFont(ofSize: 11, weight: .semibold), range: r)
                }
            }
        }

        return base
    }
}
