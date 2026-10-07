#pragma once
#include <string>
#include <memory>
#include <functional>
#include "DatabaseAdapter.h"
#include "DatabaseType.h"

namespace DBModels
{
    // Called from background thread with a single progress message line.
    // Implementation must be thread-safe and not touch WinRT UI directly.
    using ProgressCallback = std::function<void(const std::wstring&)>;

    struct DumpResult
    {
        bool success = false;
        int tablesProcessed = 0;
        int rowsExported = 0;
        std::wstring error;
    };

    struct RestoreResult
    {
        bool success = false;
        int statementsExecuted = 0;
        int statementsFailed = 0;
        std::wstring error;
    };

    // Database-level dump and restore. Uses batched LIMIT/OFFSET reads to keep
    // memory bounded regardless of table size; rows are streamed to disk
    // immediately rather than accumulated in memory.
    class DumpRestoreService
    {
    public:
        static constexpr int DEFAULT_BATCH_SIZE = 1000;

        // Dump every table in `schema` to a single .sql file.
        // batchSize: number of rows fetched per LIMIT/OFFSET round-trip.
        // dbType: needed for emitting correct DROP CASCADE / FK directives.
        // progress: optional callback for status updates (called from caller's thread).
        static DumpResult DumpDatabase(
            std::shared_ptr<DatabaseAdapter> adapter,
            DatabaseType dbType,
            const std::wstring& schema,
            const std::wstring& outputFile,
            int batchSize = DEFAULT_BATCH_SIZE,
            ProgressCallback progress = nullptr);

        // Read .sql file and execute every statement against `adapter`.
        // Wraps in a transaction; rolls back on any failure.
        static RestoreResult RestoreDatabase(
            std::shared_ptr<DatabaseAdapter> adapter,
            const std::wstring& inputFile,
            ProgressCallback progress = nullptr);
    };
}
