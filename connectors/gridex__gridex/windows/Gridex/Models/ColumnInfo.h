#pragma once
#include <string>
#include <optional>

namespace DBModels
{
    struct ColumnInfo
    {
        std::wstring name;
        std::wstring dataType;
        bool nullable = true;
        std::wstring defaultValue;
        bool isPrimaryKey = false;
        bool isForeignKey = false;
        std::wstring fkReferencedTable;
        std::wstring fkReferencedColumn;
        std::wstring comment;
        int ordinalPosition = 0;
    };

    struct IndexInfo
    {
        std::wstring name;
        std::wstring columns;   // comma-separated
        bool isUnique = false;
        std::wstring algorithm; // BTREE, HASH, etc.
        std::wstring condition;
        bool isPrimary = false;
    };

    struct ForeignKeyInfo
    {
        std::wstring name;
        std::wstring column;
        std::wstring referencedTable;
        std::wstring referencedColumn;
        std::wstring onUpdate;  // CASCADE, SET NULL, RESTRICT, etc.
        std::wstring onDelete;
    };

    struct ConstraintInfo
    {
        std::wstring name;
        std::wstring type;     // PRIMARY KEY, UNIQUE, CHECK, FOREIGN KEY
        std::wstring columns;  // comma-separated
        std::wstring definition;
    };
}
