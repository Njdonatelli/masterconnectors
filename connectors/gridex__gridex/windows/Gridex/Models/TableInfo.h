#pragma once
#include <string>

namespace DBModels
{
    struct TableInfo
    {
        std::wstring name;
        std::wstring schema;
        std::wstring type;       // "table", "view", "materialized_view"
        std::wstring owner;
        int64_t estimatedRows = 0;
        int64_t sizeBytes = 0;
        std::wstring comment;
    };
}
