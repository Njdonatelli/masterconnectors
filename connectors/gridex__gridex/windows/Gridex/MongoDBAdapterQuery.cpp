// MongoDBAdapterQuery.cpp — query execution, CRUD, transactions, fetchRows.
//
// Split from MongoDBAdapter.cpp to keep each file under 200 lines.
// Connection lifecycle and schema inspection live in MongoDBAdapter.cpp.

// NOMINMAX prevents <windows.h> from defining min/max macros that collide
// with std::numeric_limits::max() used inside bsoncxx/mongocxx headers.
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include "Models/MongoDBAdapter.h"

#include <mongocxx/client.hpp>
#include <mongocxx/database.hpp>
#include <mongocxx/collection.hpp>
#include <mongocxx/options/find.hpp>
#include <mongocxx/client_session.hpp>
#include <bsoncxx/builder/basic/document.hpp>
#include <bsoncxx/builder/basic/kvp.hpp>
#include <bsoncxx/json.hpp>
#include <bsoncxx/types.hpp>

#include <chrono>
#include <regex>
#include <sstream>

namespace DBModels
{
    using bsoncxx::builder::basic::kvp;
    using bsoncxx::builder::basic::make_document;

    // ── Flatten BSON document to TableRow ──────────────────────
    TableRow MongoDBAdapter::flattenDocument(
        const void* bsonViewPtr, const std::vector<ColumnInfo>& columns)
    {
        auto& view = *static_cast<const bsoncxx::document::view*>(bsonViewPtr);
        TableRow row;
        for (auto& col : columns)
        {
            auto key = toUtf8(col.name);
            auto elem = view[key];
            if (!elem)
            {
                row[col.name] = L"";
                continue;
            }

            std::wstring val;
            switch (elem.type())
            {
            case bsoncxx::type::k_string:
                val = fromUtf8(std::string(elem.get_string().value));
                break;
            case bsoncxx::type::k_int32:
                val = std::to_wstring(elem.get_int32().value);
                break;
            case bsoncxx::type::k_int64:
                val = std::to_wstring(elem.get_int64().value);
                break;
            case bsoncxx::type::k_double:
                val = std::to_wstring(elem.get_double().value);
                break;
            case bsoncxx::type::k_bool:
                val = elem.get_bool().value ? L"true" : L"false";
                break;
            case bsoncxx::type::k_oid:
                val = fromUtf8(elem.get_oid().value.to_string());
                break;
            case bsoncxx::type::k_null:
                val = L"null";
                break;
            case bsoncxx::type::k_date:
            {
                auto ms = elem.get_date().value.count();
                val = L"Date(" + std::to_wstring(ms) + L")";
                break;
            }
            case bsoncxx::type::k_document:
                val = fromUtf8(bsoncxx::to_json(elem.get_document().value));
                break;
            case bsoncxx::type::k_array:
                val = fromUtf8(bsoncxx::to_json(elem.get_array().value));
                break;
            default:
            {
                // Wrap value in a temp doc to convert via to_json
                auto tmp = make_document(kvp("v", elem.get_value()));
                auto json = bsoncxx::to_json(tmp.view());
                // Extract just the value part (after "v" : )
                auto pos = json.find(':');
                if (pos != std::string::npos)
                    val = fromUtf8(json.substr(pos + 2, json.size() - pos - 3));
                else
                    val = fromUtf8(json);
                break;
            }
            }
            row[col.name] = val;
        }
        return row;
    }

    // ── fetchRows ─────────────────────────────────────────────
    QueryResult MongoDBAdapter::fetchRows(
        const std::wstring& table, const std::wstring& schema,
        int limit, int offset,
        const std::wstring& orderBy, bool ascending)
    {
        if (!isConnected())
            throw DatabaseError(DatabaseError::Code::ConnectionFailed, "Not connected");

        auto start = std::chrono::steady_clock::now();
        auto db = getDatabase(schema);
        auto coll = db[toUtf8(table)];

        // Get column info (cached after first call)
        auto columns = describeTable(table, schema);

        mongocxx::v_noabi::options::find opts;
        opts.skip(offset);
        opts.limit(limit);
        if (!orderBy.empty())
            opts.sort(make_document(kvp(toUtf8(orderBy), ascending ? 1 : -1)));

        auto cursor = coll.find({}, opts);

        QueryResult result;
        for (auto& col : columns) result.columnNames.push_back(col.name);

        for (auto& doc : cursor)
        {
            bsoncxx::document::view v = doc;
            result.rows.push_back(flattenDocument(&v, columns));
        }

        auto end = std::chrono::steady_clock::now();
        result.totalRows = static_cast<int>(result.rows.size());
        result.executionTimeMs = std::chrono::duration<double, std::milli>(end - start).count();
        return result;
    }

    // ── Parse shell command syntax ────────────────────────────
    // Pattern: db.collectionName.method({json}) or db.collectionName.method()
    bool MongoDBAdapter::parseShellCommand(const std::string& input, ParsedCommand& out)
    {
        // Regex: db\.(\w+)\.(\w+)\(([\s\S]*)\)
        static const std::regex re(
            R"(db\.(\w+)\.(\w+)\(([\s\S]*)\)\s*$)",
            std::regex::optimize);
        std::smatch m;
        if (!std::regex_search(input, m, re)) return false;
        out.collection = m[1].str();
        out.method = m[2].str();
        out.jsonArg = m[3].str();
        // Trim whitespace from jsonArg
        auto& a = out.jsonArg;
        while (!a.empty() && (a.front() == ' ' || a.front() == '\n')) a.erase(a.begin());
        while (!a.empty() && (a.back() == ' ' || a.back() == '\n')) a.pop_back();
        return true;
    }

    // ── execute() — main entry point for query editor ─────────
    QueryResult MongoDBAdapter::execute(const std::wstring& sql)
    {
        if (!isConnected())
            throw DatabaseError(DatabaseError::Code::ConnectionFailed, "Not connected");

        auto input = toUtf8(sql);
        // Trim leading/trailing whitespace
        while (!input.empty() && input.front() == ' ') input.erase(input.begin());
        while (!input.empty() && input.back() == ' ') input.pop_back();

        ParsedCommand cmd;
        if (parseShellCommand(input, cmd))
            return executeCommand(cmd);

        // Fallback: treat as raw runCommand JSON
        return executeRunCommand(input);
    }

    QueryResult MongoDBAdapter::executeCommand(const ParsedCommand& cmd)
    {
        auto start = std::chrono::steady_clock::now();
        auto db = (*client_)[currentDbName_];
        auto coll = db[cmd.collection];
        QueryResult result;

        if (cmd.method == "find")
        {
            auto filter = cmd.jsonArg.empty()
                ? bsoncxx::document::value(make_document())
                : bsoncxx::from_json(cmd.jsonArg);
            auto cursor = coll.find(filter.view());
            // Discover columns from first batch of results
            std::vector<ColumnInfo> cols;
            std::vector<bsoncxx::document::value> docs;
            for (auto& doc : cursor)
                docs.push_back(bsoncxx::document::value(doc));

            if (!docs.empty())
            {
                // Use describe to get column info
                cols = describeTable(fromUtf8(cmd.collection), fromUtf8(currentDbName_));
                for (auto& c : cols) result.columnNames.push_back(c.name);
                for (auto& d : docs)
                {
                    bsoncxx::document::view v = d.view();
                    result.rows.push_back(flattenDocument(&v, cols));
                }
            }
        }
        else if (cmd.method == "insertOne")
        {
            auto doc = bsoncxx::from_json(cmd.jsonArg);
            auto res = coll.insert_one(doc.view());
            result.columnNames = { L"insertedId" };
            TableRow row;
            if (res)
                row[L"insertedId"] = fromUtf8(res->inserted_id().get_oid().value.to_string());
            result.rows.push_back(row);
            // Invalidate schema cache for this collection
            schemaCache_.erase(currentDbName_ + "." + cmd.collection);
        }
        else if (cmd.method == "updateOne")
        {
            // Expect two JSON args separated by comma: filter, update
            // Parse: {filter}, {update}
            auto args = cmd.jsonArg;
            // Find the split point between two JSON objects
            int braceDepth = 0;
            size_t splitPos = std::string::npos;
            for (size_t i = 0; i < args.size(); i++)
            {
                if (args[i] == '{') braceDepth++;
                else if (args[i] == '}') braceDepth--;
                if (braceDepth == 0 && i > 0)
                {
                    // Find next comma after closing brace
                    auto next = args.find(',', i + 1);
                    if (next != std::string::npos) { splitPos = next; break; }
                }
            }
            if (splitPos == std::string::npos)
                throw DatabaseError(DatabaseError::Code::InvalidSQL,
                    "updateOne requires: db.coll.updateOne({filter}, {update})");

            auto filterStr = args.substr(0, splitPos);
            auto updateStr = args.substr(splitPos + 1);
            // Trim whitespace
            while (!updateStr.empty() && updateStr.front() == ' ') updateStr.erase(updateStr.begin());

            auto filter = bsoncxx::from_json(filterStr);
            auto update = bsoncxx::from_json(updateStr);
            auto res = coll.update_one(filter.view(), update.view());

            result.columnNames = { L"matchedCount", L"modifiedCount" };
            TableRow row;
            row[L"matchedCount"] = std::to_wstring(res ? res->matched_count() : 0);
            row[L"modifiedCount"] = std::to_wstring(res ? res->modified_count() : 0);
            result.rows.push_back(row);
        }
        else if (cmd.method == "deleteOne")
        {
            auto filter = bsoncxx::from_json(cmd.jsonArg);
            auto res = coll.delete_one(filter.view());
            result.columnNames = { L"deletedCount" };
            TableRow row;
            row[L"deletedCount"] = std::to_wstring(res ? res->deleted_count() : 0);
            result.rows.push_back(row);
        }
        else if (cmd.method == "aggregate")
        {
            // jsonArg should be a JSON array: [{$match:...}, {$group:...}]
            auto pipeline = bsoncxx::from_json(cmd.jsonArg);

            // Build pipeline from array
            mongocxx::pipeline pipe;
            for (auto& stage : pipeline.view())
                pipe.append_stage(stage.get_document().value);

            auto cursor = coll.aggregate(pipe);
            bool first = true;
            for (auto& doc : cursor)
            {
                if (first)
                {
                    for (auto& elem : doc)
                        result.columnNames.push_back(fromUtf8(std::string(elem.key())));
                    first = false;
                }
                TableRow row;
                for (auto& elem : doc)
                {
                    // Wrap element value in a temp document to use to_json
                    auto tmp = make_document(kvp("v", elem.get_value()));
                    auto json = bsoncxx::to_json(tmp.view());
                    auto pos = json.find(':');
                    std::wstring val;
                    if (pos != std::string::npos)
                        val = fromUtf8(json.substr(pos + 2, json.size() - pos - 3));
                    else
                        val = fromUtf8(json);
                    row[fromUtf8(std::string(elem.key()))] = val;
                }
                result.rows.push_back(row);
            }
        }
        else if (cmd.method == "count")
        {
            auto filter = cmd.jsonArg.empty()
                ? bsoncxx::document::value(make_document())
                : bsoncxx::from_json(cmd.jsonArg);
            auto count = coll.count_documents(filter.view());
            result.columnNames = { L"count" };
            TableRow row;
            row[L"count"] = std::to_wstring(count);
            result.rows.push_back(row);
        }
        else
        {
            throw DatabaseError(DatabaseError::Code::InvalidSQL,
                "Unsupported method: " + cmd.method +
                ". Supported: find, insertOne, updateOne, deleteOne, aggregate, count");
        }

        auto end = std::chrono::steady_clock::now();
        result.totalRows = static_cast<int>(result.rows.size());
        result.executionTimeMs = std::chrono::duration<double, std::milli>(end - start).count();
        return result;
    }

    QueryResult MongoDBAdapter::executeRunCommand(const std::string& json)
    {
        auto start = std::chrono::steady_clock::now();
        auto db = (*client_)[currentDbName_];
        auto cmdDoc = bsoncxx::from_json(json);
        auto res = db.run_command(cmdDoc.view());

        QueryResult result;
        result.columnNames = { L"result" };
        TableRow row;
        row[L"result"] = fromUtf8(bsoncxx::to_json(res.view()));
        result.rows.push_back(row);

        auto end = std::chrono::steady_clock::now();
        result.totalRows = 1;
        result.executionTimeMs = std::chrono::duration<double, std::milli>(end - start).count();
        return result;
    }

    // Helper: append a filter value for _id. ObjectId is a 24-char hex
    // string produced by flattenDocument (oid.to_string()). Attempt to
    // construct bsoncxx::oid first; if the value is not a valid ObjectId
    // (e.g. string _id, integer _id), fall back to matching as a plain
    // string. This prevents "could not parse Object ID string" errors.
    static void appendIdFilter(
        bsoncxx::builder::basic::document& filter,
        const std::string& key, const std::string& val)
    {
        if (key == "_id")
        {
            try
            {
                filter.append(kvp(key, bsoncxx::oid(val)));
                return;
            }
            catch (...) {}
            filter.append(kvp(key, val));
        }
        else
        {
            filter.append(kvp(key, val));
        }
    }

    // ── CRUD operations (used by data grid inline editing) ────
    QueryResult MongoDBAdapter::insertRow(
        const std::wstring& table, const std::wstring& schema,
        const TableRow& values)
    {
        auto db = getDatabase(schema);
        auto coll = db[toUtf8(table)];

        bsoncxx::builder::basic::document builder;
        for (auto& [col, val] : values)
            builder.append(kvp(toUtf8(col), toUtf8(val)));

        auto res = coll.insert_one(builder.extract());
        // Invalidate schema cache
        schemaCache_.erase(toUtf8(schema) + "." + toUtf8(table));

        QueryResult result;
        result.totalRows = res ? 1 : 0;
        return result;
    }

    QueryResult MongoDBAdapter::updateRow(
        const std::wstring& table, const std::wstring& schema,
        const TableRow& setValues, const TableRow& whereValues)
    {
        auto db = getDatabase(schema);
        auto coll = db[toUtf8(table)];

        // Build filter from whereValues (typically _id)
        bsoncxx::builder::basic::document filter;
        for (auto& [col, val] : whereValues)
            appendIdFilter(filter, toUtf8(col), toUtf8(val));

        // Build $set from setValues
        bsoncxx::builder::basic::document setDoc;
        for (auto& [col, val] : setValues)
            setDoc.append(kvp(toUtf8(col), toUtf8(val)));

        auto update = make_document(kvp("$set", setDoc.extract()));
        auto res = coll.update_one(filter.extract(), update.view());

        QueryResult result;
        result.totalRows = res ? static_cast<int>(res->modified_count()) : 0;
        return result;
    }

    QueryResult MongoDBAdapter::deleteRow(
        const std::wstring& table, const std::wstring& schema,
        const TableRow& whereValues)
    {
        auto db = getDatabase(schema);
        auto coll = db[toUtf8(table)];

        bsoncxx::builder::basic::document filter;
        for (auto& [col, val] : whereValues)
            appendIdFilter(filter, toUtf8(col), toUtf8(val));

        auto res = coll.delete_one(filter.extract());
        QueryResult result;
        result.totalRows = res ? static_cast<int>(res->deleted_count()) : 0;
        return result;
    }

    // ── Transactions (MongoDB 4.0+ replica set required) ──────
    void MongoDBAdapter::beginTransaction()
    {
        if (!isConnected())
            throw DatabaseError(DatabaseError::Code::TransactionFailed, "Not connected");
        try
        {
            session_ = std::make_unique<mongocxx::client_session>(
                client_->start_session());
            session_->start_transaction();
        }
        catch (const std::exception& ex)
        {
            session_.reset();
            throw DatabaseError(DatabaseError::Code::TransactionFailed,
                std::string("Failed to start transaction (requires MongoDB 4.0+ "
                            "replica set): ") + ex.what());
        }
    }

    void MongoDBAdapter::commitTransaction()
    {
        if (!session_)
            throw DatabaseError(DatabaseError::Code::TransactionFailed, "No active transaction");
        try
        {
            session_->commit_transaction();
            session_.reset();
        }
        catch (const std::exception& ex)
        {
            session_.reset();
            throw DatabaseError(DatabaseError::Code::TransactionFailed,
                std::string("Commit failed: ") + ex.what());
        }
    }

    void MongoDBAdapter::rollbackTransaction()
    {
        if (!session_)
            throw DatabaseError(DatabaseError::Code::TransactionFailed, "No active transaction");
        try
        {
            session_->abort_transaction();
            session_.reset();
        }
        catch (const std::exception& ex)
        {
            session_.reset();
            throw DatabaseError(DatabaseError::Code::TransactionFailed,
                std::string("Rollback failed: ") + ex.what());
        }
    }
}
