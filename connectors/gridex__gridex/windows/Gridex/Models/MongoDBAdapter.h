#pragma once
// MongoDBAdapter — maps MongoDB document store into the relational
// DatabaseAdapter interface so the sidebar, data grid, and query editor
// can treat MongoDB like any other database engine.
//
// Virtual schema mapping:
//   • listDatabases()  → server database list
//   • listSchemas()    → single item = current database name
//   • listTables()     → collection names within database
//   • describeTable()  → sample N documents, union top-level fields
//   • fetchRows()      → find() with skip/limit, flatten docs to columns
//   • execute()        → parse pseudo-shell syntax: db.coll.method({json})
//
// mongocxx is already RAII (client, database, cursor), so no custom
// deleters needed (unlike hiredis in RedisAdapter).

#include "DatabaseAdapter.h"
#include <memory>
#include <string>
#include <vector>
#include <unordered_map>

// Forward-declare mongocxx types to keep this header lightweight.
// The implementation files include the actual mongocxx headers.
namespace mongocxx { inline namespace v_noabi {
    class instance;
    class client;
    class database;
    class client_session;
}}

namespace DBModels
{
    class MongoDBAdapter : public DatabaseAdapter
    {
    public:
        MongoDBAdapter();
        ~MongoDBAdapter() override;

        // ── Connection ──────────────────────────────
        void connect(const ConnectionConfig& config, const std::wstring& password) override;
        void disconnect() override;
        bool testConnection(const ConnectionConfig& config, const std::wstring& password) override;
        bool isConnected() const override;

        // ── Query Execution ─────────────────────────
        // Accepts pseudo-shell syntax: db.collection.method({json})
        // Supported methods: find, insertOne, updateOne, deleteOne, aggregate, count
        // Fallback: raw runCommand JSON
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

        // ── Transactions (MongoDB 4.0+ replica set) ─
        void beginTransaction() override;
        void commitTransaction() override;
        void rollbackTransaction() override;

        // ── Server Info ─────────────────────────────
        std::wstring serverVersion() override;
        std::wstring currentDatabase() override;

    private:
        // mongocxx instance must outlive all other driver objects.
        // Shared across all MongoDBAdapter instances via static init.
        static void ensureInstance();

        // Owned driver objects
        std::unique_ptr<mongocxx::client> client_;
        std::string currentDbName_;
        ConnectionConfig lastConfig_;
        std::wstring lastPassword_;
        bool connected_ = false;

        // Active transaction session (nullptr when no transaction)
        std::unique_ptr<mongocxx::client_session> session_;

        // ── Schema cache ────────────────────────────
        // Cache sampled column info per collection to avoid re-scanning
        // on every describeTable call. Cleared on disconnect.
        std::unordered_map<std::string, std::vector<ColumnInfo>> schemaCache_;

        // ── Private helpers ─────────────────────────
        // Build a mongocxx::uri string from config fields (host/port/user/pass/db)
        std::string buildUriString(const ConnectionConfig& config,
                                   const std::wstring& password);
        // Get database object for a given schema name
        mongocxx::database getDatabase(const std::wstring& schema);
        // Sample N documents from a collection and infer field types
        std::vector<ColumnInfo> sampleFields(const std::wstring& collection,
                                              const std::wstring& schema,
                                              int sampleSize = 100);
        // Map BSON type code to human-readable type name
        static std::wstring bsonTypeName(int bsonType);
        // Flatten a BSON document's top-level fields into a TableRow
        static TableRow flattenDocument(const void* bsonView,
                                        const std::vector<ColumnInfo>& columns);

        // ── Parse helpers for execute() ─────────────
        // Parse "db.collection.method({json})" → (collection, method, jsonArg)
        struct ParsedCommand
        {
            std::string collection;
            std::string method;
            std::string jsonArg;
        };
        static bool parseShellCommand(const std::string& input, ParsedCommand& out);

        // Execute a parsed command and return result
        QueryResult executeCommand(const ParsedCommand& cmd);
        // Execute raw runCommand JSON
        QueryResult executeRunCommand(const std::string& json);

        // ── UTF-8 helpers ───────────────────────────
        static std::string  toUtf8(const std::wstring& s);
        static std::wstring fromUtf8(const std::string& s);
    };
}
