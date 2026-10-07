// MSSQLAdapter.swift
// Gridex
//
// Microsoft SQL Server adapter using CosmoMSSQL (TDS 7.4, pure Swift NIO).
// Compatible with SQL Server 2014+ and Azure SQL Edge / Azure SQL Database.

import Foundation
import CosmoMSSQL
import CosmoSQLCore
import NIOCore

final class MSSQLAdapter: DatabaseAdapter, @unchecked Sendable {

    // MARK: - Properties

    let databaseType: DatabaseType = .mssql
    private(set) var isConnected: Bool = false

    private var pool: MSSQLConnectionPool?
    private var connectionConfig: ConnectionConfig?
    /// Tracks the database name when USE statements switch context. Required because
    /// each pooled connection initially uses the configured database, so explicit
    /// USE on each acquired connection is necessary.
    private var currentDB: String?
    /// Single connection used for transactions (to ensure all commands run on the same conn)
    private var txConnection: MSSQLConnection?

    // MARK: - Connection Lifecycle

    func connect(config: ConnectionConfig, password: String?) async throws {
        let host = config.host ?? "localhost"
        let port = config.port ?? 1433
        let database = config.database ?? "master"
        let username = config.username ?? "sa"

        // SQL Server SSL handling:
        // - sslEnabled=false → .disable (no TLS attempt)
        // - sslEnabled=true  → .prefer  (try TLS, fall back to plaintext if server rejects)
        //   We avoid .require because dev/Docker SQL Server often has no valid cert.
        let tlsMode: SQLTLSConfiguration = config.sslEnabled ? .prefer : .disable

        var mssqlConfig = MSSQLConnection.Configuration(
            host: host,
            port: port,
            database: database,
            username: username,
            password: password ?? "",
            tls: tlsMode,
            trustServerCertificate: true,  // Skip cert verification (common for dev/Docker)
            connectTimeout: 15
        )
        mssqlConfig.queryTimeout = 60

        let newPool = MSSQLConnectionPool(configuration: mssqlConfig, maxConnections: 5)

        do {
            // Verify connection works by acquiring + releasing a connection
            try await newPool.withConnection { conn in
                _ = try await conn.query("SELECT 1", [])
            }
            self.pool = newPool
            self.connectionConfig = config
            self.currentDB = database
            self.isConnected = true
        } catch {
            try? await newPool.close()
            let nsErr = NSError(
                domain: "MSSQL",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "MSSQL connect failed: \(error)"]
            )
            throw GridexError.connectionFailed(underlying: nsErr)
        }
    }

    func disconnect() async throws {
        if let txConn = txConnection {
            try? await txConn.close()
            txConnection = nil
        }
        if let pool = pool {
            try? await pool.close()
        }
        pool = nil
        connectionConfig = nil
        currentDB = nil
        isConnected = false
    }

    func testConnection(config: ConnectionConfig, password: String?) async throws -> Bool {
        let adapter = MSSQLAdapter()
        do {
            try await adapter.connect(config: config, password: password)
            _ = try await adapter.serverVersion()
            try await adapter.disconnect()
            return true
        } catch {
            try? await adapter.disconnect()
            throw error
        }
    }

    // MARK: - Helpers

    private func requirePool() throws -> MSSQLConnectionPool {
        guard let pool = pool else {
            throw GridexError.connectionFailed(underlying: NSError(
                domain: "MSSQL", code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Not connected to SQL Server"]))
        }
        return pool
    }

    /// A dedicated connection for script execution — lets multi-batch scripts
    /// (CREATE DATABASE + USE + CREATE TABLE ...) share session state.
    private var scriptConnection: MSSQLConnection?

    /// Begin a multi-batch script session. All subsequent executeRaw calls will
    /// reuse the same connection until `endScript()` is called, so USE statements
    /// persist across batches. Not reentrant.
    func beginScript() async throws {
        let pool = try requirePool()
        let conn = try await pool.acquire()
        if let dbName = currentDB {
            let safeName = dbName.replacingOccurrences(of: "]", with: "]]")
            _ = try? await conn.execute("USE [\(safeName)]", [])
        }
        scriptConnection = conn
    }

    /// End a script session, releasing the dedicated connection back to the pool.
    func endScript() async {
        guard let conn = scriptConnection, let pool = pool else {
            scriptConnection = nil
            return
        }
        await pool.release(conn)
        scriptConnection = nil
    }

    /// Run a closure with a pooled connection. Priority order:
    /// 1. Transaction connection (if in transaction)
    /// 2. Script connection (if inside a script session)
    /// 3. Fresh pooled connection with auto-USE to currentDB
    ///
    /// Pass `skipUSE: true` for statements that manage databases themselves
    /// (CREATE DATABASE, DROP DATABASE, USE) to avoid interfering with them.
    private func withConnection<T: Sendable>(skipUSE: Bool = false, _ work: @Sendable (MSSQLConnection) async throws -> T) async throws -> T {
        if let txConn = txConnection {
            return try await work(txConn)
        }
        if let scriptConn = scriptConnection {
            // Script session: reuse same connection so USE persists across batches
            return try await work(scriptConn)
        }
        let pool = try requirePool()
        return try await pool.withConnection { conn in
            // Switch to current database (USE) since pooled connections may be on a different DB
            if !skipUSE, let dbName = self.currentDB {
                let safeName = dbName.replacingOccurrences(of: "]", with: "]]")
                _ = try? await conn.execute("USE [\(safeName)]", [])
            }
            return try await work(conn)
        }
    }

    /// Convert a SQLValue (CosmoSQL) into a Gridex RowValue.
    private func sqlValueToRowValue(_ value: SQLValue) -> RowValue {
        switch value {
        case .null: return .null
        case .bool(let b): return .boolean(b)
        case .int(let i): return .integer(Int64(i))
        case .int8(let i): return .integer(Int64(i))
        case .int16(let i): return .integer(Int64(i))
        case .int32(let i): return .integer(Int64(i))
        case .int64(let i): return .integer(i)
        case .float(let f): return .double(Double(f))
        case .double(let d): return .double(d)
        case .decimal(let d): return .string("\(d)")
        case .string(let s): return .string(s)
        case .bytes(let bytes): return .data(Data(bytes))
        case .uuid(let u): return .uuid(u)
        case .date(let d): return .date(d)
        }
    }

    /// Convert a Gridex RowValue into a CosmoSQL SQLValue.
    private func rowValueToSQLValue(_ value: RowValue) -> SQLValue {
        switch value {
        case .null: return .null
        case .string(let s): return .string(s)
        case .integer(let i): return .int64(i)
        case .double(let d): return .double(d)
        case .boolean(let b): return .bool(b)
        case .date(let d): return .date(d)
        case .data(let d): return .bytes([UInt8](d))
        case .json(let s): return .string(s)
        case .uuid(let u): return .uuid(u)
        case .array(let arr): return .string(arr.map(\.description).joined(separator: ", "))
        }
    }

    // MARK: - Query Execution

    func execute(query: String, parameters: [QueryParameter]?) async throws -> QueryResult {
        try await executeRaw(sql: query)
    }

    func executeRaw(sql: String) async throws -> QueryResult {
        let start = CFAbsoluteTimeGetCurrent()
        let upper = sql.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let qType = detectQueryType(upper)
        // SQL Server doesn't support PostgreSQL-style SHOW. Reject these queries early
        // to avoid sending PostgreSQL-specific commands (e.g. "SHOW ssl") to MSSQL.
        if upper.hasPrefix("SHOW ") {
            throw GridexError.queryExecutionFailed("SHOW statements are not supported in SQL Server")
        }
        let isSelect = qType == .select || upper.hasPrefix("EXPLAIN") || upper.hasPrefix("WITH")

        // Statements that manage database context themselves — don't inject USE before them
        let isDBContextStmt = upper.hasPrefix("USE ")
            || upper.hasPrefix("CREATE DATABASE")
            || upper.hasPrefix("DROP DATABASE")
            || upper.hasPrefix("ALTER DATABASE")

        // Detect USE [dbname] / USE dbname statement to track current DB across pooled connections
        if upper.hasPrefix("USE ") {
            let after = String(sql.dropFirst(4)).trimmingCharacters(in: .whitespacesAndNewlines)
            let dbName = after.trimmingCharacters(in: CharacterSet(charactersIn: "[]\"`'; "))
            if !dbName.isEmpty {
                self.currentDB = dbName
            }
        }

        return try await withConnection(skipUSE: isDBContextStmt) { conn in
            do {
                if isSelect {
                    // Use queryMulti to get SQLResultSet with columns even when result has 0 rows
                    let sets = try await conn.queryMulti(sql, [])
                    let elapsed = CFAbsoluteTimeGetCurrent() - start
                    guard let first = sets.first else {
                        return QueryResult(columns: [], rows: [], rowsAffected: 0, executionTime: elapsed, queryType: .select)
                    }
                    let columns = first.columns.map { col in
                        ColumnHeader(
                            name: col.name,
                            dataType: col.dataTypeID.map(String.init) ?? "unknown",
                            isNullable: true,
                            tableName: col.table
                        )
                    }
                    let resultRows: [[RowValue]] = first.rows.map { row in
                        row.values.map { self.sqlValueToRowValue($0) }
                    }
                    return QueryResult(columns: columns, rows: resultRows, rowsAffected: 0, executionTime: elapsed, queryType: .select)
                } else {
                    let affected = try await conn.execute(sql, [])
                    let elapsed = CFAbsoluteTimeGetCurrent() - start
                    return QueryResult(columns: [], rows: [], rowsAffected: affected, executionTime: elapsed, queryType: qType)
                }
            } catch {
                print("[MSSQL] Query failed: \(sql.prefix(200)) — \(error)")
                // Rewrap SQLError to preserve rich description (enum errors lose detail
                // through default NSError bridging, appearing as "error 0")
                throw GridexError.queryExecutionFailed(String(describing: error))
            }
        }
    }

    func executeWithRowValues(sql: String, parameters: [RowValue]) async throws -> QueryResult {
        // CosmoMSSQL's RPC (sp_executesql) path hardcodes the transaction descriptor to 0,
        // so parameterized queries inside explicit transactions fail with error 3989
        // ("New request is not allowed to start because it should come with valid
        // transaction descriptor"). Work around by inlining @pN placeholders into SQL
        // and routing through executeRaw (SQL_BATCH, which correctly carries the descriptor).
        let inlined = inlinePlaceholders(sql: sql, parameters: parameters)
        return try await executeRaw(sql: inlined)
    }

    /// Replace @p1, @p2, ... placeholders with literal values (with proper escaping).
    /// Processed in reverse order so @p1 doesn't match inside @p10, @p11, etc.
    private func inlinePlaceholders(sql: String, parameters: [RowValue]) -> String {
        var result = sql
        for i in stride(from: parameters.count, through: 1, by: -1) {
            let placeholder = "@p\(i)"
            let literal = mssqlLiteral(parameters[i - 1])
            result = result.replacingOccurrences(of: placeholder, with: literal)
        }
        return result
    }

    private func mssqlLiteral(_ value: RowValue) -> String {
        switch value {
        case .null: return "NULL"
        case .string(let s): return "N'\(s.replacingOccurrences(of: "'", with: "''"))'"
        case .integer(let i): return "\(i)"
        case .double(let d): return "\(d)"
        case .boolean(let b): return b ? "1" : "0"
        case .date(let d):
            let fmt = DateFormatter()
            fmt.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
            fmt.timeZone = TimeZone(identifier: "UTC")
            return "'\(fmt.string(from: d))'"
        case .uuid(let u): return "'\(u.uuidString)'"
        case .json(let s): return "N'\(s.replacingOccurrences(of: "'", with: "''"))'"
        case .data(let d):
            let hex = d.map { String(format: "%02X", $0) }.joined()
            return "0x\(hex)"
        case .array: return "NULL"
        }
    }

    private func detectQueryType(_ upper: String) -> QueryType {
        if upper.hasPrefix("SELECT") { return .select }
        if upper.hasPrefix("INSERT") { return .insert }
        if upper.hasPrefix("UPDATE") { return .update }
        if upper.hasPrefix("DELETE") { return .delete }
        if upper.hasPrefix("CREATE") || upper.hasPrefix("ALTER") || upper.hasPrefix("DROP") || upper.hasPrefix("TRUNCATE") { return .ddl }
        return .other
    }

    // MARK: - Schema Inspection

    func listDatabases() async throws -> [String] {
        let result = try await executeRaw(sql: """
            SELECT name FROM sys.databases
            WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')
            ORDER BY name
            """)
        return result.rows.compactMap { $0.first?.stringValue }
    }

    func listSchemas(database: String?) async throws -> [String] {
        let result = try await executeRaw(sql: """
            SELECT SCHEMA_NAME
            FROM INFORMATION_SCHEMA.SCHEMATA
            WHERE SCHEMA_NAME NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest', 'db_owner', 'db_accessadmin',
                'db_securityadmin', 'db_ddladmin', 'db_backupoperator', 'db_datareader',
                'db_datawriter', 'db_denydatareader', 'db_denydatawriter')
            ORDER BY SCHEMA_NAME
            """)
        return result.rows.compactMap { $0.first?.stringValue }
    }

    func listTables(schema: String?) async throws -> [TableInfo] {
        let schemaName = schema ?? "dbo"
        // Use INFORMATION_SCHEMA.TABLES for portability across SQL Server / Azure SQL Edge
        let result = try await executeRaw(sql: """
            SELECT TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = '\(schemaName)' AND TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
            """)
        return result.rows.compactMap { row -> TableInfo? in
            guard let name = row.first?.stringValue else { return nil }
            return TableInfo(name: name, schema: schemaName, type: .table, estimatedRowCount: nil)
        }
    }

    func listViews(schema: String?) async throws -> [ViewInfo] {
        let schemaName = schema ?? "dbo"
        let result = try await executeRaw(sql: """
            SELECT TABLE_NAME
            FROM INFORMATION_SCHEMA.VIEWS
            WHERE TABLE_SCHEMA = '\(schemaName)'
            ORDER BY TABLE_NAME
            """)
        return result.rows.compactMap { row -> ViewInfo? in
            guard let name = row.first?.stringValue else { return nil }
            return ViewInfo(name: name, schema: schemaName, definition: nil, isMaterialized: false)
        }
    }

    func describeTable(name: String, schema: String?) async throws -> TableDescription {
        let schemaName = schema ?? "dbo"

        // Get primary key columns first via INFORMATION_SCHEMA
        let pkResult = try? await executeRaw(sql: """
            SELECT kcu.COLUMN_NAME
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
            WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
              AND tc.TABLE_SCHEMA = '\(schemaName)'
              AND tc.TABLE_NAME = '\(name)'
            """)
        let pkColumns: Set<String> = Set((pkResult?.rows ?? []).compactMap { $0.first?.stringValue })

        // Columns via INFORMATION_SCHEMA
        let colResult = try await executeRaw(sql: """
            SELECT
                COLUMN_NAME,
                DATA_TYPE,
                IS_NULLABLE,
                COLUMN_DEFAULT,
                ORDINAL_POSITION,
                CHARACTER_MAXIMUM_LENGTH,
                COLUMNPROPERTY(OBJECT_ID('\(schemaName).\(name)'), COLUMN_NAME, 'IsIdentity') AS is_identity
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = '\(schemaName)' AND TABLE_NAME = '\(name)'
            ORDER BY ORDINAL_POSITION
            """)

        let columns: [ColumnInfo] = colResult.rows.enumerated().compactMap { (idx, row) in
            guard let colName = row[0].stringValue,
                  let dataType = row[1].stringValue else { return nil }
            return ColumnInfo(
                name: colName,
                dataType: dataType,
                isNullable: (row[2].stringValue ?? "YES") == "YES",
                defaultValue: row[3].stringValue,
                isPrimaryKey: pkColumns.contains(colName),
                isAutoIncrement: row[6].intValue == 1,
                comment: nil,
                ordinalPosition: idx + 1,
                characterMaxLength: row[5].intValue
            )
        }

        // Indexes — empty for now (requires sys.* views; add later if needed)
        let indexes: [IndexInfo] = []

        // Foreign keys via INFORMATION_SCHEMA
        let fkResult = try? await executeRaw(sql: """
            SELECT
                rc.CONSTRAINT_NAME,
                kcu.COLUMN_NAME,
                rkcu.TABLE_NAME AS REF_TABLE,
                rkcu.COLUMN_NAME AS REF_COLUMN
            FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
            INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
            INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE rkcu
                ON rc.UNIQUE_CONSTRAINT_NAME = rkcu.CONSTRAINT_NAME
                AND kcu.ORDINAL_POSITION = rkcu.ORDINAL_POSITION
            WHERE kcu.TABLE_SCHEMA = '\(schemaName)' AND kcu.TABLE_NAME = '\(name)'
            """)

        let foreignKeys: [ForeignKeyInfo] = (fkResult?.rows ?? []).compactMap { row in
            guard let fkName = row[0].stringValue,
                  let column = row[1].stringValue,
                  let refTable = row[2].stringValue,
                  let refCol = row[3].stringValue else { return nil }
            return ForeignKeyInfo(
                name: fkName,
                columns: [column],
                referencedTable: refTable,
                referencedColumns: [refCol],
                onDelete: .noAction,
                onUpdate: .noAction
            )
        }

        // Row count: skip for now (would require COUNT(*) which is slow)
        let rowCount: Int? = nil

        return TableDescription(
            name: name,
            schema: schemaName,
            columns: columns,
            indexes: indexes,
            foreignKeys: foreignKeys,
            constraints: [],
            comment: nil,
            estimatedRowCount: rowCount
        )
    }

    func listIndexes(table: String, schema: String?) async throws -> [IndexInfo] {
        try await describeTable(name: table, schema: schema).indexes
    }

    func listForeignKeys(table: String, schema: String?) async throws -> [ForeignKeyInfo] {
        try await describeTable(name: table, schema: schema).foreignKeys
    }

    func listFunctions(schema: String?) async throws -> [String] {
        let schemaName = schema ?? "dbo"
        let result = try await executeRaw(sql: """
            SELECT ROUTINE_NAME
            FROM INFORMATION_SCHEMA.ROUTINES
            WHERE ROUTINE_SCHEMA = '\(schemaName)' AND ROUTINE_TYPE = 'FUNCTION'
            ORDER BY ROUTINE_NAME
            """)
        return result.rows.compactMap { $0.first?.stringValue }
    }

    func getFunctionSource(name: String, schema: String?) async throws -> String {
        let schemaName = schema ?? "dbo"
        let result = try await executeRaw(sql: """
            SELECT ROUTINE_DEFINITION
            FROM INFORMATION_SCHEMA.ROUTINES
            WHERE ROUTINE_SCHEMA = '\(schemaName)' AND ROUTINE_NAME = '\(name)'
            """)
        return result.rows.first?.first?.stringValue ?? ""
    }

    func listProcedures(schema: String?) async throws -> [String] {
        let schemaName = schema ?? "dbo"
        let result = try await executeRaw(sql: """
            SELECT ROUTINE_NAME
            FROM INFORMATION_SCHEMA.ROUTINES
            WHERE ROUTINE_SCHEMA = '\(schemaName)' AND ROUTINE_TYPE = 'PROCEDURE'
            ORDER BY ROUTINE_NAME
            """)
        return result.rows.compactMap { $0.first?.stringValue }
    }

    func getProcedureSource(name: String, schema: String?) async throws -> String {
        // Same as getFunctionSource since INFORMATION_SCHEMA.ROUTINES stores both.
        try await getFunctionSource(name: name, schema: schema)
    }

    func listProcedureParameters(name: String, schema: String?) async throws -> [String] {
        let schemaName = schema ?? "dbo"
        let result = try await executeRaw(sql: """
            SELECT
                PARAMETER_NAME,
                DATA_TYPE,
                CHARACTER_MAXIMUM_LENGTH,
                NUMERIC_PRECISION,
                NUMERIC_SCALE,
                PARAMETER_MODE
            FROM INFORMATION_SCHEMA.PARAMETERS
            WHERE SPECIFIC_SCHEMA = '\(schemaName)' AND SPECIFIC_NAME = '\(name)'
            ORDER BY ORDINAL_POSITION
            """)
        return result.rows.compactMap { row -> String? in
            guard let paramName = row[0].stringValue, !paramName.isEmpty else { return nil }
            let dataType = row[1].stringValue ?? "UNKNOWN"
            let mode = (row[5].stringValue ?? "IN").uppercased()
            // Build typed signature: VARCHAR(255), DECIMAL(18,2), etc.
            var typeStr = dataType.uppercased()
            if let maxLen = row[2].intValue, maxLen > 0 {
                typeStr += "(\(maxLen))"
            } else if let precision = row[3].intValue, precision > 0 {
                if let scale = row[4].intValue, scale > 0 {
                    typeStr += "(\(precision),\(scale))"
                } else {
                    typeStr += "(\(precision))"
                }
            }
            // Mode: IN (default) / INOUT / OUT
            let modeLabel: String
            switch mode {
            case "INOUT", "IN OUT": modeLabel = " INOUT"
            case "OUT": modeLabel = " OUTPUT"
            default: modeLabel = ""  // IN is implicit
            }
            return "\(paramName) \(typeStr)\(modeLabel)"
        }
    }

    // MARK: - Data Manipulation

    func insertRow(table: String, schema: String?, values: [String: RowValue]) async throws -> QueryResult {
        let d = SQLDialect.mssql
        let schemaPrefix = schema.map { d.quoteIdentifier($0) + "." } ?? ""
        let qualified = "\(schemaPrefix)\(d.quoteIdentifier(table))"
        let cols = values.keys.sorted()
        let colList = cols.map { d.quoteIdentifier($0) }.joined(separator: ", ")
        let placeholders = (1...cols.count).map { "@p\($0)" }.joined(separator: ", ")
        let sql = "INSERT INTO \(qualified) (\(colList)) VALUES (\(placeholders))"
        let params = cols.map { values[$0] ?? .null }
        return try await executeWithRowValues(sql: sql, parameters: params)
    }

    func updateRow(table: String, schema: String?, set: [String: RowValue], where whereClause: [String: RowValue]) async throws -> QueryResult {
        let d = SQLDialect.mssql
        let schemaPrefix = schema.map { d.quoteIdentifier($0) + "." } ?? ""
        let qualified = "\(schemaPrefix)\(d.quoteIdentifier(table))"

        let setKeys = set.keys.sorted()
        let whereKeys = whereClause.keys.sorted()
        var idx = 1
        let setClauses = setKeys.map { col -> String in
            defer { idx += 1 }
            return "\(d.quoteIdentifier(col)) = @p\(idx)"
        }.joined(separator: ", ")
        let whereClauses = whereKeys.map { col -> String in
            defer { idx += 1 }
            return "\(d.quoteIdentifier(col)) = @p\(idx)"
        }.joined(separator: " AND ")

        let sql = "UPDATE \(qualified) SET \(setClauses) WHERE \(whereClauses)"
        let params = setKeys.map { set[$0] ?? .null } + whereKeys.map { whereClause[$0] ?? .null }
        return try await executeWithRowValues(sql: sql, parameters: params)
    }

    func deleteRow(table: String, schema: String?, where whereClause: [String: RowValue]) async throws -> QueryResult {
        let d = SQLDialect.mssql
        let schemaPrefix = schema.map { d.quoteIdentifier($0) + "." } ?? ""
        let qualified = "\(schemaPrefix)\(d.quoteIdentifier(table))"
        let whereKeys = whereClause.keys.sorted()
        let clauses = whereKeys.enumerated().map { (i, col) in
            "\(d.quoteIdentifier(col)) = @p\(i + 1)"
        }.joined(separator: " AND ")
        let sql = "DELETE FROM \(qualified) WHERE \(clauses)"
        let params = whereKeys.map { whereClause[$0] ?? .null }
        return try await executeWithRowValues(sql: sql, parameters: params)
    }

    // MARK: - Transactions

    func beginTransaction() async throws {
        // Acquire a dedicated connection for the transaction so all subsequent
        // executeRaw / executeWithRowValues calls run on the same session.
        let pool = try requirePool()
        let conn = try await pool.acquire()
        if let dbName = currentDB {
            let safeName = dbName.replacingOccurrences(of: "]", with: "]]")
            _ = try? await conn.execute("USE [\(safeName)]", [])
        }
        try await conn.beginTransaction()
        txConnection = conn
    }

    func commitTransaction() async throws {
        guard let conn = txConnection else { return }
        try await conn.commitTransaction()
        if let pool = pool {
            await pool.release(conn)
        }
        txConnection = nil
    }

    func rollbackTransaction() async throws {
        guard let conn = txConnection else { return }
        try await conn.rollbackTransaction()
        if let pool = pool {
            await pool.release(conn)
        }
        txConnection = nil
    }

    // MARK: - Pagination

    func fetchRows(
        table: String,
        schema: String?,
        columns: [String]?,
        where filter: FilterExpression?,
        orderBy: [QuerySortDescriptor]?,
        limit: Int,
        offset: Int
    ) async throws -> QueryResult {
        let d = SQLDialect.mssql
        let schemaPrefix = schema.map { d.quoteIdentifier($0) + "." } ?? d.quoteIdentifier("dbo") + "."
        let qualified = "\(schemaPrefix)\(d.quoteIdentifier(table))"
        let colList = columns?.map { d.quoteIdentifier($0) }.joined(separator: ", ") ?? "*"

        var sql = "SELECT \(colList) FROM \(qualified)"
        if let filter, !filter.conditions.isEmpty {
            sql += " WHERE \(filter.toSQL(dialect: d))"
        }
        // SQL Server requires ORDER BY for OFFSET/FETCH
        if let orderBy, !orderBy.isEmpty {
            sql += " ORDER BY " + orderBy.map { $0.toSQL(dialect: d) }.joined(separator: ", ")
        } else {
            sql += " ORDER BY (SELECT NULL)"
        }
        sql += " OFFSET \(offset) ROWS FETCH NEXT \(limit) ROWS ONLY"
        return try await executeRaw(sql: sql)
    }

    // MARK: - Database Management

    func createDatabase(name: String) async throws {
        let d = SQLDialect.mssql
        _ = try await executeRaw(sql: "CREATE DATABASE \(d.quoteIdentifier(name))")
    }

    func dropDatabase(name: String) async throws {
        let d = SQLDialect.mssql
        // Force-disconnect users by setting SINGLE_USER first
        _ = try? await executeRaw(sql: "ALTER DATABASE \(d.quoteIdentifier(name)) SET SINGLE_USER WITH ROLLBACK IMMEDIATE")
        _ = try await executeRaw(sql: "DROP DATABASE \(d.quoteIdentifier(name))")
    }

    // MARK: - Database Info

    func serverVersion() async throws -> String {
        // Use SERVERPROPERTY which is safer and works on all SQL Server variants
        // (including Azure SQL Edge / Azure SQL Database).
        let r = try await executeRaw(sql: "SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(128))")
        return r.rows.first?.first?.stringValue ?? "SQL Server"
    }

    func currentDatabase() async throws -> String? {
        let r = try await executeRaw(sql: "SELECT DB_NAME()")
        return r.rows.first?.first?.stringValue
    }
}
