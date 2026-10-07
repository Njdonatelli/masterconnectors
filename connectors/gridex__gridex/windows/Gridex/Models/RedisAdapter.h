#pragma once
// RedisAdapter — maps Redis key-value store into the relational DatabaseAdapter
// interface so the rest of the app (sidebar, data grid, query editor) can treat
// Redis like any other database engine.
//
// Virtual schema:
//   • schemas = "db0".."db15" (Redis logical databases)
//   • each schema has one table named "Keys"
//   • columns: key, type, value, ttl
//   • SCAN-based pagination in fetchRows()
//   • execute() accepts raw Redis commands (space-separated, with quoted strings)
//
// Hiredis safety wrappers (addresses the weak points of the C API):
//   • RAII via unique_ptr with custom deleters → no manual freeReplyObject leaks
//   • Auto-reconnect: ensureConnected() rebuilds context if disconnected
//   • Binary-safe: all commands sent via redisCommandArgv() with explicit lengths
//     so user input cannot inject format specifiers
//   • Type-safe reply helpers throw DatabaseError on REDIS_REPLY_ERROR

#include "DatabaseAdapter.h"
#include <memory>
#include <string>
#include <vector>

// Forward declare hiredis types so the public header doesn't pull in <hiredis/hiredis.h>
struct redisContext;
struct redisReply;

namespace DBModels
{
    // ── RAII wrappers ────────────────────────────────────────────
    // Custom deleters use C linkage but we wrap them in lambdas/free
    // functions invoked by unique_ptr's deleter type to avoid pulling
    // in the hiredis headers here.
    struct RedisContextDeleter { void operator()(redisContext* ctx) const noexcept; };
    struct RedisReplyDeleter   { void operator()(redisReply* reply) const noexcept; };

    using RedisContextPtr = std::unique_ptr<redisContext, RedisContextDeleter>;
    using RedisReplyPtr   = std::unique_ptr<redisReply,   RedisReplyDeleter>;

    class RedisAdapter : public DatabaseAdapter
    {
    public:
        RedisAdapter();
        ~RedisAdapter() override;

        // ── Connection ──────────────────────────────
        void connect(const ConnectionConfig& config, const std::wstring& password) override;
        void disconnect() override;
        bool testConnection(const ConnectionConfig& config, const std::wstring& password) override;
        bool isConnected() const override;

        // ── Query Execution ─────────────────────────
        // Accepts a raw Redis command line (e.g. "SET foo bar", "HGETALL myhash").
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
        // insertRow expects "key" + "value" cells. type defaults to string if missing.
        QueryResult insertRow(
            const std::wstring& table, const std::wstring& schema,
            const TableRow& values) override;
        // updateRow: when WHERE has key, supports updating value (SET) or ttl (EXPIRE/PERSIST).
        QueryResult updateRow(
            const std::wstring& table, const std::wstring& schema,
            const TableRow& setValues, const TableRow& whereValues) override;
        // deleteRow: WHERE must contain "key" — issues DEL.
        QueryResult deleteRow(
            const std::wstring& table, const std::wstring& schema,
            const TableRow& whereValues) override;

        // ── Transactions (Redis MULTI/EXEC/DISCARD) ─
        void beginTransaction() override;
        void commitTransaction() override;
        void rollbackTransaction() override;

        // ── Server Info ─────────────────────────────
        std::wstring serverVersion() override;
        std::wstring currentDatabase() override;

        // SCAN MATCH pattern for the next fetchRows call. Empty / "*" = all keys.
        void setSearchPattern(const std::wstring& pattern) override;

    private:
        // Cached connection context — null when disconnected
        RedisContextPtr context_;
        // Last config + password used so ensureConnected() can rebuild on failure
        ConnectionConfig lastConfig_;
        std::wstring     lastPassword_;
        // Currently selected logical DB (0-15 typically)
        int currentDb_ = 0;
        // Active SCAN MATCH pattern. "*" matches all keys.
        std::string searchPattern_ = "*";

        // ── Private helpers ─────────────────────────
        // Build a fresh context (open TCP, AUTH, SELECT db, optionally TLS).
        // Throws DatabaseError on failure.
        RedisContextPtr buildContext(const ConnectionConfig& config,
                                     const std::wstring& password);
        // Verify context is alive; if not, rebuild from lastConfig_/lastPassword_.
        void ensureConnected();
        // Send a command via redisCommandArgv (binary-safe, no printf injection).
        // Returns owned reply or throws on connection/error reply.
        RedisReplyPtr sendArgv(const std::vector<std::string>& argv);
        // Convenience overload for variable arg count
        RedisReplyPtr sendCommand(std::initializer_list<std::string> args);
        // Pipeline a batch of commands: append all, then drain replies. Returns
        // one owned reply per input command, in order. Reduces N round-trips
        // to 1 (or 2 with the trailing flush). Throws on connection failure;
        // individual REDIS_REPLY_ERROR replies are returned untouched so the
        // caller can decide what to do per command.
        std::vector<RedisReplyPtr> pipelineArgv(
            const std::vector<std::vector<std::string>>& commands);
        // Throw if reply is null or REDIS_REPLY_ERROR
        void checkReply(redisReply* reply, const char* commandHint);

        // Parse a "SELECT n" embedded in fetchRows schema name like "db5"
        static int parseDbFromSchema(const std::wstring& schema);
        // Tokenize a command line, respecting double / single quotes
        static std::vector<std::string> tokenizeCommand(const std::wstring& sql);
        // Format a list/set/zset/hash reply into a single preview string
        static std::wstring formatPreview(redisReply* reply);
        // Convert reply to wstring (for cells / single value display)
        static std::wstring replyToWString(redisReply* reply);
        // Build a QueryResult from one or more rows we already filled
        static QueryResult makeKeysResult(
            const std::vector<TableRow>& rows, double elapsedMs);

        static std::string  toUtf8(const std::wstring& s);
        static std::wstring fromUtf8(const std::string& s);
    };
}
