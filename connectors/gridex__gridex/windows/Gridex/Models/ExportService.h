#pragma once
#include <string>
#include "QueryResult.h"

namespace DBModels
{
    // Export query results to CSV, JSON, or SQL
    class ExportService
    {
    public:
        // Export to CSV string
        static std::wstring ToCsv(const QueryResult& result);

        // Export to JSON array string
        static std::wstring ToJson(const QueryResult& result);

        // Export to SQL INSERT statements
        static std::wstring ToSqlInsert(
            const QueryResult& result,
            const std::wstring& tableName);

        // Write content to a file path (no dialog — caller handles picker)
        static bool WriteToStorageFile(
            const std::wstring& content,
            const std::wstring& filterExtension,
            const std::wstring& filePath);

        // Legacy — no-op now
        static bool SaveToFile(
            const std::wstring& content,
            const std::wstring& defaultFileName,
            const std::wstring& filterName,
            const std::wstring& filterExtension,
            HWND hwnd = nullptr);

        static std::wstring GetLastSavedPath() { return lastSavedPath_; }

    private:
        static std::string toUtf8(const std::wstring& wstr);
        static inline std::wstring lastSavedPath_;
    };
}
