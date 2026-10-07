// RedisAdapter.cpp — implementation of Redis support via hiredis.
//
// Design notes:
//  • All commands go through sendArgv() which uses redisCommandArgv with
//    explicit (cmd, argv, argvlen) — fully binary-safe, no printf format
//    injection possible.
//  • Replies are owned by RedisReplyPtr (unique_ptr with freeReplyObject
//    deleter) so they can never leak even on exception paths.
//  • The context is similarly wrapped in RedisContextPtr.
//  • ensureConnected() detects a stale/disconnected context and silently
//    rebuilds from the cached config + password — restores the connection
//    transparently after Redis restarts or idle TCP timeouts.
//  • A virtual "Keys" table per logical DB lets the rest of the app reuse
//    the existing sidebar / data grid plumbing.

#include <windows.h>
#include "Models/RedisAdapter.h"

// hiredis sds.h uses GCC zero-length array extension which MSVC /W4 warns
// about (C4200). Suppress only for the hiredis include — it's harmless and
// the lib is third-party we don't want to patch.
#pragma warning(push)
#pragma warning(disable: 4200)
#include <hiredis/hiredis.h>
#pragma warning(pop)

#include <algorithm>
#include <chrono>
#include <cstring>
#include <sstream>
#include <stdexcept>

namespace DBModels
{
    // ── RAII deleter implementations ───────────────────────────
    void RedisContextDeleter::operator()(redisContext* ctx) const noexcept
    {
        if (ctx) redisFree(ctx);
    }

    void RedisReplyDeleter::operator()(redisReply* reply) const noexcept
    {
        if (reply) freeReplyObject(reply);
    }

    // ── ctor / dtor ────────────────────────────────────────────
    RedisAdapter::RedisAdapter() = default;

    RedisAdapter::~RedisAdapter()
    {
        // unique_ptr handles cleanup; explicit nothing-to-do here
    }

    // ── UTF-8 helpers ──────────────────────────────────────────
    std::string RedisAdapter::toUtf8(const std::wstring& s)
    {
        if (s.empty()) return {};
        int sz = WideCharToMultiByte(CP_UTF8, 0, s.c_str(),
            static_cast<int>(s.size()), nullptr, 0, nullptr, nullptr);
        std::string out(sz, '\0');
        WideCharToMultiByte(CP_UTF8, 0, s.c_str(),
            static_cast<int>(s.size()), &out[0], sz, nullptr, nullptr);
        return out;
    }

    std::wstring RedisAdapter::fromUtf8(const std::string& s)
    {
        if (s.empty()) return {};
        int sz = MultiByteToWideChar(CP_UTF8, 0, s.c_str(),
            static_cast<int>(s.size()), nullptr, 0);
        std::wstring out(sz, L'\0');
        MultiByteToWideChar(CP_UTF8, 0, s.c_str(),
            static_cast<int>(s.size()), &out[0], sz);
        return out;
    }

    // ── Connection lifecycle ───────────────────────────────────
    RedisContextPtr RedisAdapter::buildContext(
        const ConnectionConfig& config, const std::wstring& password)
    {
        // Connect with a 5-second timeout so a dead host fails fast.
        struct timeval tv;
        tv.tv_sec = 5;
        tv.tv_usec = 0;

        std::string host = toUtf8(config.host.empty() ? L"127.0.0.1" : config.host);
        int port = config.port > 0 ? config.port : 6379;

        redisContext* raw = redisConnectWithTimeout(host.c_str(), port, tv);
        RedisContextPtr ctx(raw);

        if (!ctx || ctx->err)
        {
            std::string err = ctx ? ctx->errstr : "alloc failed";
            throw DatabaseError(DatabaseError::Code::ConnectionFailed,
                "Redis connection failed: " + err);
        }

        // Set socket read timeout too so a hung server doesn't freeze the UI thread
        redisSetTimeout(ctx.get(), tv);

        // AUTH if password supplied
        if (!password.empty())
        {
            std::string pwd = toUtf8(password);
            const char* argv[] = { "AUTH", pwd.c_str() };
            size_t argvlen[] = { 4, pwd.size() };
            redisReply* raw_r = static_cast<redisReply*>(
                redisCommandArgv(ctx.get(), 2, argv, argvlen));
            RedisReplyPtr reply(raw_r);
            if (!reply || reply->type == REDIS_REPLY_ERROR)
            {
                std::string err = reply ? reply->str : "AUTH failed";
                throw DatabaseError(DatabaseError::Code::AuthenticationFailed,
                    "Redis AUTH failed: " + err);
            }
        }

        // SELECT the requested DB. Accept both pure numeric strings ("5")
        // and the normalized "db<N>" label (e.g. "db5") that WorkspacePage
        // puts in config.database once a Redis connection has been set up.
        int db = 0;
        if (!config.database.empty())
        {
            std::wstring d = config.database;
            if (d.size() > 2 && d[0] == L'd' && d[1] == L'b')
                d = d.substr(2);
            try { db = std::stoi(d); } catch (...) { db = 0; }
        }
        if (db != 0)
        {
            std::string dbStr = std::to_string(db);
            const char* argv[] = { "SELECT", dbStr.c_str() };
            size_t argvlen[] = { 6, dbStr.size() };
            redisReply* raw_r = static_cast<redisReply*>(
                redisCommandArgv(ctx.get(), 2, argv, argvlen));
            RedisReplyPtr reply(raw_r);
            if (!reply || reply->type == REDIS_REPLY_ERROR)
            {
                std::string err = reply ? reply->str : "SELECT failed";
                throw DatabaseError(DatabaseError::Code::DatabaseNotFound,
                    "Redis SELECT failed: " + err);
            }
        }
        currentDb_ = db;

        return ctx;
    }

    void RedisAdapter::connect(
        const ConnectionConfig& config, const std::wstring& password)
    {
        // Cache for auto-reconnect
        lastConfig_ = config;
        lastPassword_ = password;
        context_ = buildContext(config, password);
    }

    void RedisAdapter::disconnect()
    {
        context_.reset();
    }

    bool RedisAdapter::testConnection(
        const ConnectionConfig& config, const std::wstring& password)
    {
        // Build a temporary context, PING, and let RAII clean up.
        try
        {
            auto ctx = buildContext(config, password);
            const char* argv[] = { "PING" };
            size_t argvlen[] = { 4 };
            redisReply* raw = static_cast<redisReply*>(
                redisCommandArgv(ctx.get(), 1, argv, argvlen));
            RedisReplyPtr reply(raw);
            return reply &&
                (reply->type == REDIS_REPLY_STATUS ||
                 reply->type == REDIS_REPLY_STRING);
        }
        catch (...)
        {
            return false;
        }
    }

    bool RedisAdapter::isConnected() const
    {
        return context_ && !context_->err;
    }

    void RedisAdapter::ensureConnected()
    {
        if (context_ && !context_->err) return;
        // Stale or never connected → rebuild from cached config
        context_ = buildContext(lastConfig_, lastPassword_);
    }

    // ── Reply helpers ──────────────────────────────────────────
    void RedisAdapter::checkReply(redisReply* reply, const char* hint)
    {
        if (!reply)
        {
            std::string err = context_ ? context_->errstr : "no reply";
            // Reset context so the next call triggers reconnect
            context_.reset();
            throw DatabaseError(DatabaseError::Code::QueryFailed,
                std::string(hint) + ": " + err);
        }
        if (reply->type == REDIS_REPLY_ERROR)
        {
            throw DatabaseError(DatabaseError::Code::QueryFailed,
                std::string(hint) + ": " + std::string(reply->str, reply->len));
        }
    }

    RedisReplyPtr RedisAdapter::sendArgv(const std::vector<std::string>& argv)
    {
        ensureConnected();

        std::vector<const char*> rawArgs;
        std::vector<size_t> argLens;
        rawArgs.reserve(argv.size());
        argLens.reserve(argv.size());
        for (const auto& a : argv)
        {
            rawArgs.push_back(a.c_str());
            argLens.push_back(a.size());
        }

        redisReply* raw = static_cast<redisReply*>(
            redisCommandArgv(context_.get(),
                static_cast<int>(rawArgs.size()),
                rawArgs.data(), argLens.data()));
        RedisReplyPtr reply(raw);

        // If reply is null, the connection is broken. Try ONE auto-reconnect + retry.
        if (!reply && context_ && context_->err)
        {
            context_.reset();
            ensureConnected();
            raw = static_cast<redisReply*>(
                redisCommandArgv(context_.get(),
                    static_cast<int>(rawArgs.size()),
                    rawArgs.data(), argLens.data()));
            reply.reset(raw);
        }

        checkReply(reply.get(), argv.empty() ? "REDIS" : argv[0].c_str());
        return reply;
    }

    RedisReplyPtr RedisAdapter::sendCommand(std::initializer_list<std::string> args)
    {
        return sendArgv(std::vector<std::string>(args));
    }

    std::vector<RedisReplyPtr> RedisAdapter::pipelineArgv(
        const std::vector<std::vector<std::string>>& commands)
    {
        std::vector<RedisReplyPtr> replies;
        replies.reserve(commands.size());
        if (commands.empty()) return replies;

        ensureConnected();

        // Phase A: queue every command into the output buffer (no I/O yet)
        for (const auto& argv : commands)
        {
            std::vector<const char*> rawArgs;
            std::vector<size_t> argLens;
            rawArgs.reserve(argv.size());
            argLens.reserve(argv.size());
            for (const auto& a : argv)
            {
                rawArgs.push_back(a.c_str());
                argLens.push_back(a.size());
            }
            int rc = redisAppendCommandArgv(context_.get(),
                static_cast<int>(rawArgs.size()),
                rawArgs.data(), argLens.data());
            if (rc != REDIS_OK)
            {
                std::string err = context_ ? context_->errstr : "append failed";
                context_.reset();
                throw DatabaseError(DatabaseError::Code::QueryFailed,
                    "Redis pipeline append failed: " + err);
            }
        }

        // Phase B: drain replies in order. The first redisGetReply triggers
        // the actual socket flush + reads, so this is where we pay the
        // network round-trip cost — exactly ONE round-trip for the whole batch.
        for (size_t i = 0; i < commands.size(); ++i)
        {
            void* raw = nullptr;
            int rc = redisGetReply(context_.get(), &raw);
            if (rc != REDIS_OK)
            {
                std::string err = context_ ? context_->errstr : "getReply failed";
                context_.reset();
                throw DatabaseError(DatabaseError::Code::QueryFailed,
                    "Redis pipeline read failed: " + err);
            }
            replies.emplace_back(static_cast<redisReply*>(raw));
        }
        return replies;
    }

    // ── Schema parsing ─────────────────────────────────────────
    int RedisAdapter::parseDbFromSchema(const std::wstring& schema)
    {
        // schema like "db0" .. "db15"
        if (schema.size() > 2 && schema[0] == L'd' && schema[1] == L'b')
        {
            try { return std::stoi(schema.substr(2)); }
            catch (...) {}
        }
        return 0;
    }

    // ── Command line tokenizer (handles quoted strings) ────────
    std::vector<std::string> RedisAdapter::tokenizeCommand(const std::wstring& sql)
    {
        std::vector<std::string> tokens;
        std::wstring current;
        wchar_t inQuote = 0;
        for (wchar_t c : sql)
        {
            if (inQuote)
            {
                if (c == inQuote) inQuote = 0;
                else current += c;
            }
            else if (c == L'"' || c == L'\'')
            {
                inQuote = c;
            }
            else if (c == L' ' || c == L'\t' || c == L'\r' || c == L'\n')
            {
                if (!current.empty())
                {
                    tokens.push_back(toUtf8(current));
                    current.clear();
                }
            }
            else
            {
                current += c;
            }
        }
        if (!current.empty()) tokens.push_back(toUtf8(current));
        return tokens;
    }

    // ── Reply → wstring helpers ────────────────────────────────
    std::wstring RedisAdapter::replyToWString(redisReply* reply)
    {
        if (!reply) return L"";
        switch (reply->type)
        {
        case REDIS_REPLY_STRING:
        case REDIS_REPLY_STATUS:
        case REDIS_REPLY_ERROR:
            return fromUtf8(std::string(reply->str, reply->len));
        case REDIS_REPLY_INTEGER:
            return std::to_wstring(reply->integer);
        case REDIS_REPLY_NIL:
            return L"";
        case REDIS_REPLY_ARRAY:
            return formatPreview(reply);
        default:
            return L"";
        }
    }

    std::wstring RedisAdapter::formatPreview(redisReply* reply)
    {
        // Full array dump, no truncation. Earlier version capped at 10
        // elements and appended "... (N total)" for display purposes, but
        // that stored the lossy preview in the TableRow and destroyed the
        // original payload: opening the cell for inline edit showed the
        // preview text, and saving would call SET with the preview string,
        // overwriting the real hash/list/set value.
        //
        // The grid already trims each cell to MAX_CELL_DISPLAY_CHARS at
        // render time (DataGridView builds a preview for the visual cell
        // without touching data_.rows), and the details side-panel shows
        // the full value, so readability is unaffected while edits now
        // operate on the real data.
        if (!reply || reply->type != REDIS_REPLY_ARRAY) return L"";
        std::wstring out = L"[";
        for (size_t i = 0; i < reply->elements; ++i)
        {
            if (i > 0) out += L", ";
            out += replyToWString(reply->element[i]);
        }
        out += L"]";
        return out;
    }

    // ── Schema inspection ──────────────────────────────────────
    std::vector<std::wstring> RedisAdapter::listDatabases()
    {
        // Redis exposes 16 logical DBs by default (0-15)
        std::vector<std::wstring> out;
        for (int i = 0; i < 16; ++i)
            out.push_back(L"db" + std::to_wstring(i));
        return out;
    }

    std::vector<std::wstring> RedisAdapter::listSchemas()
    {
        return listDatabases();
    }

    std::vector<TableInfo> RedisAdapter::listTables(const std::wstring& schema)
    {
        // Switch to the requested DB so DBSIZE reflects the right one
        int db = parseDbFromSchema(schema);
        if (db != currentDb_)
        {
            std::string dbStr = std::to_string(db);
            sendArgv({ "SELECT", dbStr });
            currentDb_ = db;
        }

        TableInfo keys;
        keys.name = L"Keys";
        keys.schema = schema;
        keys.type = L"table";

        // Get an estimated row count via DBSIZE
        try
        {
            auto reply = sendArgv({ "DBSIZE" });
            if (reply && reply->type == REDIS_REPLY_INTEGER)
                keys.estimatedRows = reply->integer;
        }
        catch (...) { /* ignore — keys.estimatedRows stays 0 */ }

        return { keys };
    }

    std::vector<TableInfo> RedisAdapter::listViews(const std::wstring& /*schema*/)
    {
        return {};
    }

    std::vector<ColumnInfo> RedisAdapter::describeTable(
        const std::wstring& /*table*/, const std::wstring& /*schema*/)
    {
        // Virtual columns for the Keys pseudo-table
        std::vector<ColumnInfo> cols;
        ColumnInfo keyCol;
        keyCol.name = L"key"; keyCol.dataType = L"string";
        keyCol.nullable = false; keyCol.isPrimaryKey = true;
        keyCol.ordinalPosition = 1;
        cols.push_back(keyCol);

        ColumnInfo typeCol;
        typeCol.name = L"type"; typeCol.dataType = L"string";
        typeCol.nullable = false; typeCol.ordinalPosition = 2;
        cols.push_back(typeCol);

        ColumnInfo valueCol;
        valueCol.name = L"value"; valueCol.dataType = L"string";
        valueCol.nullable = true; valueCol.ordinalPosition = 3;
        cols.push_back(valueCol);

        ColumnInfo ttlCol;
        ttlCol.name = L"ttl"; ttlCol.dataType = L"integer";
        ttlCol.nullable = true; ttlCol.ordinalPosition = 4;
        cols.push_back(ttlCol);

        return cols;
    }

    std::vector<IndexInfo> RedisAdapter::listIndexes(
        const std::wstring& /*table*/, const std::wstring& /*schema*/)
    {
        return {};
    }

    std::vector<ForeignKeyInfo> RedisAdapter::listForeignKeys(
        const std::wstring& /*table*/, const std::wstring& /*schema*/)
    {
        return {};
    }

    std::vector<std::wstring> RedisAdapter::listFunctions(const std::wstring& /*schema*/)
    {
        return {};
    }

    std::wstring RedisAdapter::getFunctionSource(
        const std::wstring& /*name*/, const std::wstring& /*schema*/)
    {
        return L"";
    }

    std::wstring RedisAdapter::getCreateTableSQL(
        const std::wstring& /*table*/, const std::wstring& /*schema*/)
    {
        // Not real DDL — descriptive only so the UI has something to display
        return L"-- Redis virtual table\n"
               L"CREATE TABLE Keys (\n"
               L"  key   string PRIMARY KEY,\n"
               L"  type  string NOT NULL,\n"
               L"  value string,\n"
               L"  ttl   integer\n"
               L");";
    }

    // ── Build a QueryResult holding key/type/value/ttl rows ────
    QueryResult RedisAdapter::makeKeysResult(
        const std::vector<TableRow>& rows, double elapsedMs)
    {
        QueryResult result;
        result.columnNames = { L"key", L"type", L"value", L"ttl" };
        result.columnTypes = { L"string", L"string", L"string", L"integer" };
        result.rows = rows;
        result.totalRows = static_cast<int>(rows.size());
        result.executionTimeMs = elapsedMs;
        result.success = true;
        return result;
    }

    // ── fetchRows: SCAN-based pagination ───────────────────────
    QueryResult RedisAdapter::fetchRows(
        const std::wstring& /*table*/, const std::wstring& schema,
        int limit, int offset,
        const std::wstring& /*orderBy*/, bool /*ascending*/)
    {
        auto t0 = std::chrono::steady_clock::now();

        // Switch DB if schema indicates a different one
        int db = parseDbFromSchema(schema);
        if (db != currentDb_)
        {
            sendArgv({ "SELECT", std::to_string(db) });
            currentDb_ = db;
        }

        // Phase 1: SCAN to collect all keys, using current MATCH pattern
        // (set via setSearchPattern; defaults to "*")
        std::vector<std::string> allKeys;
        std::string cursor = "0";
        const std::string& pattern = searchPattern_;
        do
        {
            auto reply = sendArgv({ "SCAN", cursor, "MATCH", pattern, "COUNT", "500" });
            if (!reply || reply->type != REDIS_REPLY_ARRAY || reply->elements != 2)
                break;

            // element[0] = next cursor, element[1] = array of keys
            redisReply* curEl = reply->element[0];
            redisReply* keysEl = reply->element[1];

            if (curEl && curEl->type == REDIS_REPLY_STRING)
                cursor.assign(curEl->str, curEl->len);
            else
                cursor = "0";

            if (keysEl && keysEl->type == REDIS_REPLY_ARRAY)
            {
                for (size_t i = 0; i < keysEl->elements; ++i)
                {
                    redisReply* k = keysEl->element[i];
                    if (k && k->type == REDIS_REPLY_STRING)
                        allKeys.emplace_back(k->str, k->len);
                }
            }
        } while (cursor != "0" && allKeys.size() < static_cast<size_t>(offset + limit + 1000));

        // Sort for stable pagination
        std::sort(allKeys.begin(), allKeys.end());

        // Apply offset/limit
        std::vector<std::string> paged;
        for (size_t i = static_cast<size_t>(offset);
             i < allKeys.size() && paged.size() < static_cast<size_t>(limit); ++i)
        {
            paged.push_back(allKeys[i]);
        }

        // Phase 2: TYPE + TTL pipelined as ONE batch (2N commands, 1 round-trip)
        // Without pipelining this was 8s for 300 keys (sequential round-trips).
        std::vector<std::vector<std::string>> typeAndTtl;
        typeAndTtl.reserve(paged.size() * 2);
        for (const auto& key : paged)
        {
            typeAndTtl.push_back({ "TYPE", key });
            typeAndTtl.push_back({ "TTL",  key });
        }
        std::vector<RedisReplyPtr> typeTtlReplies;
        try { typeTtlReplies = pipelineArgv(typeAndTtl); }
        catch (...) { typeTtlReplies.clear(); }

        std::vector<std::string> types(paged.size(), "string");
        std::vector<long long>   ttls(paged.size(), -1);
        for (size_t i = 0; i < paged.size(); ++i)
        {
            redisReply* tr = (i * 2     < typeTtlReplies.size()) ? typeTtlReplies[i * 2].get()     : nullptr;
            redisReply* lr = (i * 2 + 1 < typeTtlReplies.size()) ? typeTtlReplies[i * 2 + 1].get() : nullptr;
            if (tr && tr->type == REDIS_REPLY_STATUS)
                types[i].assign(tr->str, tr->len);
            if (lr && lr->type == REDIS_REPLY_INTEGER)
                ttls[i] = lr->integer;
        }

        // Phase 3: pipelined value lookups (one command per key, N commands, 1 round-trip)
        std::vector<std::vector<std::string>> valueCmds;
        valueCmds.reserve(paged.size());
        for (size_t i = 0; i < paged.size(); ++i)
        {
            const std::string& key = paged[i];
            const std::string& t = types[i];
            if      (t == "string") valueCmds.push_back({ "GET", key });
            else if (t == "list")   valueCmds.push_back({ "LRANGE", key, "0", "99" });
            else if (t == "set")    valueCmds.push_back({ "SMEMBERS", key });
            else if (t == "zset")   valueCmds.push_back({ "ZRANGE", key, "0", "99", "WITHSCORES" });
            else if (t == "hash")   valueCmds.push_back({ "HGETALL", key });
            else                    valueCmds.push_back({ "TYPE", key }); // harmless placeholder
        }
        std::vector<RedisReplyPtr> valueReplies;
        try { valueReplies = pipelineArgv(valueCmds); }
        catch (...) { valueReplies.clear(); }

        // Assemble rows
        std::vector<TableRow> rows;
        rows.reserve(paged.size());
        for (size_t i = 0; i < paged.size(); ++i)
        {
            const std::string& key = paged[i];
            const std::string& t = types[i];
            redisReply* vr = (i < valueReplies.size()) ? valueReplies[i].get() : nullptr;

            std::wstring value;
            if (!vr)                  value = L"";
            else if (t == "string")   value = replyToWString(vr);
            else if (t == "list" || t == "set" || t == "zset" || t == "hash")
                                      value = formatPreview(vr);
            else                      value = L"(" + fromUtf8(t) + L")";

            TableRow row;
            row[L"key"] = fromUtf8(key);
            row[L"type"] = fromUtf8(t);
            row[L"value"] = value;
            row[L"ttl"] = (ttls[i] < 0) ? L"" : std::to_wstring(ttls[i]);
            rows.push_back(std::move(row));
        }

        auto t1 = std::chrono::steady_clock::now();
        double elapsed = std::chrono::duration<double, std::milli>(t1 - t0).count();

        QueryResult result = makeKeysResult(rows, elapsed);
        // Override totalRows with the FULL key count, not just the page
        result.totalRows = static_cast<int>(allKeys.size());
        result.currentPage = (limit > 0 ? offset / limit + 1 : 1);
        result.pageSize = limit;
        return result;
    }

    // ── Execute raw Redis command ──────────────────────────────
    QueryResult RedisAdapter::execute(const std::wstring& sql)
    {
        auto t0 = std::chrono::steady_clock::now();

        QueryResult result;
        result.sql = sql;

        auto tokens = tokenizeCommand(sql);
        if (tokens.empty())
        {
            result.success = false;
            result.error = L"Empty command";
            return result;
        }

        try
        {
            auto reply = sendArgv(tokens);
            // Build a one-row, one-column result containing the reply preview
            result.columnNames = { L"result" };
            result.columnTypes = { L"string" };
            TableRow row;
            row[L"result"] = replyToWString(reply.get());
            result.rows.push_back(row);
            result.totalRows = 1;
            result.success = true;
        }
        catch (const DatabaseError& e)
        {
            result.success = false;
            result.error = fromUtf8(e.what());
        }

        auto t1 = std::chrono::steady_clock::now();
        result.executionTimeMs =
            std::chrono::duration<double, std::milli>(t1 - t0).count();
        return result;
    }

    // ── Data manipulation ──────────────────────────────────────
    QueryResult RedisAdapter::insertRow(
        const std::wstring& /*table*/, const std::wstring& /*schema*/,
        const TableRow& values)
    {
        QueryResult result;
        auto keyIt = values.find(L"key");
        if (keyIt == values.end() || keyIt->second.empty())
        {
            result.success = false;
            result.error = L"Missing 'key' field";
            return result;
        }
        std::string key = toUtf8(keyIt->second);

        auto valIt = values.find(L"value");
        std::string val = (valIt != values.end()) ? toUtf8(valIt->second) : "";

        try
        {
            sendArgv({ "SET", key, val });
            result.success = true;
        }
        catch (const DatabaseError& e)
        {
            result.success = false;
            result.error = fromUtf8(e.what());
        }
        return result;
    }

    QueryResult RedisAdapter::updateRow(
        const std::wstring& /*table*/, const std::wstring& /*schema*/,
        const TableRow& setValues, const TableRow& whereValues)
    {
        QueryResult result;
        auto keyIt = whereValues.find(L"key");
        if (keyIt == whereValues.end() || keyIt->second.empty())
        {
            result.success = false;
            result.error = L"Missing 'key' in WHERE";
            return result;
        }
        std::string key = toUtf8(keyIt->second);

        try
        {
            // Update value via SET if 'value' is in setValues
            auto valIt = setValues.find(L"value");
            if (valIt != setValues.end())
            {
                sendArgv({ "SET", key, toUtf8(valIt->second) });
            }
            // Update TTL via EXPIRE / PERSIST if 'ttl' is in setValues
            auto ttlIt = setValues.find(L"ttl");
            if (ttlIt != setValues.end())
            {
                if (ttlIt->second.empty())
                {
                    sendArgv({ "PERSIST", key });
                }
                else
                {
                    sendArgv({ "EXPIRE", key, toUtf8(ttlIt->second) });
                }
            }
            result.success = true;
        }
        catch (const DatabaseError& e)
        {
            result.success = false;
            result.error = fromUtf8(e.what());
        }
        return result;
    }

    QueryResult RedisAdapter::deleteRow(
        const std::wstring& /*table*/, const std::wstring& /*schema*/,
        const TableRow& whereValues)
    {
        QueryResult result;
        auto keyIt = whereValues.find(L"key");
        if (keyIt == whereValues.end() || keyIt->second.empty())
        {
            result.success = false;
            result.error = L"Missing 'key' in WHERE";
            return result;
        }
        try
        {
            sendArgv({ "DEL", toUtf8(keyIt->second) });
            result.success = true;
        }
        catch (const DatabaseError& e)
        {
            result.success = false;
            result.error = fromUtf8(e.what());
        }
        return result;
    }

    // ── Transactions ───────────────────────────────────────────
    void RedisAdapter::beginTransaction()  { sendArgv({ "MULTI" }); }
    void RedisAdapter::commitTransaction() { sendArgv({ "EXEC" }); }
    void RedisAdapter::rollbackTransaction(){ sendArgv({ "DISCARD" }); }

    // ── Server info ────────────────────────────────────────────
    std::wstring RedisAdapter::serverVersion()
    {
        try
        {
            auto reply = sendArgv({ "INFO", "server" });
            if (reply && reply->type == REDIS_REPLY_STRING)
            {
                std::string info(reply->str, reply->len);
                // Look for "redis_version:" line
                auto pos = info.find("redis_version:");
                if (pos != std::string::npos)
                {
                    auto end = info.find('\r', pos);
                    if (end == std::string::npos) end = info.find('\n', pos);
                    if (end != std::string::npos)
                        return fromUtf8(info.substr(pos + 14, end - pos - 14));
                }
            }
        }
        catch (...) {}
        return L"Redis";
    }

    std::wstring RedisAdapter::currentDatabase()
    {
        return L"db" + std::to_wstring(currentDb_);
    }

    void RedisAdapter::setSearchPattern(const std::wstring& pattern)
    {
        // Empty or whitespace pattern means "match all"
        std::wstring trimmed = pattern;
        while (!trimmed.empty() && (trimmed.front() == L' ' || trimmed.front() == L'\t'))
            trimmed.erase(trimmed.begin());
        while (!trimmed.empty() && (trimmed.back() == L' ' || trimmed.back() == L'\t'))
            trimmed.pop_back();
        searchPattern_ = trimmed.empty() ? "*" : toUtf8(trimmed);
    }
}
