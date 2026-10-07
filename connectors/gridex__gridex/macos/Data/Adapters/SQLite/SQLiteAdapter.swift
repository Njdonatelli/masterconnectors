// SQLiteAdapter.swift
// Gridex
//
// SQLite database adapter using the sqlite3 C API.
// Thread-safe via serial DispatchQueue.

import Foundation
import SQLite3

final class SQLiteAdapter: DatabaseAdapter, SchemaInspectable, @unchecked Sendable {
    let databaseType: DatabaseType = .sqlite
    private(set) var isConnected: Bool = false
    private var db: OpaquePointer?
    private var filePath: String?
    private let queue = DispatchQueue(label: "com.gridex.sqlite", qos: .userInitiated)

    deinit {
        if let db { sqlite3_close_v2(db) }
    }

    // MARK: - Connection

    func connect(config: ConnectionConfig, password: String?) async throws {
        guard let path = config.filePath else {
            throw GridexError.connectionFailed(underlying: NSError(domain: "SQLite", code: -1, userInfo: [NSLocalizedDescriptionKey: "No file path"]))
        }
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            queue.async {
                let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
                var dbPointer: OpaquePointer?
                let rc = sqlite3_open_v2(path, &dbPointer, flags, nil)
                if rc != SQLITE_OK {
                    let msg = dbPointer.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "Unknown"
                    sqlite3_close_v2(dbPointer)
                    cont.resume(throwing: GridexError.connectionFailed(underlying: NSError(domain: "SQLite", code: Int(rc), userInfo: [NSLocalizedDescriptionKey: msg])))
                    return
                }
                self.db = dbPointer
                self.filePath = path
                self.isConnected = true
                sqlite3_exec(dbPointer, "PRAGMA journal_mode=WAL", nil, nil, nil)
                sqlite3_exec(dbPointer, "PRAGMA foreign_keys=ON", nil, nil, nil)
                cont.resume()
            }
        }
    }

    func disconnect() async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            queue.async {
                if let db = self.db {
                    sqlite3_close_v2(db)
                    self.db = nil
                }
                self.isConnected = false
                cont.resume()
            }
        }
    }

    func testConnection(config: ConnectionConfig, password: String?) async throws -> Bool {
        guard let path = config.filePath else {
            throw GridexError.connectionFailed(underlying: NSError(domain: "Gridex", code: -1, userInfo: [NSLocalizedDescriptionKey: "No file path specified"]))
        }
        var testDb: OpaquePointer?
        let rc = sqlite3_open_v2(path, &testDb, SQLITE_OPEN_READONLY, nil)
        defer { sqlite3_close_v2(testDb) }
        if rc != SQLITE_OK {
            let msg = testDb.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "Unknown SQLite error"
            throw GridexError.connectionFailed(underlying: NSError(domain: "SQLite", code: Int(rc), userInfo: [NSLocalizedDescriptionKey: msg]))
        }
        return true
    }

    // MARK: - Query Execution

    func execute(query: String, parameters: [QueryParameter]?) async throws -> QueryResult {
        try ensureConnected()
        let startTime = CFAbsoluteTimeGetCurrent()

        return try await withCheckedThrowingContinuation { cont in
            queue.async {
                do {
                    let result = try self.executeSync(sql: query, parameters: parameters, startTime: startTime)
                    cont.resume(returning: result)
                } catch {
                    cont.resume(throwing: error)
                }
            }
        }
    }

    func executeRaw(sql: String) async throws -> QueryResult {
        try await execute(query: sql, parameters: nil)
    }

    private func executeSync(sql: String, parameters: [QueryParameter]?, startTime: CFAbsoluteTime) throws -> QueryResult {
        guard let db else { throw GridexError.queryExecutionFailed("No database connection") }

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
            let msg = String(cString: sqlite3_errmsg(db))
            throw GridexError.queryExecutionFailed(msg)
        }
        defer { sqlite3_finalize(stmt) }

        // Bind parameters
        if let parameters {
            for (i, param) in parameters.enumerated() {
                bindValue(param.value, to: stmt, at: Int32(i + 1))
            }
        }

        // Detect query type
        let upper = sql.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let queryType: QueryType =
            upper.hasPrefix("SELECT") || upper.hasPrefix("PRAGMA") || upper.hasPrefix("EXPLAIN") ? .select :
            upper.hasPrefix("INSERT") ? .insert :
            upper.hasPrefix("UPDATE") ? .update :
            upper.hasPrefix("DELETE") ? .delete :
            upper.hasPrefix("CREATE") || upper.hasPrefix("ALTER") || upper.hasPrefix("DROP") ? .ddl : .other

        // SELECT-like: read all rows
        if queryType == .select {
            let colCount = sqlite3_column_count(stmt)
            var columns: [ColumnHeader] = []
            for i in 0..<colCount {
                let name = String(cString: sqlite3_column_name(stmt, i))
                let declType = sqlite3_column_decltype(stmt, i).map { String(cString: $0) } ?? "TEXT"
                columns.append(ColumnHeader(name: name, dataType: declType))
            }

            var rows: [[RowValue]] = []
            while sqlite3_step(stmt) == SQLITE_ROW {
                var row: [RowValue] = []
                for i in 0..<colCount {
                    row.append(readColumn(stmt: stmt, index: i))
                }
                rows.append(row)
            }

            let duration = CFAbsoluteTimeGetCurrent() - startTime
            return QueryResult(columns: columns, rows: rows, rowsAffected: rows.count, executionTime: duration, queryType: queryType)
        }

        // Non-SELECT: execute and return affected count
        let stepResult = sqlite3_step(stmt)
        guard stepResult == SQLITE_DONE else {
            throw GridexError.queryExecutionFailed(String(cString: sqlite3_errmsg(db)))
        }

        let duration = CFAbsoluteTimeGetCurrent() - startTime
        return QueryResult(columns: [], rows: [], rowsAffected: Int(sqlite3_changes(db)), executionTime: duration, queryType: queryType)
    }

    private func readColumn(stmt: OpaquePointer, index: Int32) -> RowValue {
        switch sqlite3_column_type(stmt, index) {
        case SQLITE_NULL:    return .null
        case SQLITE_INTEGER: return .integer(sqlite3_column_int64(stmt, index))
        case SQLITE_FLOAT:   return .double(sqlite3_column_double(stmt, index))
        case SQLITE_TEXT:    return .string(String(cString: sqlite3_column_text(stmt, index)))
        case SQLITE_BLOB:
            let n = sqlite3_column_bytes(stmt, index)
            if let ptr = sqlite3_column_blob(stmt, index) {
                return .data(Data(bytes: ptr, count: Int(n)))
            }
            return .null
        default: return .null
        }
    }

    private func bindValue(_ value: RowValue, to stmt: OpaquePointer, at idx: Int32) {
        let TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        switch value {
        case .null:          sqlite3_bind_null(stmt, idx)
        case .string(let v): sqlite3_bind_text(stmt, idx, v, -1, TRANSIENT)
        case .integer(let v):sqlite3_bind_int64(stmt, idx, v)
        case .double(let v): sqlite3_bind_double(stmt, idx, v)
        case .boolean(let v):sqlite3_bind_int(stmt, idx, v ? 1 : 0)
        case .date(let v):   sqlite3_bind_text(stmt, idx, ISO8601DateFormatter().string(from: v), -1, TRANSIENT)
        case .data(let v):   _ = v.withUnsafeBytes { sqlite3_bind_blob(stmt, idx, $0.baseAddress, Int32(v.count), TRANSIENT) }
        case .json(let v):   sqlite3_bind_text(stmt, idx, v, -1, TRANSIENT)
        case .uuid(let v):   sqlite3_bind_text(stmt, idx, v.uuidString, -1, TRANSIENT)
        case .array:         sqlite3_bind_text(stmt, idx, value.description, -1, TRANSIENT)
        }
    }

    // MARK: - Schema Inspection

    func listDatabases() async throws -> [String] {
        [filePath.map { URL(fileURLWithPath: $0).lastPathComponent } ?? "main"]
    }

    func listSchemas(database: String?) async throws -> [String] { ["main"] }

    func listTables(schema: String?) async throws -> [TableInfo] {
        let result = try await executeRaw(sql: """
            SELECT name FROM sqlite_master
            WHERE type='table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
            """)
        var tables: [TableInfo] = []
        for row in result.rows {
            guard case .string(let name) = row.first else { continue }
            let count = try? await tableRowCount(table: name, schema: nil)
            tables.append(TableInfo(name: name, schema: nil, type: .table, estimatedRowCount: count))
        }
        return tables
    }

    func listViews(schema: String?) async throws -> [ViewInfo] {
        let result = try await executeRaw(sql: """
            SELECT name, sql FROM sqlite_master WHERE type='view' ORDER BY name
            """)
        return result.rows.compactMap { row in
            guard case .string(let name) = row.first else { return nil }
            return ViewInfo(name: name, schema: nil, definition: row.count > 1 ? row[1].stringValue : nil, isMaterialized: false)
        }
    }

    func describeTable(name: String, schema: String?) async throws -> TableDescription {
        let columns = try await describeColumns(table: name)
        let indexes = try await listIndexes(table: name, schema: nil)
        let fks = try await listForeignKeys(table: name, schema: nil)
        let count = try? await tableRowCount(table: name, schema: nil)
        return TableDescription(name: name, schema: nil, columns: columns, indexes: indexes, foreignKeys: fks, constraints: [], comment: nil, estimatedRowCount: count)
    }

    private func describeColumns(table: String) async throws -> [ColumnInfo] {
        let result = try await executeRaw(sql: "PRAGMA table_info(\(q(table)))")
        return result.rows.enumerated().map { idx, row in
            let cid = row[0].stringValue ?? "\(idx)"
            let name = row[1].stringValue ?? ""
            let type = row[2].stringValue ?? "TEXT"
            let notNull = row[3].stringValue == "1"
            let defVal = row[4].isNull ? nil : row[4].stringValue
            let pk = row[5].stringValue != "0"
            return ColumnInfo(
                name: name, dataType: type, isNullable: !notNull, defaultValue: defVal,
                isPrimaryKey: pk, isAutoIncrement: pk && type.uppercased() == "INTEGER",
                comment: nil, ordinalPosition: Int(cid) ?? idx, characterMaxLength: nil
            )
        }
    }

    func listIndexes(table: String, schema: String?) async throws -> [IndexInfo] {
        let escapedTable = table.replacingOccurrences(of: "'", with: "''")
        let sql = """
            SELECT il.name, il.\"unique\", GROUP_CONCAT(ii.name) AS columns
            FROM pragma_index_list('\(escapedTable)') il
            JOIN pragma_index_info(il.name) ii
            GROUP BY il.name, il.\"unique\"
            ORDER BY il.name, ii.seqno
            """
        let result = try await executeRaw(sql: sql)
        return result.rows.map { row in
            let name = row[0].stringValue ?? ""
            let unique = row[1].stringValue == "1"
            let cols = (row[2].stringValue ?? "").split(separator: ",").map(String.init)
            return IndexInfo(name: name, columns: cols, isUnique: unique, type: "btree", tableName: table)
        }
    }

    func listForeignKeys(table: String, schema: String?) async throws -> [ForeignKeyInfo] {
        let result = try await executeRaw(sql: "PRAGMA foreign_key_list(\(q(table)))")
        return result.rows.map { row in
            ForeignKeyInfo(
                name: nil,
                columns: [row[3].stringValue ?? ""],
                referencedTable: row[2].stringValue ?? "",
                referencedColumns: [row[4].stringValue ?? ""],
                onDelete: ForeignKeyAction(rawValue: row[6].stringValue ?? "NO ACTION") ?? .noAction,
                onUpdate: ForeignKeyAction(rawValue: row[5].stringValue ?? "NO ACTION") ?? .noAction
            )
        }
    }

    func listFunctions(schema: String?) async throws -> [String] {
        return []
    }

    func getFunctionSource(name: String, schema: String?) async throws -> String {
        throw GridexError.queryExecutionFailed("SQLite does not support stored functions")
    }

    // MARK: - Data Manipulation

    func insertRow(table: String, schema: String?, values: [String: RowValue]) async throws -> QueryResult {
        let cols = values.keys.map { q($0) }.joined(separator: ", ")
        let placeholders = values.keys.map { _ in "?" }.joined(separator: ", ")
        return try await execute(query: "INSERT INTO \(q(table)) (\(cols)) VALUES (\(placeholders))",
                                 parameters: values.values.map { QueryParameter($0) })
    }

    func updateRow(table: String, schema: String?, set values: [String: RowValue], where conditions: [String: RowValue]) async throws -> QueryResult {
        let setClauses = values.keys.map { "\(q($0)) = ?" }.joined(separator: ", ")
        let whereClauses = conditions.keys.map { "\(q($0)) = ?" }.joined(separator: " AND ")
        let params = (Array(values.values) + Array(conditions.values)).map { QueryParameter($0) }
        return try await execute(query: "UPDATE \(q(table)) SET \(setClauses) WHERE \(whereClauses)", parameters: params)
    }

    func deleteRow(table: String, schema: String?, where conditions: [String: RowValue]) async throws -> QueryResult {
        let whereClauses = conditions.keys.map { "\(q($0)) = ?" }.joined(separator: " AND ")
        return try await execute(query: "DELETE FROM \(q(table)) WHERE \(whereClauses)",
                                 parameters: conditions.values.map { QueryParameter($0) })
    }

    func beginTransaction() async throws { _ = try await executeRaw(sql: "BEGIN TRANSACTION") }
    func commitTransaction() async throws { _ = try await executeRaw(sql: "COMMIT") }
    func rollbackTransaction() async throws { _ = try await executeRaw(sql: "ROLLBACK") }

    // MARK: - Pagination

    func fetchRows(table: String, schema: String?, columns: [String]?, where filter: FilterExpression?, orderBy: [QuerySortDescriptor]?, limit: Int, offset: Int) async throws -> QueryResult {
        let d = SQLDialect.sqlite
        let colList = columns?.map { d.quoteIdentifier($0) }.joined(separator: ", ") ?? "*"
        var sql = "SELECT \(colList) FROM \(d.quoteIdentifier(table))"
        if let filter, !filter.conditions.isEmpty {
            sql += " WHERE \(filter.toSQL(dialect: d))"
        }
        if let orderBy, !orderBy.isEmpty {
            sql += " ORDER BY " + orderBy.map { $0.toSQL(dialect: d) }.joined(separator: ", ")
        }
        sql += " LIMIT \(limit) OFFSET \(offset)"
        return try await executeRaw(sql: sql)
    }

    func serverVersion() async throws -> String {
        let r = try await executeRaw(sql: "SELECT sqlite_version()")
        return "SQLite " + (r.rows.first?.first?.stringValue ?? "")
    }

    func currentDatabase() async throws -> String? { filePath }

    // MARK: - SchemaInspectable

    func fullSchemaSnapshot(database: String?) async throws -> SchemaSnapshot {
        let tables = try await listTables(schema: nil)
        var descs: [TableDescription] = []
        for t in tables { descs.append(try await describeTable(name: t.name, schema: nil)) }
        let views = try await listViews(schema: nil)
        return SchemaSnapshot(
            databaseName: filePath.map { URL(fileURLWithPath: $0).lastPathComponent } ?? "main",
            databaseType: .sqlite,
            schemas: [SchemaInfo(name: "main", tables: descs, views: views, functions: [], enums: [])],
            capturedAt: Date()
        )
    }

    func columnStatistics(table: String, schema: String?, sampleSize: Int) async throws -> [ColumnStatistics] {
        let cols = try await describeColumns(table: table)
        var stats: [ColumnStatistics] = []
        for col in cols {
            let r = try await executeRaw(sql: """
                SELECT COUNT(DISTINCT \(q(col.name))),
                       CAST(SUM(CASE WHEN \(q(col.name)) IS NULL THEN 1 ELSE 0 END) AS REAL) / MAX(COUNT(*), 1),
                       MIN(\(q(col.name))), MAX(\(q(col.name)))
                FROM \(q(table))
                """)
            if let row = r.rows.first {
                stats.append(ColumnStatistics(
                    columnName: col.name,
                    distinctCount: row[0].stringValue.flatMap(Int.init),
                    nullRatio: row[1].stringValue.flatMap(Double.init),
                    topValues: nil,
                    minValue: row[2].stringValue,
                    maxValue: row[3].stringValue
                ))
            }
        }
        return stats
    }

    func tableRowCount(table: String, schema: String?) async throws -> Int {
        let r = try await executeRaw(sql: "SELECT COUNT(*) FROM \(q(table))")
        guard let row = r.rows.first, case .integer(let n) = row.first else { return 0 }
        return Int(n)
    }

    func tableSizeBytes(table: String, schema: String?) async throws -> Int64? { nil }
    func queryStatistics() async throws -> [QueryStatisticsEntry] { [] }

    func primaryKeyColumns(table: String, schema: String?) async throws -> [String] {
        let r = try await executeRaw(sql: "PRAGMA table_info(\(q(table)))")
        // PRAGMA table_info columns: cid, name, type, notnull, dflt_value, pk
        return r.rows.compactMap { row in
            guard row.count >= 6, let pk = row[5].intValue, pk > 0 else { return nil }
            return row[1].stringValue
        }
    }

    // MARK: - Helpers

    private func ensureConnected() throws {
        guard isConnected, db != nil else {
            throw GridexError.queryExecutionFailed("Not connected to database")
        }
    }

    /// Shorthand for quoting identifiers
    private func q(_ name: String) -> String {
        "\"\(name.replacingOccurrences(of: "\"", with: "\"\""))\""
    }
}
