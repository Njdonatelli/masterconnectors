// SQLContextParser.swift
// Gridex
//
// Parses SQL text to determine autocomplete context at cursor position.
// Handles: statement isolation, string detection, aliases, CTEs,
// multi-table scope, compound keywords, positional awareness.

import Foundation

final class SQLContextParser {

    /// Analyze SQL text up to cursor position and return completion context.
    func parse(sql: String, cursorOffset: Int) -> CompletionContext {
        let safeOffset = max(0, min(cursorOffset, sql.count))
        let fullText = String(sql.prefix(safeOffset))

        // 1. Check if cursor is inside a string literal → no completions
        if isInsideString(fullText) {
            return CompletionContext(trigger: .none, prefix: "", scopeTables: [])
        }

        // 2. Isolate current statement (split by ;)
        let currentStatement = isolateCurrentStatement(fullText)

        let prefix = currentWord(in: currentStatement)
        let tokens = tokenize(currentStatement)
        let scopeTables = extractAllTables(tokens: tokens)
        let trigger = determineTrigger(tokens: tokens, text: currentStatement, prefix: prefix, scopeTables: scopeTables)

        return CompletionContext(trigger: trigger, prefix: prefix, scopeTables: scopeTables)
    }

    // MARK: - String Literal Detection

    private func isInsideString(_ text: String) -> Bool {
        var inSingle = false
        for ch in text {
            if ch == "'" { inSingle.toggle() }
        }
        return inSingle
    }

    // MARK: - Statement Isolation

    private func isolateCurrentStatement(_ text: String) -> String {
        // Find the last ; and take everything after it
        if let lastSemicolon = text.lastIndex(of: ";") {
            let after = text[text.index(after: lastSemicolon)...]
            return String(after).trimmingCharacters(in: .whitespaces).isEmpty
                ? String(after) : String(after)
        }
        return text
    }

    // MARK: - Current Word

    private func currentWord(in text: String) -> String {
        var start = text.endIndex
        while start > text.startIndex {
            let prev = text.index(before: start)
            let ch = text[prev]
            if ch.isLetter || ch.isNumber || ch == "_" || ch == "." {
                start = prev
            } else {
                break
            }
        }
        return String(text[start..<text.endIndex])
    }

    private func prefixBeforeDot(in word: String) -> String? {
        guard word.contains(".") else { return nil }
        return String(word.split(separator: ".", maxSplits: 1)[0])
    }

    // MARK: - Tokenizer

    private func tokenize(_ text: String) -> [Token] {
        let pattern = #"(?:'[^']*')|(?:--[^\n]*)|(?:/\*[\s\S]*?\*/)|(?:\w+)|(?:[.,();=<>!*])"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(location: 0, length: (text as NSString).length)

        var tokens: [Token] = []
        regex.enumerateMatches(in: text, range: range) { match, _, _ in
            guard let match, let swiftRange = Range(match.range, in: text) else { return }
            let value = String(text[swiftRange])
            if value.hasPrefix("'") || value.hasPrefix("--") || value.hasPrefix("/*") { return }
            tokens.append(Token(value: value, upper: value.uppercased()))
        }
        return tokens
    }

    // MARK: - Trigger Detection

    private func determineTrigger(tokens: [Token], text: String, prefix: String, scopeTables: [TableRef]) -> CompletionTrigger {
        // Dot notation: alias.column
        if prefix.contains(".") {
            if let beforeDot = prefixBeforeDot(in: prefix) {
                let resolved = resolveAlias(beforeDot, scopeTables: scopeTables)
                return .column(table: resolved)
            }
        }

        guard !tokens.isEmpty else { return .general }

        // Effective tokens = all tokens minus the current prefix being typed
        let effectiveTokens: [Token]
        if !prefix.isEmpty && tokens.last?.value.lowercased() == prefix.lowercased() {
            effectiveTokens = Array(tokens.dropLast())
        } else {
            effectiveTokens = tokens
        }

        guard let lastToken = effectiveTokens.last else {
            // Empty query with prefix being typed → general
            return prefix.isEmpty ? .none : .general
        }

        let lastUpper = lastToken.upper

        // === KEYWORD-IMMEDIATE TRIGGERS (lastToken IS the keyword, cursor right after it) ===

        // JOIN / LEFT JOIN etc.
        if lastUpper == "JOIN" {
            return .join(fromTables: scopeTables)
        }
        if isJoinModifier(lastUpper) {
            // User typed "LEFT " — suggest "JOIN" as compound
            return .keyword
        }

        // FROM, INTO, UPDATE table, TABLE
        if ["FROM", "INTO", "TABLE"].contains(lastUpper) {
            return .table
        }
        if lastUpper == "UPDATE" {
            return .table
        }

        // SELECT, DISTINCT → columns + functions + *
        if lastUpper == "SELECT" || lastUpper == "DISTINCT" {
            return .selectList(scopeTables: scopeTables)
        }

        // WHERE, AND, OR, ON, HAVING, SET, BY → columns
        if ["WHERE", "AND", "OR", "ON", "HAVING", "BY"].contains(lastUpper) {
            return .column(table: nil)
        }
        if lastUpper == "SET" {
            // UPDATE table SET → suggest columns of that table
            let updateTable = findUpdateTable(tokens: effectiveTokens)
            return .column(table: updateTable)
        }

        // After * → suggest FROM
        if lastToken.value == "*" {
            return .afterIdentifier(clause: "SELECT", scopeTables: scopeTables)
        }

        // After comma → depends on clause
        if lastToken.value == "," {
            let clause = findCurrentClause(tokens: effectiveTokens)
            switch clause {
            case "SELECT": return .selectList(scopeTables: scopeTables)
            case "FROM", "JOIN": return .table
            case "ORDER BY", "GROUP BY": return .column(table: nil)
            case "INSERT": return .column(table: findInsertTable(tokens: effectiveTokens))
            default: return .column(table: nil)
            }
        }

        // After ( → check context
        if lastToken.value == "(" {
            // INSERT INTO table (  → table columns
            if let insertTable = findInsertIntoParenContext(tokens: effectiveTokens) {
                return .column(table: insertTable)
            }
            // Function args
            if effectiveTokens.count >= 2 {
                let prev = effectiveTokens[effectiveTokens.count - 2].upper
                if AutocompleteProvider.sqlFunctions.contains(where: { $0.name == prev }) {
                    return .column(table: nil)
                }
            }
            return .selectList(scopeTables: scopeTables)
        }

        // After = > < !=  → columns/values
        if ["=", ">", "<", "!"].contains(lastToken.value) {
            return .column(table: nil)
        }

        // === NON-KEYWORD LAST TOKEN (table name, column name, alias, etc.) ===

        // If prefix is empty and last token is a non-keyword identifier:
        // User just finished typing a table name/alias and pressed space
        // → Suggest next keywords based on current clause
        if prefix.isEmpty {
            let clause = findCurrentClause(tokens: effectiveTokens)
            return .afterIdentifier(clause: clause, scopeTables: scopeTables)
        }

        // === PREFIX IS BEING TYPED ===

        // Find the governing keyword and distance
        if let (kw, distance) = findPreviousKeywordWithDistance(tokens: effectiveTokens) {
            switch kw {
            case "FROM", "INTO", "TABLE":
                if distance == 0 { return .table }
                return .keyword  // Table already given, expecting next keyword
            case "UPDATE":
                if distance == 0 { return .table }
                return .keyword
            case "JOIN":
                if distance == 0 { return .join(fromTables: scopeTables) }
                return .keyword
            case "SELECT", "DISTINCT":
                return .selectList(scopeTables: scopeTables)
            case "WHERE", "AND", "OR", "ON", "HAVING", "BY":
                // Could be typing a column name OR a keyword (e.g., after WHERE col = val, typing "AN" for AND)
                // Check if there's a comparison operator between keyword and prefix
                if distance >= 2 { return .keyword }
                return .column(table: nil)
            case "SET":
                if distance == 0 {
                    let updateTable = findUpdateTable(tokens: effectiveTokens)
                    return .column(table: updateTable)
                }
                return .keyword
            default:
                break
            }
        }

        return .general
    }

    // MARK: - Context-Specific Extractors

    /// Find table name in `UPDATE <table> SET ...`
    private func findUpdateTable(tokens: [Token]) -> String? {
        for i in 0..<tokens.count {
            if tokens[i].upper == "UPDATE" && i + 1 < tokens.count {
                return tokens[i + 1].value
            }
        }
        return nil
    }

    /// Find table name in `INSERT INTO <table>`
    private func findInsertTable(tokens: [Token]) -> String? {
        for i in 0..<tokens.count {
            if tokens[i].upper == "INTO" && i + 1 < tokens.count {
                return tokens[i + 1].value
            }
        }
        return nil
    }

    /// Detect `INSERT INTO table (` pattern
    private func findInsertIntoParenContext(tokens: [Token]) -> String? {
        // Walk back from the `(` to find INSERT INTO <table>
        let count = tokens.count
        guard count >= 3 else { return nil }  // Need at least: INTO, table, (
        // tokens[-1] is "(", tokens[-2] should be table name, tokens[-3] should be INTO
        let beforeParen = count - 2  // table name position
        let beforeTable = count - 3  // INTO position
        if beforeTable >= 0 && tokens[beforeTable].upper == "INTO" {
            return tokens[beforeParen].value
        }
        // Also handle INSERT INTO schema.table (
        if beforeTable >= 1 && count >= 5 {
            let dotPos = count - 3
            let intoPos = count - 5
            if dotPos >= 0 && tokens[dotPos].value == "." &&
               intoPos >= 0 && tokens[intoPos].upper == "INTO" {
                return tokens[beforeParen].value
            }
        }
        return nil
    }

    // MARK: - Table Extraction

    private func extractAllTables(tokens: [Token]) -> [TableRef] {
        var tables: [TableRef] = []
        var i = 0

        while i < tokens.count {
            let upper = tokens[i].upper
            if upper == "FROM" || upper == "JOIN" {
                i += 1
                if i >= tokens.count { break }

                // Handle schema.table
                let tableName = resolveSchemaPrefix(tokens: tokens, index: &i)

                // Check for alias
                var alias: String? = nil
                if i < tokens.count {
                    let next = tokens[i].upper
                    if next == "AS" {
                        i += 1
                        if i < tokens.count {
                            alias = tokens[i].value
                            i += 1
                        }
                    } else if !Self.clauseKeywords.contains(next) && next != "ON" && next != "," &&
                                next != "(" && next != ")" && next != ";" && next != "*" {
                        alias = tokens[i].value
                        i += 1
                    }
                }
                tables.append(TableRef(name: tableName, alias: alias))
                continue
            }
            // UPDATE table
            if upper == "UPDATE" {
                i += 1
                if i < tokens.count && !Self.clauseKeywords.contains(tokens[i].upper) {
                    let tableName = resolveSchemaPrefix(tokens: tokens, index: &i)
                    var alias: String? = nil
                    if i < tokens.count && tokens[i].upper == "AS" {
                        i += 1
                        if i < tokens.count { alias = tokens[i].value; i += 1 }
                    } else if i < tokens.count && tokens[i].upper == "SET" {
                        // no alias
                    } else if i < tokens.count && !Self.clauseKeywords.contains(tokens[i].upper) {
                        alias = tokens[i].value
                        i += 1
                    }
                    tables.append(TableRef(name: tableName, alias: alias))
                    continue
                }
            }
            i += 1
        }

        return tables
    }

    // MARK: - Helpers

    private func resolveAlias(_ aliasOrTable: String, scopeTables: [TableRef]) -> String? {
        if let ref = scopeTables.first(where: { $0.alias == aliasOrTable }) {
            return ref.name
        }
        if let ref = scopeTables.first(where: { $0.name == aliasOrTable }) {
            return ref.name
        }
        return aliasOrTable
    }

    private func resolveSchemaPrefix(tokens: [Token], index: inout Int) -> String {
        var name = tokens[index].value
        index += 1
        if index < tokens.count && tokens[index].value == "." {
            index += 1
            if index < tokens.count {
                name = tokens[index].value
                index += 1
            }
        }
        return name
    }

    private func findPreviousKeywordWithDistance(tokens: [Token]) -> (String, Int)? {
        var identifierCount = 0
        for i in stride(from: tokens.count - 1, through: 0, by: -1) {
            let upper = tokens[i].upper
            if Self.clauseKeywords.contains(upper) {
                return (upper, identifierCount)
            }
            let val = tokens[i].value
            if val != "," && val != "(" && val != ")" && val != "." && val != ";" && val != "*" && val != "=" && val != ">" && val != "<" && val != "!" {
                identifierCount += 1
            }
        }
        return nil
    }

    private func findCurrentClause(tokens: [Token]) -> String {
        for i in stride(from: tokens.count - 1, through: 0, by: -1) {
            let upper = tokens[i].upper
            switch upper {
            case "SELECT", "FROM", "WHERE", "HAVING", "SET":
                return upper
            case "JOIN":
                return "JOIN"
            case "ORDER":
                if i + 1 < tokens.count && tokens[i + 1].upper == "BY" { return "ORDER BY" }
                return upper
            case "GROUP":
                if i + 1 < tokens.count && tokens[i + 1].upper == "BY" { return "GROUP BY" }
                return upper
            case "INSERT", "INTO":
                return "INSERT"
            default:
                break
            }
        }
        return ""
    }

    private func isJoinModifier(_ upper: String) -> Bool {
        ["LEFT", "RIGHT", "INNER", "OUTER", "FULL", "CROSS", "NATURAL"].contains(upper)
    }

    // Keywords that start clauses — used for boundary detection
    private static let clauseKeywords: Set<String> = [
        "SELECT", "FROM", "WHERE", "JOIN", "ON", "AND", "OR", "NOT",
        "ORDER", "GROUP", "BY", "HAVING", "LIMIT", "OFFSET", "UNION",
        "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE",
        "LEFT", "RIGHT", "INNER", "OUTER", "FULL", "CROSS", "NATURAL",
        "CREATE", "ALTER", "DROP", "TABLE", "INDEX", "VIEW",
        "WITH", "AS", "DISTINCT", "ALL", "EXISTS", "IN", "BETWEEN",
        "LIKE", "ILIKE", "IS", "NULL", "CASE", "WHEN", "THEN", "ELSE", "END",
        "RETURNING", "EXPLAIN", "ANALYZE", "BEGIN", "COMMIT", "ROLLBACK"
    ]
}

// MARK: - Token

private struct Token {
    let value: String
    let upper: String
}
