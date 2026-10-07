#pragma once
#include <string>
#include <vector>
#include <memory>
#include <stdexcept>
#include "ConnectionConfig.h"
#include "ColumnInfo.h"
#include "TableRow.h"
#include "QueryResult.h"
#include "TableInfo.h"
#include "RowValue.h"

namespace DBModels
{
    // Error type for database operations
    class DatabaseError : public std::runtime_error
    {
    public:
        enum class Code
        {
            ConnectionFailed, ConnectionTimeout, AuthenticationFailed,
            SSLRequired, DatabaseNotFound,
            QueryFailed, QueryCancelled, QueryTimeout, InvalidSQL,
            SSHFailed, SSHAuthFailed, SSHTunnelFailed,
            SchemaLoadFailed, TableNotFound,
            TransactionFailed, PermissionDenied, Unknown
        };

        Code code;

        DatabaseError(Code c, const std::string& msg)
            : std::runtime_error(msg), code(c) {}
    };

    // Abstract database adapter interface
    class DatabaseAdapter
    {
    public:
        virtual ~DatabaseAdapter() = default;

        // ── Connection ──────────────────────────────
        virtual void connect(const ConnectionConfig& config, const std::wstring& password) = 0;
        virtual void disconnect() = 0;
        virtual bool testConnection(const ConnectionConfig& config, const std::wstring& password) = 0;
        virtual bool isConnected() const = 0;

        // ── Query Execution ─────────────────────────
        virtual QueryResult execute(const std::wstring& sql) = 0;
        virtual QueryResult fetchRows(
            const std::wstring& table,
            const std::wstring& schema,
            int limit = 100,
            int offset = 0,
            const std::wstring& orderBy = L"",
            bool ascending = true) = 0;

        // ── Schema Inspection ───────────────────────
        virtual std::vector<std::wstring> listDatabases() = 0;
        virtual std::vector<std::wstring> listSchemas() = 0;
        virtual std::vector<TableInfo> listTables(const std::wstring& schema) = 0;
        virtual std::vector<TableInfo> listViews(const std::wstring& schema) = 0;
        virtual std::vector<ColumnInfo> describeTable(
            const std::wstring& table, const std::wstring& schema) = 0;
        virtual std::vector<IndexInfo> listIndexes(
            const std::wstring& table, const std::wstring& schema) = 0;
        virtual std::vector<ForeignKeyInfo> listForeignKeys(
            const std::wstring& table, const std::wstring& schema) = 0;
        virtual std::vector<std::wstring> listFunctions(const std::wstring& schema) = 0;
        virtual std::wstring getFunctionSource(
            const std::wstring& name, const std::wstring& schema) = 0;

        // Return CREATE TABLE DDL for a single table (no trailing semicolon)
        virtual std::wstring getCreateTableSQL(
            const std::wstring& table, const std::wstring& schema) = 0;

        // ── Data Manipulation ───────────────────────
        virtual QueryResult insertRow(
            const std::wstring& table, const std::wstring& schema,
            const TableRow& values) = 0;
        virtual QueryResult updateRow(
            const std::wstring& table, const std::wstring& schema,
            const TableRow& setValues, const TableRow& whereValues) = 0;
        virtual QueryResult deleteRow(
            const std::wstring& table, const std::wstring& schema,
            const TableRow& whereValues) = 0;

        // ── Transactions ────────────────────────────
        virtual void beginTransaction() = 0;
        virtual void commitTransaction() = 0;
        virtual void rollbackTransaction() = 0;

        // ── Server Info ─────────────────────────────
        virtual std::wstring serverVersion() = 0;
        virtual std::wstring currentDatabase() = 0;

        // ── SQL string assembly helpers ─────────────
        // Quote a literal value for this DB engine's SQL grammar, e.g.
        // O'Brien → 'O''Brien'. Used by callers that assemble ad-hoc
        // WHERE clauses outside the adapter's own CRUD path (enterprise
        // row-relationship graph builds SELECT ... WHERE col IN (...)).
        // Default throws — non-SQL adapters (Mongo, Redis) inherit the
        // default so accidental calls fail loudly instead of silently
        // producing wrong SQL.
        virtual std::wstring quoteSqlLiteral(const std::wstring& /*value*/) const
        {
            throw DatabaseError(DatabaseError::Code::Unknown,
                "quoteSqlLiteral not supported on this adapter");
        }

        // Quote an identifier (table / column / schema) for this engine's
        // grammar: PostgreSQL/SQLite "name", MySQL `name`, MSSQL [name].
        // Same rationale and default-throw semantics as quoteSqlLiteral.
        virtual std::wstring quoteSqlIdentifier(const std::wstring& /*name*/) const
        {
            throw DatabaseError(DatabaseError::Code::Unknown,
                "quoteSqlIdentifier not supported on this adapter");
        }

        // ── Adapter-specific tuning (default: no-op) ───
        // Redis uses this to set the SCAN MATCH pattern for fetchRows.
        // SQL adapters ignore it. Pass "*" or empty to disable filtering.
        virtual void setSearchPattern(const std::wstring& /*pattern*/) {}
    };
}
