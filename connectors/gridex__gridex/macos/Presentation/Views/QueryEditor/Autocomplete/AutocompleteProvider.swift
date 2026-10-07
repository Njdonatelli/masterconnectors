// AutocompleteProvider.swift
// Gridex
//
// Context-aware SQL autocomplete with FK-based JOIN suggestions,
// fuzzy matching, and smart ranking.

import Foundation

final class AutocompleteProvider {
    private var tableNames: [String] = []
    private var columnsByTable: [String: [ColumnInfo]] = [:]
    private var foreignKeys: [String: [ForeignKeyInfo]] = [:]
    private var allColumnNames: [String] = []
    private var recentlyUsed: [String] = []

    // MARK: - Schema Update

    func updateSchema(_ tables: [TableDescription]) {
        tableNames = tables.map(\.name).sorted()
        columnsByTable = Dictionary(uniqueKeysWithValues: tables.map { ($0.name, $0.columns) })
        foreignKeys = Dictionary(uniqueKeysWithValues: tables.map { ($0.name, $0.foreignKeys) })
        allColumnNames = Array(Set(tables.flatMap { $0.columns.map(\.name) })).sorted()
    }

    func trackUsed(_ text: String) {
        recentlyUsed.removeAll { $0 == text }
        recentlyUsed.insert(text, at: 0)
        if recentlyUsed.count > 50 { recentlyUsed.removeLast() }
    }

    // MARK: - Suggestions

    func suggestions(for context: CompletionContext) -> [CompletionItem] {
        var items: [CompletionItem]

        switch context.trigger {
        case .none:
            return []
        case .keyword:
            items = keywordSuggestions(prefix: context.prefix)
        case .table:
            items = tableSuggestions(prefix: context.prefix)
        case .column(let table):
            items = columnSuggestions(table: table, prefix: context.prefix, scopeTables: context.scopeTables)
        case .join(let fromTables):
            items = joinSuggestions(fromTables: fromTables, prefix: context.prefix)
        case .selectList(let scopeTables):
            items = selectListSuggestions(prefix: context.prefix, scopeTables: scopeTables)
        case .afterIdentifier(let clause, let scopeTables):
            items = afterIdentifierSuggestions(clause: clause, prefix: context.prefix, scopeTables: scopeTables)
        case .function:
            items = functionSuggestions(prefix: context.prefix)
        case .general:
            items = generalSuggestions(prefix: context.prefix, scopeTables: context.scopeTables)
        }

        // Boost recently used
        for i in items.indices {
            if let idx = recentlyUsed.firstIndex(of: items[i].text) {
                items[i].score += 30 - idx
            }
        }

        // Deduplicate by (text + type), keeping highest score
        var seen: [String: Int] = [:]
        var deduplicated: [CompletionItem] = []
        for item in items {
            let key = "\(item.text.lowercased())|\(item.type)"
            if let existing = seen[key] {
                if item.score > existing {
                    if let idx = deduplicated.firstIndex(where: {
                        "\($0.text.lowercased())|\($0.type)" == key
                    }) {
                        deduplicated[idx] = item
                    }
                    seen[key] = item.score
                }
            } else {
                seen[key] = item.score
                deduplicated.append(item)
            }
        }

        // Sort by score descending, then by type priority, then alphabetically
        deduplicated.sort { a, b in
            if a.score != b.score { return a.score > b.score }
            if a.type != b.type { return typeRank(a.type) < typeRank(b.type) }
            return a.text < b.text
        }

        // Show up to 20 items — let user scroll through all matches
        return Array(deduplicated.prefix(20))
    }

    private func typeRank(_ type: CompletionItem.CompletionType) -> Int {
        switch type {
        case .keyword: return 0
        case .table: return 1
        case .column: return 2
        case .function: return 3
        case .join: return 4
        }
    }

    // MARK: - Keyword Suggestions

    private func keywordSuggestions(prefix: String) -> [CompletionItem] {
        return Self.sqlKeywords.compactMap { kw in
            guard let score = fuzzyScore(prefix, kw) else { return nil }
            // Boost common clause keywords so they appear first
            let boost = Self.primaryKeywords.contains(kw) ? 100 : 0
            return CompletionItem(text: kw, type: .keyword, detail: nil, insertText: kw,
                                  score: score + boost, matchRanges: fuzzyMatchRanges(prefix, kw))
        }
    }

    /// Top-tier SQL keywords that should rank highest in suggestions.
    private static let primaryKeywords: Set<String> = [
        "SELECT", "FROM", "WHERE", "JOIN", "LEFT JOIN", "RIGHT JOIN", "INNER JOIN",
        "ORDER BY", "GROUP BY", "INSERT INTO", "UPDATE", "DELETE", "SET",
        "AND", "OR", "ON", "AS", "DISTINCT", "LIMIT", "HAVING",
        "CREATE TABLE", "ALTER TABLE", "DROP TABLE", "WITH"
    ]

    // MARK: - Table Suggestions

    private func tableSuggestions(prefix: String) -> [CompletionItem] {
        return tableNames.compactMap { name in
            guard prefix.isEmpty || fuzzyScore(prefix, name) != nil else { return nil }
            let score = prefix.isEmpty ? 0 : (fuzzyScore(prefix, name) ?? 0)
            let cols = columnsByTable[name]?.count ?? 0
            return CompletionItem(text: name, type: .table, detail: "\(cols) cols",
                                  insertText: name, score: score,
                                  matchRanges: prefix.isEmpty ? [] : fuzzyMatchRanges(prefix, name))
        }
    }

    // MARK: - Column Suggestions

    private func columnSuggestions(table: String?, prefix: String, scopeTables: [TableRef]) -> [CompletionItem] {
        var items: [CompletionItem] = []

        // Columns from the specific table (highest priority)
        if let table, let columns = columnsByTable[table] {
            for col in columns {
                guard prefix.isEmpty || fuzzyScore(prefix, col.name) != nil else { continue }
                let score = (prefix.isEmpty ? 10 : (fuzzyScore(prefix, col.name) ?? 0)) +
                            (col.isPrimaryKey ? 5 : 0)
                items.append(CompletionItem(
                    text: col.name, type: .column, detail: "\(col.dataType) · \(table)",
                    insertText: col.name, score: score,
                    matchRanges: prefix.isEmpty ? [] : fuzzyMatchRanges(prefix, col.name)
                ))
            }
        }

        // Columns from all scope tables (if no specific table or augmenting)
        if table == nil {
            let scopeTableNames = Set(scopeTables.map(\.name))
            for ref in scopeTables {
                guard let columns = columnsByTable[ref.name] else { continue }
                let qualifier = ref.alias ?? ref.name
                for col in columns {
                    guard prefix.isEmpty || fuzzyScore(prefix, col.name) != nil else { continue }
                    let score = (prefix.isEmpty ? 8 : (fuzzyScore(prefix, col.name) ?? 0)) +
                                (col.isPrimaryKey ? 5 : 0) +
                                (scopeTableNames.contains(ref.name) ? 3 : 0)
                    let detail = "\(col.dataType) · \(qualifier)"
                    items.append(CompletionItem(
                        text: col.name, type: .column, detail: detail,
                        insertText: col.name, score: score,
                        matchRanges: prefix.isEmpty ? [] : fuzzyMatchRanges(prefix, col.name)
                    ))
                }
            }
        }

        // Deduplicate by name, keeping highest score
        var seen: [String: Int] = [:]
        items = items.filter { item in
            if let existing = seen[item.text], existing >= item.score { return false }
            seen[item.text] = item.score
            return true
        }

        return items
    }

    // MARK: - JOIN Suggestions (FK-aware)

    private func joinSuggestions(fromTables: [TableRef], prefix: String) -> [CompletionItem] {
        var items: [CompletionItem] = []

        for tableRef in fromTables {
            let tableName = tableRef.name
            let alias = tableRef.alias ?? tableName

            // FK from this table → referenced tables
            if let fks = foreignKeys[tableName] {
                for fk in fks {
                    let refTable = fk.referencedTable
                    let refAlias = suggestAlias(for: refTable, existing: fromTables)
                    let onClause = zip(fk.columns, fk.referencedColumns)
                        .map { "\(alias).\($0.0) = \(refAlias).\($0.1)" }
                        .joined(separator: " AND ")
                    let insertText = "JOIN \(refTable) \(refAlias) ON \(onClause)"
                    let displayText = "JOIN \(refTable) \(refAlias) ON \(onClause)"

                    guard prefix.isEmpty || fuzzyScore(prefix, insertText) != nil ||
                          fuzzyScore(prefix, refTable) != nil else { continue }

                    items.append(CompletionItem(
                        text: displayText, type: .join,
                        detail: "FK: \(fk.columns.joined(separator: ","))",
                        insertText: insertText, score: 20,
                        matchRanges: []
                    ))
                }
            }

            // Reverse FKs: other tables referencing this table
            for (otherTable, otherFks) in foreignKeys {
                guard otherTable != tableName else { continue }
                for fk in otherFks where fk.referencedTable == tableName {
                    let refAlias = suggestAlias(for: otherTable, existing: fromTables)
                    let onClause = zip(fk.referencedColumns, fk.columns)
                        .map { "\(alias).\($0.0) = \(refAlias).\($0.1)" }
                        .joined(separator: " AND ")
                    let insertText = "JOIN \(otherTable) \(refAlias) ON \(onClause)"

                    guard prefix.isEmpty || fuzzyScore(prefix, insertText) != nil ||
                          fuzzyScore(prefix, otherTable) != nil else { continue }

                    items.append(CompletionItem(
                        text: insertText, type: .join,
                        detail: "FK: \(otherTable).\(fk.columns.joined(separator: ","))",
                        insertText: insertText, score: 18,
                        matchRanges: []
                    ))
                }
            }
        }

        // If no FK matches, fall back to table suggestions prefixed with JOIN
        if items.isEmpty {
            let tables = tableSuggestions(prefix: prefix)
            items = tables.map { item in
                CompletionItem(text: "JOIN \(item.text)", type: .join, detail: item.detail,
                               insertText: "JOIN \(item.insertText)", score: item.score,
                               matchRanges: [])
            }
        }

        return items
    }

    // MARK: - SELECT List (columns + functions + *)

    private func selectListSuggestions(prefix: String, scopeTables: [TableRef]) -> [CompletionItem] {
        var items: [CompletionItem] = []

        // Star shortcut
        if prefix.isEmpty || "*".hasPrefix(prefix) {
            items.append(CompletionItem(text: "*", type: .keyword, detail: "All columns",
                                        insertText: "*", score: 20, matchRanges: []))
        }

        // Functions (high priority in SELECT)
        items.append(contentsOf: functionSuggestions(prefix: prefix).map {
            var item = $0; item.score += 5; return item
        })

        // Columns from scope tables
        items.append(contentsOf: columnSuggestions(table: nil, prefix: prefix, scopeTables: scopeTables))

        // DISTINCT keyword
        if prefix.isEmpty || fuzzyScore(prefix, "DISTINCT") != nil {
            items.append(CompletionItem(text: "DISTINCT", type: .keyword, detail: nil,
                                        insertText: "DISTINCT", score: fuzzyScore(prefix, "DISTINCT") ?? 8,
                                        matchRanges: prefix.isEmpty ? [] : fuzzyMatchRanges(prefix, "DISTINCT")))
        }

        return items
    }

    // MARK: - After Identifier (suggest next keywords based on clause)

    private func afterIdentifierSuggestions(clause: String, prefix: String, scopeTables: [TableRef]) -> [CompletionItem] {
        // Context-aware next-keyword suggestions
        let nextKeywords: [String]

        switch clause {
        case "SELECT":
            nextKeywords = ["FROM"]
        case "FROM":
            nextKeywords = ["WHERE", "JOIN", "LEFT JOIN", "RIGHT JOIN", "INNER JOIN",
                           "FULL JOIN", "CROSS JOIN", "ORDER BY", "GROUP BY",
                           "LIMIT", "OFFSET", "UNION", "RETURNING"]
        case "JOIN":
            nextKeywords = ["ON", "WHERE", "JOIN", "LEFT JOIN", "RIGHT JOIN",
                           "ORDER BY", "GROUP BY", "LIMIT"]
        case "WHERE":
            nextKeywords = ["AND", "OR", "ORDER BY", "GROUP BY", "LIMIT",
                           "UNION", "RETURNING"]
        case "ORDER BY", "GROUP BY":
            nextKeywords = ["LIMIT", "OFFSET", "ASC", "DESC"]
        case "HAVING":
            nextKeywords = ["ORDER BY", "LIMIT"]
        case "INSERT":
            nextKeywords = ["VALUES", "SELECT", "RETURNING"]
        default:
            nextKeywords = ["SELECT", "FROM", "WHERE", "JOIN", "ORDER BY",
                           "GROUP BY", "LIMIT", "HAVING", "AND", "OR"]
        }

        return nextKeywords.compactMap { kw in
            guard prefix.isEmpty || fuzzyScore(prefix, kw) != nil else { return nil }
            let score = prefix.isEmpty ? 15 : (fuzzyScore(prefix, kw) ?? 0) + 10
            return CompletionItem(text: kw, type: .keyword, detail: nil,
                                  insertText: kw, score: score,
                                  matchRanges: prefix.isEmpty ? [] : fuzzyMatchRanges(prefix, kw))
        }
    }

    // MARK: - Function Suggestions

    private func functionSuggestions(prefix: String) -> [CompletionItem] {
        return Self.sqlFunctions.compactMap { fn in
            guard prefix.isEmpty || fuzzyScore(prefix, fn.name) != nil else { return nil }
            // Functions are slightly deprioritized vs keywords at same score
            let score = prefix.isEmpty ? 0 : ((fuzzyScore(prefix, fn.name) ?? 0) - 10)
            return CompletionItem(
                text: fn.name, type: .function, detail: fn.signature,
                insertText: fn.snippet, score: score,
                matchRanges: prefix.isEmpty ? [] : fuzzyMatchRanges(prefix, fn.name)
            )
        }
    }

    // MARK: - General (search everything)

    private func generalSuggestions(prefix: String, scopeTables: [TableRef]) -> [CompletionItem] {
        guard !prefix.isEmpty else { return [] }
        var items: [CompletionItem] = []
        items.append(contentsOf: keywordSuggestions(prefix: prefix))
        items.append(contentsOf: tableSuggestions(prefix: prefix))
        items.append(contentsOf: allColumnsSuggestions(prefix: prefix))
        items.append(contentsOf: functionSuggestions(prefix: prefix))
        return items
    }

    /// Search columns across ALL tables (not scoped to a query).
    private func allColumnsSuggestions(prefix: String) -> [CompletionItem] {
        var items: [CompletionItem] = []
        for (tableName, columns) in columnsByTable {
            for col in columns {
                guard let score = fuzzyScore(prefix, col.name) else { continue }
                items.append(CompletionItem(
                    text: col.name, type: .column,
                    detail: "\(col.dataType) · \(tableName)",
                    insertText: col.name,
                    score: score + (col.isPrimaryKey ? 3 : 0),
                    matchRanges: fuzzyMatchRanges(prefix, col.name)
                ))
            }
        }
        return items
    }

    // MARK: - Fuzzy Matching

    /// Returns a score if query matches candidate, nil if no match.
    /// Strongly favors prefix matches over fuzzy subsequence matches.
    func fuzzyScore(_ query: String, _ candidate: String) -> Int? {
        guard !query.isEmpty else { return 0 }

        let q = query.lowercased()
        let c = candidate.lowercased()

        // Exact match — highest priority
        if q == c { return 1000 }

        // Exact prefix match — very strong boost
        if c.hasPrefix(q) {
            // Shorter candidates rank higher (SELECT beats SUBSTRING for "s")
            let lengthPenalty = max(0, candidate.count - query.count)
            return 500 - lengthPenalty
        }

        // Word-boundary prefix match (e.g., "uid" matches "user_id" at "_id")
        // Check if any word in the candidate starts with the query
        let words = c.split(whereSeparator: { $0 == "_" || $0 == "." || $0 == " " })
        for word in words {
            if word.hasPrefix(q) {
                return 200 - max(0, candidate.count - query.count)
            }
        }

        // Fuzzy subsequence match — weakest priority
        let qChars = Array(q)
        let cChars = Array(c)
        var qi = 0
        var score = 0
        var consecutive = 0
        var lastMatchIndex = -2

        for (ci, ch) in cChars.enumerated() {
            guard qi < qChars.count else { break }
            if ch == qChars[qi] {
                score += 1
                if ci == lastMatchIndex + 1 {
                    consecutive += 1
                    score += consecutive
                } else {
                    consecutive = 0
                }
                if ci > 0 {
                    let prev = cChars[ci - 1]
                    if prev == "_" || prev == "." { score += 3 }
                }
                lastMatchIndex = ci
                qi += 1
            }
        }

        return qi == qChars.count ? score : nil
    }

    /// Returns ranges of matched characters for highlighting.
    func fuzzyMatchRanges(_ query: String, _ candidate: String) -> [Int] {
        let q = Array(query.lowercased())
        let c = Array(candidate.lowercased())
        var qi = 0
        var ranges: [Int] = []

        for (ci, ch) in c.enumerated() {
            guard qi < q.count else { break }
            if ch == q[qi] {
                ranges.append(ci)
                qi += 1
            }
        }
        return ranges
    }

    // MARK: - Helpers

    private func suggestAlias(for table: String, existing: [TableRef]) -> String {
        let usedAliases = Set(existing.compactMap { $0.alias ?? $0.name })
        let base = String(table.prefix(1)).lowercased()
        if !usedAliases.contains(base) { return base }
        let base2 = String(table.prefix(2)).lowercased()
        if !usedAliases.contains(base2) { return base2 }
        let base3 = String(table.prefix(3)).lowercased()
        if !usedAliases.contains(base3) { return base3 }
        return table
    }

    // MARK: - SQL Keywords & Functions

    static let sqlKeywords: [String] = [
        "SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER",
        "FULL", "CROSS", "ON", "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN",
        "LIKE", "ILIKE", "IS", "NULL", "AS", "ORDER", "BY", "GROUP", "HAVING",
        "LIMIT", "OFFSET", "UNION", "ALL", "DISTINCT", "INSERT", "INTO", "VALUES",
        "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "ALTER", "DROP", "INDEX",
        "VIEW", "IF", "THEN", "ELSE", "END", "CASE", "WHEN", "WITH", "RECURSIVE",
        "RETURNING", "EXPLAIN", "ANALYZE", "BEGIN", "COMMIT", "ROLLBACK",
        "LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "FULL JOIN", "CROSS JOIN",
        "ORDER BY", "GROUP BY", "INSERT INTO", "CREATE TABLE", "ALTER TABLE",
        "DROP TABLE", "NOT NULL", "PRIMARY KEY", "FOREIGN KEY", "REFERENCES"
    ]

    static let sqlFunctions: [(name: String, signature: String, snippet: String)] = [
        ("COUNT", "COUNT(expr) → int", "COUNT()"),
        ("SUM", "SUM(expr) → numeric", "SUM()"),
        ("AVG", "AVG(expr) → numeric", "AVG()"),
        ("MIN", "MIN(expr) → value", "MIN()"),
        ("MAX", "MAX(expr) → value", "MAX()"),
        ("COALESCE", "COALESCE(val, ...) → value", "COALESCE(, )"),
        ("NULLIF", "NULLIF(a, b) → value", "NULLIF(, )"),
        ("CAST", "CAST(expr AS type)", "CAST( AS )"),
        ("CONCAT", "CONCAT(str, ...) → text", "CONCAT(, )"),
        ("LENGTH", "LENGTH(str) → int", "LENGTH()"),
        ("UPPER", "UPPER(str) → text", "UPPER()"),
        ("LOWER", "LOWER(str) → text", "LOWER()"),
        ("TRIM", "TRIM(str) → text", "TRIM()"),
        ("SUBSTRING", "SUBSTRING(str, pos, len)", "SUBSTRING(, , )"),
        ("REPLACE", "REPLACE(str, from, to)", "REPLACE(, , )"),
        ("NOW", "NOW() → timestamp", "NOW()"),
        ("CURRENT_TIMESTAMP", "CURRENT_TIMESTAMP → timestamp", "CURRENT_TIMESTAMP"),
        ("EXTRACT", "EXTRACT(field FROM source)", "EXTRACT( FROM )"),
        ("DATE_TRUNC", "DATE_TRUNC(field, source)", "DATE_TRUNC(, )"),
        ("ROW_NUMBER", "ROW_NUMBER() OVER (...)", "ROW_NUMBER() OVER ()"),
        ("RANK", "RANK() OVER (...)", "RANK() OVER ()"),
        ("DENSE_RANK", "DENSE_RANK() OVER (...)", "DENSE_RANK() OVER ()"),
        ("LAG", "LAG(expr, offset, default)", "LAG(, 1)"),
        ("LEAD", "LEAD(expr, offset, default)", "LEAD(, 1)"),
        ("STRING_AGG", "STRING_AGG(expr, delimiter)", "STRING_AGG(, ',')"),
        ("ARRAY_AGG", "ARRAY_AGG(expr) → array", "ARRAY_AGG()"),
        ("JSON_AGG", "JSON_AGG(expr) → json", "JSON_AGG()"),
        ("JSONB_AGG", "JSONB_AGG(expr) → jsonb", "JSONB_AGG()"),
        ("ROUND", "ROUND(num, decimals)", "ROUND(, 2)"),
        ("CEIL", "CEIL(num) → int", "CEIL()"),
        ("FLOOR", "FLOOR(num) → int", "FLOOR()"),
        ("ABS", "ABS(num) → num", "ABS()"),
        ("GREATEST", "GREATEST(val, ...) → value", "GREATEST(, )"),
        ("LEAST", "LEAST(val, ...) → value", "LEAST(, )"),
        ("EXISTS", "EXISTS(subquery) → bool", "EXISTS ()"),
        ("IN", "expr IN (values)", "IN ()"),
        ("BETWEEN", "expr BETWEEN a AND b", "BETWEEN  AND "),
        ("LIKE", "expr LIKE pattern", "LIKE '%%'"),
        ("ILIKE", "expr ILIKE pattern", "ILIKE '%%'"),
        ("GEN_RANDOM_UUID", "GEN_RANDOM_UUID() → uuid", "GEN_RANDOM_UUID()"),
        ("TO_CHAR", "TO_CHAR(val, format)", "TO_CHAR(, '')"),
        ("TO_DATE", "TO_DATE(str, format)", "TO_DATE(, '')"),
    ]
}

// MARK: - Models

struct CompletionItem: Identifiable {
    let id = UUID()
    let text: String
    let type: CompletionType
    let detail: String?
    let insertText: String
    var score: Int
    var matchRanges: [Int]  // Indices of matched chars for highlighting

    enum CompletionType: Equatable {
        case keyword, table, column, function, join

        var icon: String {
            switch self {
            case .keyword: return "k"
            case .table: return "T"
            case .column: return "C"
            case .function: return "f"
            case .join: return "J"
            }
        }

        var iconColor: (r: CGFloat, g: CGFloat, b: CGFloat) {
            switch self {
            case .keyword: return (0.67, 0.33, 0.67)
            case .table: return (0.33, 0.67, 0.33)
            case .column: return (0.33, 0.53, 0.87)
            case .function: return (0.87, 0.67, 0.33)
            case .join: return (0.53, 0.33, 0.87)
            }
        }
    }
}

struct TableRef {
    let name: String
    let alias: String?
}

struct CompletionContext {
    let trigger: CompletionTrigger
    let prefix: String
    let scopeTables: [TableRef]
}

enum CompletionTrigger {
    case none               // Inside string literal, no completions
    case keyword            // Suggest SQL keywords
    case table              // Suggest table names
    case column(table: String?)  // Suggest columns (optionally scoped to table)
    case join(fromTables: [TableRef])  // Suggest FK-aware JOINs
    case selectList(scopeTables: [TableRef])  // After SELECT: *, functions, columns, DISTINCT
    case afterIdentifier(clause: String, scopeTables: [TableRef])  // After table/column name: next keywords
    case function           // Suggest SQL functions
    case general            // Mixed suggestions
}
