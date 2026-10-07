#pragma once
#include <string>
#include <vector>
#include "TableRow.h"

namespace DBModels
{
    struct ImportResult
    {
        std::vector<std::wstring> columnNames;
        std::vector<TableRow> rows;            // CSV/JSON parsed rows
        std::vector<std::wstring> sqlStatements; // SQL parsed statements
        int totalParsed = 0;
        std::wstring error;
        bool success = false;
    };

    // Parse CSV/JSON/SQL files into importable data
    class ImportService
    {
    public:
        // Parse CSV content → column names + rows
        static ImportResult ParseCsv(const std::wstring& content);

        // Parse JSON array content → column names + rows
        static ImportResult ParseJson(const std::wstring& content);

        // Parse SQL file → individual statements
        static ImportResult ParseSql(const std::wstring& content);

        // Read file from disk as wstring (UTF-8 → wide)
        static std::wstring ReadFileAsWstring(const std::wstring& filePath);

        // Detect format from file extension
        static std::wstring DetectFormat(const std::wstring& filename);
    };
}
