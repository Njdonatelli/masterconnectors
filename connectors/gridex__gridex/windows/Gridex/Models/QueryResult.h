#pragma once
#include <string>
#include <vector>
#include "ColumnInfo.h"
#include "TableRow.h"

namespace DBModels
{
    struct QueryResult
    {
        std::vector<std::wstring> columnNames;
        std::vector<std::wstring> columnTypes;
        std::vector<TableRow> rows;
        int totalRows = 0;
        int currentPage = 1;
        int pageSize = 100;
        // Wall-clock of the blocking driver call (PQexec / mysql_real_query).
        // Includes SQL send, server execution, and result byte transfer.
        double executionTimeMs = 0.0;
        std::wstring error;
        std::wstring sql;
        bool success = true;

        int totalPages() const
        {
            if (pageSize <= 0) return 1;
            return (totalRows + pageSize - 1) / pageSize;
        }
    };
}
