// SyntaxHighlighter.swift
// Gridex
//
// Real-time SQL syntax highlighting engine.

import AppKit

final class SyntaxHighlighter: NSObject {
    private weak var textView: NSTextView?

    private static let keywords: Set<String> = [
        "SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER",
        "FULL", "CROSS", "ON", "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN",
        "LIKE", "IS", "NULL", "AS", "ORDER", "BY", "GROUP", "HAVING", "LIMIT",
        "OFFSET", "UNION", "ALL", "DISTINCT", "INSERT", "INTO", "VALUES",
        "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "ALTER", "DROP", "INDEX",
        "VIEW", "IF", "THEN", "ELSE", "END", "CASE", "WHEN", "WITH", "RECURSIVE",
        "RETURNING", "EXPLAIN", "ANALYZE", "BEGIN", "COMMIT", "ROLLBACK",
        "TRANSACTION", "CASCADE", "RESTRICT", "REFERENCES", "FOREIGN", "KEY",
        "PRIMARY", "UNIQUE", "CHECK", "CONSTRAINT", "DEFAULT", "ADD", "COLUMN",
        "RENAME", "TO", "TRUNCATE", "GRANT", "REVOKE", "ASC", "DESC", "FETCH",
        "NEXT", "ROWS", "ONLY", "NATURAL", "USING", "EXCEPT", "INTERSECT",
        "COALESCE", "NULLIF", "CAST", "TRUE", "FALSE", "BOOLEAN", "INTEGER",
        "VARCHAR", "TEXT", "TIMESTAMP", "DATE", "TIME", "SERIAL", "BIGSERIAL",
        "JSONB", "JSON", "UUID", "ARRAY", "FLOAT", "DOUBLE", "NUMERIC", "DECIMAL"
    ]

    private static let functions: Set<String> = [
        "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "CONCAT",
        "LENGTH", "UPPER", "LOWER", "TRIM", "SUBSTRING", "REPLACE",
        "NOW", "CURRENT_TIMESTAMP", "EXTRACT", "DATE_TRUNC",
        "ROW_NUMBER", "RANK", "DENSE_RANK", "LAG", "LEAD",
        "STRING_AGG", "ARRAY_AGG", "JSON_AGG", "JSONB_AGG",
        "ROUND", "CEIL", "FLOOR", "ABS", "MOD", "POWER", "SQRT"
    ]

    init(textView: NSTextView) {
        self.textView = textView
        super.init()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(textDidChange),
            name: NSText.didChangeNotification,
            object: textView
        )
    }

    @objc private func textDidChange(_ notification: Notification) {
        guard let textView = textView,
              let textStorage = textView.textStorage else { return }
        highlight(textStorage)
    }

    func highlight(_ textStorage: NSTextStorage) {
        let text = textStorage.string
        let fullRange = NSRange(location: 0, length: text.utf16.count)
        let defaultFont = NSFont.monospacedSystemFont(ofSize: 14, weight: .regular)

        textStorage.beginEditing()
        textStorage.addAttribute(.foregroundColor, value: NSColor.labelColor, range: fullRange)
        textStorage.addAttribute(.font, value: defaultFont, range: fullRange)

        // Highlight keywords
        let words = text.components(separatedBy: CharacterSet.alphanumerics.inverted)
        var searchStart = text.startIndex
        for word in words where !word.isEmpty {
            if let range = text.range(of: word, range: searchStart..<text.endIndex) {
                let nsRange = NSRange(range, in: text)
                let upper = word.uppercased()

                if Self.keywords.contains(upper) {
                    textStorage.addAttribute(.foregroundColor, value: NSColor.Gridex.syntaxKeyword, range: nsRange)
                    textStorage.addAttribute(.font, value: NSFont.monospacedSystemFont(ofSize: 14, weight: .bold), range: nsRange)
                } else if Self.functions.contains(upper) {
                    textStorage.addAttribute(.foregroundColor, value: NSColor.Gridex.syntaxFunction, range: nsRange)
                }

                searchStart = range.upperBound
            }
        }

        // Highlight strings ('...')
        highlightPattern("'[^']*'", color: NSColor.Gridex.syntaxString, in: textStorage, text: text)

        // Highlight numbers
        highlightPattern("\\b\\d+(\\.\\d+)?\\b", color: NSColor.Gridex.syntaxNumber, in: textStorage, text: text)

        // Highlight single-line comments
        highlightPattern("--[^\n]*", color: NSColor.Gridex.syntaxComment, in: textStorage, text: text)

        // Highlight multi-line comments
        highlightPattern("/\\*[\\s\\S]*?\\*/", color: NSColor.Gridex.syntaxComment, in: textStorage, text: text)

        textStorage.endEditing()
    }

    private func highlightPattern(_ pattern: String, color: NSColor, in textStorage: NSTextStorage, text: String) {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return }
        let fullRange = NSRange(location: 0, length: text.utf16.count)
        regex.enumerateMatches(in: text, range: fullRange) { match, _, _ in
            if let range = match?.range {
                textStorage.addAttribute(.foregroundColor, value: color, range: range)
            }
        }
    }
}
