// FunctionDetailView.swift
// Gridex
//
// Displays and edits a database function's source code.

import SwiftUI
import AppKit

struct FunctionDetailView: View {
    let functionName: String
    let schema: String?
    var isProcedure: Bool = false

    @EnvironmentObject private var appState: AppState
    @State private var originalSource: String = ""
    @State private var editedSource: String = ""
    @State private var parameters: [String] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var isCommitting = false
    @State private var commitError: String?
    @State private var showCommitSuccess = false

    private var isDirty: Bool {
        editedSource != originalSource
    }

    private var routineKind: String {
        isProcedure ? "procedure" : "function"
    }

    var body: some View {
        VStack(spacing: 0) {
            headerBar
            Divider()
            contentArea
        }
        .task {
            await loadSource()
        }
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack(spacing: 8) {
            Image(systemName: isProcedure ? "play.square" : "function")
                .font(.system(size: 12))
                .foregroundStyle(isProcedure ? .green : .blue)

            Text(functionName)
                .font(.system(size: 12, weight: .medium))
                .textSelection(.enabled)

            if isDirty {
                Text("Modified")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.orange)
                    .clipShape(Capsule())
            }

            Spacer()

            if let error = commitError {
                Text(error)
                    .font(.system(size: 11))
                    .foregroundStyle(.red)
                    .lineLimit(1)
            }

            if showCommitSuccess {
                HStack(spacing: 3) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 10))
                    Text("Saved")
                        .font(.system(size: 11))
                }
                .foregroundStyle(.green)
            }

            // Execute button (procedures only) — opens a new Query tab with EXEC template
            if isProcedure && !editedSource.isEmpty {
                Button(action: generateAndOpenExecTemplate) {
                    HStack(spacing: 4) {
                        Image(systemName: "play.fill")
                            .font(.system(size: 10))
                        Text("Execute")
                            .font(.system(size: 11, weight: .medium))
                    }
                }
                .buttonStyle(.plain)
                .foregroundStyle(.green)
                .help("Open a new Query tab with EXEC template")
            }

            if !editedSource.isEmpty {
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(editedSource, forType: .string)
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "doc.on.doc")
                            .font(.system(size: 10))
                        Text("Copy")
                            .font(.system(size: 11))
                    }
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)

                if isDirty {
                    Button {
                        editedSource = originalSource
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.uturn.backward")
                                .font(.system(size: 10))
                            Text("Revert")
                                .font(.system(size: 11))
                        }
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)

                    Button {
                        Task { await commitChanges() }
                    } label: {
                        HStack(spacing: 4) {
                            if isCommitting {
                                ProgressView()
                                    .scaleEffect(0.5)
                                    .frame(width: 10, height: 10)
                            } else {
                                Image(systemName: "checkmark.circle")
                                    .font(.system(size: 10))
                            }
                            Text("Commit")
                                .font(.system(size: 11, weight: .medium))
                        }
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.accentColor)
                    .disabled(isCommitting)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    // MARK: - Content

    @ViewBuilder
    private var contentArea: some View {
        if isLoading {
            VStack {
                Spacer()
                ProgressView()
                    .scaleEffect(0.8)
                Text("Loading \(routineKind) source...")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = errorMessage {
            VStack {
                Spacer()
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 24))
                    .foregroundStyle(.secondary)
                Text(error)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if editedSource.isEmpty {
            VStack {
                Spacer()
                Image(systemName: "doc.text")
                    .font(.system(size: 24))
                    .foregroundStyle(.secondary)
                Text("No source code available")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VStack(spacing: 0) {
                if isProcedure && !parameters.isEmpty {
                    parameterSignatureBar
                    Divider()
                }
                FunctionCodeEditor(text: $editedSource)
            }
        }
    }

    /// Compact parameter signature bar shown above the procedure source.
    private var parameterSignatureBar: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Image(systemName: "list.bullet.rectangle")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                Text("Parameters (\(parameters.count))")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.secondary)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 6)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(parameters, id: \.self) { param in
                        Text(param)
                            .font(.system(size: 11, design: .monospaced))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.primary.opacity(0.06))
                            .clipShape(RoundedRectangle(cornerRadius: 3))
                            .textSelection(.enabled)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 6)
            }
        }
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.5))
    }

    // MARK: - Actions

    private func loadSource() async {
        isLoading = true
        errorMessage = nil

        guard let adapter = appState.activeAdapter else {
            errorMessage = "No active connection"
            isLoading = false
            return
        }

        do {
            let source: String
            if isProcedure {
                source = try await adapter.getProcedureSource(name: functionName, schema: schema)
                // Fetch parameter signature in parallel (best-effort — ignore errors)
                parameters = (try? await adapter.listProcedureParameters(name: functionName, schema: schema)) ?? []
            } else {
                source = try await adapter.getFunctionSource(name: functionName, schema: schema)
            }
            originalSource = source
            editedSource = source
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    /// Generate an EXEC template (e.g. "EXEC [dbo].[procname] @p1 = NULL, @p2 = NULL;")
    /// and open it in a new query editor tab, ready for the user to fill in values.
    private func generateAndOpenExecTemplate() {
        let schemaName = schema ?? "dbo"
        var sql = "EXEC [\(schemaName)].[\(functionName)]"

        // Parse param names from signature strings like "@p1 INT INPUT" or "@name NVARCHAR(100)"
        let paramAssignments: [String] = parameters.compactMap { sig in
            // First token is the @name
            let firstToken = sig.split(separator: " ", maxSplits: 1).first.map(String.init) ?? sig
            guard firstToken.hasPrefix("@") else { return nil }
            let isOutput = sig.uppercased().contains("OUTPUT")
            return "    \(firstToken) = NULL\(isOutput ? " OUTPUT" : "")"
        }

        if !paramAssignments.isEmpty {
            sql += "\n" + paramAssignments.joined(separator: ",\n")
        }
        sql += ";"

        // Open a new query tab with the template pre-filled
        appState.openNewQueryTab()
        if let tabId = appState.activeTabId {
            appState.queryEditorText[tabId] = sql
            // Notify the query editor view to sync (it reads from queryEditorText on appear)
            NotificationCenter.default.post(
                name: .init("pasteQueryToEditor"),
                object: nil,
                userInfo: ["sql": sql]
            )
        }
    }

    private func commitChanges() async {
        guard let adapter = appState.activeAdapter else { return }
        isCommitting = true
        commitError = nil
        showCommitSuccess = false

        do {
            _ = try await adapter.executeRaw(sql: editedSource)
            originalSource = editedSource
            isCommitting = false
            showCommitSuccess = true
            Task {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                showCommitSuccess = false
            }
        } catch {
            commitError = error.localizedDescription
            isCommitting = false
        }
    }
}

// MARK: - Code editor with line numbers + syntax highlighting

struct FunctionCodeEditor: View {
    @Binding var text: String

    private var lineCount: Int {
        max(text.components(separatedBy: "\n").count, 1)
    }

    private var gutterWidth: CGFloat {
        CGFloat(max(String(lineCount).count, 2)) * 9 + 20
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            // Line number gutter (SwiftUI)
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .trailing, spacing: 0) {
                    ForEach(1...max(lineCount, 1), id: \.self) { num in
                        Text("\(num)")
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(.tertiary)
                            .frame(height: 17.5, alignment: .trailing)
                    }
                }
                .padding(.top, 7)
                .padding(.horizontal, 8)
            }
            .disabled(true)
            .frame(width: gutterWidth)
            .background(Color(nsColor: .controlBackgroundColor))
            .overlay(alignment: .trailing) {
                Rectangle()
                    .fill(Color(nsColor: .separatorColor))
                    .frame(width: 1)
            }

            // Syntax-highlighted editor (NSViewRepresentable, no ruler)
            HighlightedTextEditor(text: $text)
        }
        .background(Color(nsColor: .textBackgroundColor))
    }
}

// MARK: - NSViewRepresentable editor with syntax highlighting (no ruler)
// Identical to the proven-working SQLEditorView pattern.

struct HighlightedTextEditor: NSViewRepresentable {
    @Binding var text: String

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false

        let textView = NSTextView()
        textView.isEditable = true
        textView.isRichText = false
        textView.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        textView.textContainerInset = NSSize(width: 8, height: 8)
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.isContinuousSpellCheckingEnabled = false
        textView.allowsUndo = true
        textView.delegate = context.coordinator
        textView.autoresizingMask = [.width]
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude)

        scrollView.documentView = textView
        context.coordinator.textView = textView
        context.coordinator.highlighter = SyntaxHighlighter(textView: textView)

        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? NSTextView else { return }
        if textView.string != text {
            textView.string = text
            if let storage = textView.textStorage {
                context.coordinator.highlighter?.highlight(storage)
            }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }

    class Coordinator: NSObject, NSTextViewDelegate {
        @Binding var text: String
        weak var textView: NSTextView?
        var highlighter: SyntaxHighlighter?

        init(text: Binding<String>) {
            _text = text
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            text = textView.string
        }
    }
}
