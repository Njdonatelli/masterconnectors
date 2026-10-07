#pragma once
#include <string>
#include <vector>
#include <unordered_map>

namespace DBModels
{
    // A single cell value (string representation)
    using CellValue = std::wstring;

    // A row is a map of column name -> value
    using TableRow = std::unordered_map<std::wstring, CellValue>;

    // ── SQL NULL sentinel ───────────────────────────────
    //
    // TableRow values are wstrings, which can't naturally distinguish a SQL
    // NULL from a literal string "NULL" typed into a varchar cell. Adapters
    // emit `nullValue()` for SQL NULL — a sentinel containing control chars
    // that user input cannot produce — and consumers test with `isNullCell()`
    // before deciding whether to render "NULL" / emit IS NULL / write JSON null.
    //
    // Display formatting (DataGridView, ExportService, ChangeTracker) maps the
    // sentinel back to the visible string "NULL" so the UI/SQL output looks
    // the same as before. The difference: a user who types the literal text
    // "NULL" now gets a real string, not a NULL.
    inline constexpr const wchar_t* kNullMarker = L"\x01\x02__GRIDEX_NULL__\x02\x01";

    inline const std::wstring& nullValue()
    {
        static const std::wstring v{ kNullMarker };
        return v;
    }

    inline bool isNullCell(const std::wstring& v)
    {
        return v == kNullMarker;
    }
}
