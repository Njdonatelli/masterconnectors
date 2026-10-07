#pragma once
// MSSQLAdapter — SQL Server support via Windows ODBC API.
//
// Uses the built-in ODBC driver stack (sql.h / sqlext.h) with zero
// external dependencies. Requires "ODBC Driver 18 for SQL Server"
// (or 17, or the legacy "SQL Server" driver) installed on the machine.
//
// Identifier quoting: [schema].[table] (bracket style)
// String literals: N'value' (Unicode prefix)
// Pagination: OFFSET/FETCH NEXT (requires ORDER BY)
// Default schema: dbo (not "public")

#include "DatabaseAdapter.h"
#include <memory>
#include <string>
#include <vector>

// Forward-declare ODBC handle types to avoid including <sql.h> in the
// header (it pulls in windows.h macros that conflict with WinRT).
typedef void* SQLHENV;
typedef void* SQLHDBC;

namespace DBModels
{
    class MSSQLAdapter : public DatabaseAdapter
    {
    public:
        MSSQLAdapter();
        ~MSSQLAdapter() override;

        // ── Connection ──────────────────────────────
        void connect(const ConnectionConfig& config, const std::wstring& password) override;
        void disconnect() override;
        bool testConnection(const ConnectionConfig& config, const std::wstring& password) override;
        bool isConnected() const override;

        // ── Query Execution ─────────────────────────
        QueryResult execute(const std::wstring& sql) override;
        QueryResult fetchRows(
            const std::wstring& table, const std::wstring& schema,
            int limit, int offset,
            const std::wstring& orderBy, bool ascending) override;

        // ── Schema Inspection ───────────────────────
        std::vector<std::wstring> listDatabases() override;
        std::vector<std::wstring> listSchemas() override;
        std::vector<TableInfo> listTables(const std::wstring& schema) override;
        std::vector<TableInfo> listViews(const std::wstring& schema) override;
        std::vector<ColumnInfo> describeTable(
            const std::wstring& table, const std::wstring& schema) override;
        std::vector<IndexInfo> listIndexes(
            const std::wstring& table, const std::wstring& schema) override;
        std::vector<ForeignKeyInfo> listForeignKeys(
            const std::wstring& table, const std::wstring& schema) override;
        std::vector<std::wstring> listFunctions(const std::wstring& schema) override;
        std::wstring getFunctionSource(
            const std::wstring& name, const std::wstring& schema) override;
        std::wstring getCreateTableSQL(
            const std::wstring& table, const std::wstring& schema) override;

        // ── Data Manipulation ───────────────────────
        QueryResult insertRow(
            const std::wstring& table, const std::wstring& schema,
            const TableRow& values) override;
        QueryResult updateRow(
            const std::wstring& table, const std::wstring& schema,
            const TableRow& setValues, const TableRow& whereValues) override;
        QueryResult deleteRow(
            const std::wstring& table, const std::wstring& schema,
            const TableRow& whereValues) override;

        // ── Transactions ────────────────────────────
        void beginTransaction() override;
        void commitTransaction() override;
        void rollbackTransaction() override;

        // ── Server Info ─────────────────────────────
        std::wstring serverVersion() override;
        std::wstring currentDatabase() override;

        // ── SQL string assembly ─────────────────────
        std::wstring quoteSqlLiteral(const std::wstring& value) const override;
        std::wstring quoteSqlIdentifier(const std::wstring& name) const override;

    private:
        SQLHENV hEnv_ = nullptr;
        SQLHDBC hDbc_ = nullptr;
        bool connected_ = false;
        std::string currentDb_;

        // ── Helpers ─────────────────────────────────
        static std::string  toUtf8(const std::wstring& s);
        static std::wstring fromUtf8(const std::string& s);
        static std::string  quoteIdentifier(const std::wstring& name);
        static std::string  quoteLiteral(const std::wstring& value);
        void ensureConnected() const;
        QueryResult executeInternal(const std::string& sql);

        // Try available ODBC drivers in order of preference
        static std::string findDriver();
        // Extract ODBC error message from handle
        static std::string odbcError(short handleType, void* handle);
    };
}
