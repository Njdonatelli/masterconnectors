// ExportService.swift
// Gridex

import Foundation

final class ExportService: ExportDataUseCase, @unchecked Sendable {

    func exportCSV(data: QueryResult, to url: URL) async throws {
        var csv = data.columns.map(\.name).joined(separator: ",") + "\n"
        for row in data.rows {
            csv += row.map { value in
                let str = value.description
                if str.contains(",") || str.contains("\"") || str.contains("\n") {
                    return "\"\(str.replacingOccurrences(of: "\"", with: "\"\""))\""
                }
                return str
            }.joined(separator: ",") + "\n"
        }
        try csv.write(to: url, atomically: true, encoding: .utf8)
    }

    func exportJSON(data: QueryResult, to url: URL) async throws {
        let rows = data.rows.map { row in
            Dictionary(uniqueKeysWithValues: zip(data.columns.map(\.name), row.map(\.description)))
        }
        let jsonData = try JSONSerialization.data(withJSONObject: rows, options: [.prettyPrinted, .sortedKeys])
        try jsonData.write(to: url)
    }

    func exportSQL(data: QueryResult, table: String, to url: URL) async throws {
        var sql = ""
        let columns = data.columns.map(\.name).joined(separator: ", ")
        for row in data.rows {
            let values = row.map { value -> String in
                if value.isNull { return "NULL" }
                return "'\(value.description.replacingOccurrences(of: "'", with: "''"))'"
            }.joined(separator: ", ")
            sql += "INSERT INTO \(table) (\(columns)) VALUES (\(values));\n"
        }
        try sql.write(to: url, atomically: true, encoding: .utf8)
    }

    /// Full-fidelity SQL export: header comment, DROP/CREATE, sequences,
    /// multi-row INSERT, indices — matches professional output so the
    /// file can be re-imported to recreate the table exactly.
    func exportTableSQL(
        description: TableDescription,
        rows: [[RowValue]],
        databaseType: DatabaseType,
        databaseName: String,
        to url: URL
    ) async throws {
        let d = databaseType.sqlDialect
        let schemaName = description.schema ?? "public"
        let qualified: String = {
            if databaseType == .sqlite {
                return d.quoteIdentifier(description.name)
            }
            return "\(d.quoteIdentifier(schemaName)).\(d.quoteIdentifier(description.name))"
        }()

        var sql = ""

        // Header comment block
        let ts = {
            let f = DateFormatter()
            f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSSS"
            return f.string(from: Date())
        }()
        sql += "-- -------------------------------------------------------------\n"
        sql += "-- Gridex SQL Export\n"
        sql += "--\n"
        sql += "-- Database: \(databaseName)\n"
        sql += "-- Table: \(description.name)\n"
        sql += "-- Generation Time: \(ts)\n"
        sql += "-- -------------------------------------------------------------\n\n\n"

        // DROP
        sql += "DROP TABLE IF EXISTS \(qualified);\n"

        // Sequences (PostgreSQL only — detect from defaultValue containing nextval)
        if databaseType == .postgresql {
            var seqNames: [String] = []
            for col in description.columns {
                if let def = col.defaultValue, def.contains("nextval(") {
                    // Extract sequence name from nextval('name'::regclass) or nextval('name')
                    let pattern = #"nextval\(['"]?([^'")]+)['"]?"#
                    if let regex = try? NSRegularExpression(pattern: pattern),
                       let match = regex.firstMatch(in: def, range: NSRange(def.startIndex..., in: def)),
                       let range = Range(match.range(at: 1), in: def) {
                        let name = String(def[range])
                        seqNames.append(name)
                    }
                }
            }
            if !seqNames.isEmpty {
                sql += "-- Sequence and defined type\n"
                for name in seqNames {
                    sql += "CREATE SEQUENCE IF NOT EXISTS \(name);\n"
                }
                sql += "\n"
            }
        }

        // CREATE TABLE
        sql += "-- Table Definition\n"
        sql += "CREATE TABLE \(qualified) (\n"
        var colDefs: [String] = []
        for col in description.columns {
            var def = "    \(d.quoteIdentifier(col.name)) \(col.dataType)"
            if !col.isNullable { def += " NOT NULL" }
            if let defVal = col.defaultValue, !defVal.isEmpty {
                def += " DEFAULT \(defVal)"
            }
            colDefs.append(def)
        }
        // Primary key
        let pkCols = description.columns.filter(\.isPrimaryKey).map { d.quoteIdentifier($0.name) }
        if !pkCols.isEmpty {
            colDefs.append("    PRIMARY KEY (\(pkCols.joined(separator: ", ")))")
        }
        sql += colDefs.joined(separator: ",\n")
        sql += "\n);\n\n"

        // INSERT rows (multi-row single statement)
        if !rows.isEmpty {
            let colList = description.columns.map { d.quoteIdentifier($0.name) }.joined(separator: ", ")
            sql += "INSERT INTO \(qualified) (\(colList)) VALUES\n"
            let rowStrings: [String] = rows.map { row in
                let values = row.enumerated().map { (idx, value) -> String in
                    formatValue(value, columnType: idx < description.columns.count ? description.columns[idx].dataType : "")
                }.joined(separator: ", ")
                return "(\(values))"
            }
            sql += rowStrings.joined(separator: ",\n")
            sql += ";\n\n"
        }

        // Indices (skip primary key index — already included in CREATE TABLE)
        let nonPKIndexes = description.indexes.filter {
            !$0.name.hasSuffix("_pkey") && !$0.name.hasSuffix("_pk")
        }
        if !nonPKIndexes.isEmpty {
            sql += "\n-- Indices\n"
            for idx in nonPKIndexes {
                let unique = idx.isUnique ? "UNIQUE " : ""
                let method = idx.type?.lowercased() ?? "btree"
                let cols = idx.columns.joined(separator: ", ")
                if databaseType == .postgresql {
                    var indexSQL = "CREATE \(unique)INDEX \(idx.name) ON \(qualified) USING \(method) (\(cols))"
                    if let include = idx.include, !include.isEmpty {
                        indexSQL += " INCLUDE (\(include))"
                    }
                    if let cond = idx.condition, !cond.isEmpty {
                        indexSQL += " WHERE \(cond)"
                    }
                    indexSQL += ";\n"
                    sql += indexSQL
                } else {
                    sql += "CREATE \(unique)INDEX \(idx.name) ON \(qualified) (\(cols));\n"
                }
            }
        }

        try sql.write(to: url, atomically: true, encoding: .utf8)
    }

    /// Format a row value for SQL output — handles NULL, numbers, booleans,
    /// timestamps, and quoted strings with proper escaping.
    private func formatValue(_ value: RowValue, columnType: String) -> String {
        if value.isNull { return "NULL" }
        let raw = value.description
        let typeLower = columnType.lowercased()

        // Numeric types — no quotes
        if typeLower.contains("int") || typeLower == "float" || typeLower == "double" ||
            typeLower.contains("numeric") || typeLower.contains("decimal") ||
            typeLower.contains("real") || typeLower == "serial" || typeLower == "bigserial" {
            return raw.isEmpty ? "NULL" : raw
        }

        // Boolean
        if typeLower == "bool" || typeLower == "boolean" {
            let lower = raw.lowercased()
            if lower == "true" || lower == "t" || lower == "1" { return "true" }
            if lower == "false" || lower == "f" || lower == "0" { return "false" }
            return "NULL"
        }

        // Everything else — quote and escape
        let escaped = raw.replacingOccurrences(of: "'", with: "''")
        return "'\(escaped)'"
    }

    func exportExcel(data: QueryResult, to url: URL) async throws {
        // TODO: Implement Excel export using a library
        throw GridexError.unsupportedOperation("Excel export not yet implemented")
    }

    func exportSchemaDDL(schema: SchemaSnapshot, to url: URL) async throws {
        let dialect = schema.databaseType.sqlDialect
        var ddl = "-- Schema export: \(schema.databaseName)\n"
        ddl += "-- Generated by Gridex on \(ISO8601DateFormatter().string(from: Date()))\n\n"

        for table in schema.allTables {
            ddl += table.toDDL(dialect: dialect) + "\n\n"
        }

        try ddl.write(to: url, atomically: true, encoding: .utf8)
    }
}
