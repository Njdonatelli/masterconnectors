// SQLFormatter.swift
// Gridex
//
// SQL beautify / minify with tab-indented clause style + cursor-aware statement split.

import Foundation

enum SQLFormatter {

    // MARK: - Beautify

    /// Reformat SQL with clause keywords on their own line and arguments indented.
    ///
    /// Target style:
    /// ```
    /// SELECT
    ///     col1,
    ///     col2,
    ///     col3
    /// FROM
    ///     table_name
    /// WHERE
    ///     condition = 'x'
    /// ```
    static func beautify(_ sql: String) -> String {
        // Split into statements and format each independently
        let statements = splitStatements(sql)
        let formatted = statements.map { beautifyStatement($0) }
        return formatted.joined(separator: ";\n\n").trimmingCharacters(in: .whitespacesAndNewlines) + (sql.trimmingCharacters(in: .whitespaces).hasSuffix(";") ? ";" : "")
    }

    private static func beautifyStatement(_ sql: String) -> String {
        let tokens = tokenize(sql)
        guard !tokens.isEmpty else { return "" }

        // Keywords that begin a top-level clause (line by themselves)
        // Arguments follow on the next line indented by 1 tab
        let clauseKeywords: Set<String> = [
            "SELECT", "FROM", "WHERE", "GROUP BY", "HAVING", "ORDER BY",
            "LIMIT", "OFFSET", "UNION", "UNION ALL", "INTERSECT", "EXCEPT",
            "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM",
            "WITH", "RETURNING"
        ]

        // Join keywords — own line at indent 0 with argument inline
        let joinKeywords: Set<String> = [
            "JOIN", "LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "FULL JOIN",
            "FULL OUTER JOIN", "LEFT OUTER JOIN", "RIGHT OUTER JOIN",
            "CROSS JOIN", "NATURAL JOIN"
        ]

        var lines: [String] = []
        var currentLine = ""
        let indent = "\t"
        let clauseIndent = 1  // 1 tab by default for clause body
        var parenDepth = 0

        func flush() {
            if !currentLine.isEmpty {
                lines.append(currentLine)
                currentLine = ""
            }
        }

        func addToken(_ tok: String, spaceBefore: Bool) {
            if currentLine.isEmpty {
                currentLine = tok
            } else if spaceBefore {
                currentLine += " " + tok
            } else {
                currentLine += tok
            }
        }

        var i = 0
        while i < tokens.count {
            let tok = tokens[i]
            let upper = tok.uppercased()

            // Check 2- or 3-word keywords
            var matchedKeyword: String? = nil
            var matchedLength = 1

            for length in [3, 2] {
                if i + length <= tokens.count {
                    let candidate = tokens[i..<(i+length)].map { $0.uppercased() }.joined(separator: " ")
                    if clauseKeywords.contains(candidate) || joinKeywords.contains(candidate) {
                        matchedKeyword = candidate
                        matchedLength = length
                        break
                    }
                }
            }

            if matchedKeyword == nil && (clauseKeywords.contains(upper) || joinKeywords.contains(upper)) {
                matchedKeyword = upper
                matchedLength = 1
            }

            // Handle clause keyword (only at top level, paren depth 0)
            if let kw = matchedKeyword, parenDepth == 0 {
                flush()

                if joinKeywords.contains(kw) {
                    // JOIN: keyword on its own indented line, argument follows inline
                    currentLine = kw
                    i += matchedLength
                    // Collect JOIN target + ON clause on same line
                    while i < tokens.count {
                        let t = tokens[i]
                        // Stop at next clause keyword
                        if isClauseStart(tokens: tokens, at: i, clauseKeywords: clauseKeywords, joinKeywords: joinKeywords) {
                            break
                        }
                        if t == ";" { break }
                        addToken(t, spaceBefore: shouldSpaceBefore(prev: lastChar(currentLine), tok: t))
                        i += 1
                    }
                    flush()
                    continue
                }

                // Top-level clause: keyword on its own line, then args indented
                lines.append(kw)
                i += matchedLength

                // Collect clause body
                var bodyParts: [String] = []
                var current = ""
                var bodyParen = 0
                while i < tokens.count {
                    let t = tokens[i]
                    if t == ";" { break }
                    if bodyParen == 0 && isClauseStart(tokens: tokens, at: i, clauseKeywords: clauseKeywords, joinKeywords: joinKeywords) {
                        break
                    }
                    if t == "(" { bodyParen += 1 }
                    if t == ")" { bodyParen -= 1 }

                    // Split on comma at top of this clause's body
                    if t == "," && bodyParen == 0 {
                        if !current.isEmpty { bodyParts.append(current) }
                        current = ""
                        i += 1
                        continue
                    }

                    if current.isEmpty {
                        current = t
                    } else {
                        let needsSpace = shouldSpaceBefore(prev: lastChar(current), tok: t)
                        current += (needsSpace ? " " : "") + t
                    }
                    i += 1
                }
                if !current.isEmpty { bodyParts.append(current) }

                // Emit body parts
                for (idx, part) in bodyParts.enumerated() {
                    let suffix = (idx < bodyParts.count - 1) ? "," : ""
                    lines.append(indent.repeating(clauseIndent) + part.trimmingCharacters(in: .whitespaces) + suffix)
                }
                continue
            }

            // Handle parentheses tracking
            if tok == "(" {
                let needsSpace = shouldSpaceBefore(prev: lastChar(currentLine), tok: tok)
                addToken(tok, spaceBefore: needsSpace)
                parenDepth += 1
                i += 1
                continue
            }
            if tok == ")" {
                addToken(tok, spaceBefore: false)
                parenDepth = max(0, parenDepth - 1)
                i += 1
                continue
            }

            if tok == ";" {
                flush()
                lines.append(";")
                i += 1
                continue
            }

            // Normal token — uppercase SQL keywords
            let emitted = isSQLKeyword(upper) ? upper : tok
            let needsSpace = shouldSpaceBefore(prev: lastChar(currentLine), tok: tok)
            addToken(emitted, spaceBefore: needsSpace)
            i += 1
        }

        flush()

        return lines
            .map { $0.trimmingCharacters(in: .init(charactersIn: " ")) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }

    private static func isClauseStart(tokens: [String], at index: Int, clauseKeywords: Set<String>, joinKeywords: Set<String>) -> Bool {
        for length in [3, 2, 1] {
            if index + length <= tokens.count {
                let candidate = tokens[index..<(index+length)].map { $0.uppercased() }.joined(separator: " ")
                if clauseKeywords.contains(candidate) || joinKeywords.contains(candidate) {
                    return true
                }
            }
        }
        return false
    }

    private static func shouldSpaceBefore(prev: Character?, tok: String) -> Bool {
        guard let prev else { return false }
        let noSpaceBeforeTokens: Set<String> = [",", ")", ";", ".", "::"]
        if noSpaceBeforeTokens.contains(tok) { return false }
        if prev == "(" || prev == "." { return false }
        // No space between function name and (
        if tok == "(" && (prev.isLetter || prev.isNumber || prev == "_") { return false }
        return true
    }

    private static func lastChar(_ s: String) -> Character? {
        s.last
    }

    // MARK: - Minify

    static func minify(_ sql: String) -> String {
        let tokens = tokenize(sql)
        var result = ""
        for tok in tokens {
            if result.isEmpty {
                result = tok
            } else {
                let needsSpace = shouldSpaceBefore(prev: result.last, tok: tok)
                result += (needsSpace ? " " : "") + tok
            }
        }
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Statement splitting

    /// Split SQL into statements by unquoted `;`.
    private static func splitStatements(_ sql: String) -> [String] {
        let chars = Array(sql)
        var stmts: [String] = []
        var current = ""
        var inSingle = false, inDouble = false, inLineComment = false, inBlockComment = false
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if inLineComment {
                current.append(c)
                if c == "\n" { inLineComment = false }
                i += 1; continue
            }
            if inBlockComment {
                current.append(c)
                if c == "*" && i + 1 < chars.count && chars[i+1] == "/" {
                    current.append("/"); inBlockComment = false; i += 2; continue
                }
                i += 1; continue
            }
            if inSingle {
                current.append(c)
                if c == "'" { inSingle = false }
                i += 1; continue
            }
            if inDouble {
                current.append(c)
                if c == "\"" { inDouble = false }
                i += 1; continue
            }
            if c == "'" { inSingle = true; current.append(c); i += 1; continue }
            if c == "\"" { inDouble = true; current.append(c); i += 1; continue }
            if c == "-" && i + 1 < chars.count && chars[i+1] == "-" {
                inLineComment = true; current += "--"; i += 2; continue
            }
            if c == "/" && i + 1 < chars.count && chars[i+1] == "*" {
                inBlockComment = true; current += "/*"; i += 2; continue
            }
            if c == ";" {
                let trimmed = current.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { stmts.append(trimmed) }
                current = ""
                i += 1
                continue
            }
            current.append(c)
            i += 1
        }
        let trimmed = current.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { stmts.append(trimmed) }
        return stmts
    }

    // MARK: - Statement at cursor

    static func statementAt(sql: String, cursorOffset: Int) -> String {
        let safeCursor = max(0, min(cursorOffset, sql.count))
        let chars = Array(sql)

        var inSingle = false, inDouble = false, inLineComment = false, inBlockComment = false
        var boundaries: [Int] = [-1]

        var i = 0
        while i < chars.count {
            let c = chars[i]
            if inLineComment {
                if c == "\n" { inLineComment = false }
                i += 1; continue
            }
            if inBlockComment {
                if c == "*" && i + 1 < chars.count && chars[i+1] == "/" {
                    inBlockComment = false
                    i += 2; continue
                }
                i += 1; continue
            }
            if inSingle {
                if c == "'" { inSingle = false }
                i += 1; continue
            }
            if inDouble {
                if c == "\"" { inDouble = false }
                i += 1; continue
            }
            if c == "-" && i + 1 < chars.count && chars[i+1] == "-" {
                inLineComment = true; i += 2; continue
            }
            if c == "/" && i + 1 < chars.count && chars[i+1] == "*" {
                inBlockComment = true; i += 2; continue
            }
            if c == "'" { inSingle = true; i += 1; continue }
            if c == "\"" { inDouble = true; i += 1; continue }
            if c == ";" { boundaries.append(i) }
            i += 1
        }
        boundaries.append(chars.count)

        var start = 0
        var end = chars.count
        for k in 0..<(boundaries.count - 1) {
            let lo = boundaries[k] + 1
            let hi = boundaries[k+1]
            if safeCursor >= lo && safeCursor <= hi {
                start = lo
                end = hi
                break
            }
        }

        return String(chars[start..<end]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Tokenizer

    private static func tokenize(_ sql: String) -> [String] {
        var tokens: [String] = []
        let chars = Array(sql)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if c.isWhitespace { i += 1; continue }

            if c == "'" {
                var str = "'"
                i += 1
                while i < chars.count {
                    str.append(chars[i])
                    if chars[i] == "'" {
                        if i + 1 < chars.count && chars[i+1] == "'" {
                            str.append("'"); i += 2; continue
                        }
                        i += 1; break
                    }
                    i += 1
                }
                tokens.append(str)
                continue
            }

            if c == "-" && i + 1 < chars.count && chars[i+1] == "-" {
                var cmt = ""
                while i < chars.count && chars[i] != "\n" { cmt.append(chars[i]); i += 1 }
                tokens.append(cmt)
                continue
            }
            if c == "/" && i + 1 < chars.count && chars[i+1] == "*" {
                var cmt = "/*"; i += 2
                while i + 1 < chars.count && !(chars[i] == "*" && chars[i+1] == "/") {
                    cmt.append(chars[i]); i += 1
                }
                if i + 1 < chars.count { cmt += "*/"; i += 2 }
                tokens.append(cmt)
                continue
            }

            if c.isLetter || c.isNumber || c == "_" || c == "." || c == "$" || c == "@" {
                var word = ""
                while i < chars.count && (chars[i].isLetter || chars[i].isNumber || chars[i] == "_" || chars[i] == ".") {
                    word.append(chars[i]); i += 1
                }
                tokens.append(word)
                continue
            }

            if i + 1 < chars.count {
                let two = String(chars[i...i+1])
                if ["<=", ">=", "<>", "!=", "||", "::"].contains(two) {
                    tokens.append(two); i += 2; continue
                }
            }

            tokens.append(String(c))
            i += 1
        }
        return tokens
    }

    private static func isSQLKeyword(_ word: String) -> Bool {
        Self.sqlKeywordsSet.contains(word)
    }

    private static let sqlKeywordsSet: Set<String> = [
        "SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER",
        "FULL", "CROSS", "ON", "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN",
        "LIKE", "ILIKE", "IS", "NULL", "AS", "ORDER", "BY", "GROUP", "HAVING",
        "LIMIT", "OFFSET", "UNION", "ALL", "DISTINCT", "INSERT", "INTO", "VALUES",
        "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "ALTER", "DROP", "INDEX",
        "VIEW", "IF", "THEN", "ELSE", "END", "CASE", "WHEN", "WITH", "RECURSIVE",
        "RETURNING", "EXPLAIN", "ANALYZE", "BEGIN", "COMMIT", "ROLLBACK",
        "TRUE", "FALSE", "ASC", "DESC", "NULLS", "FIRST", "LAST",
        "PARTITION", "OVER", "CAST", "COALESCE", "NULLIF"
    ]
}

// MARK: - String helper

private extension String {
    func repeating(_ count: Int) -> String {
        String(repeating: self, count: count)
    }
}
