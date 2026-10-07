#include <windows.h>
#include "Models/ExportService.h"
#include <fstream>

namespace DBModels
{
    std::string ExportService::toUtf8(const std::wstring& wstr)
    {
        if (wstr.empty()) return {};
        int size = WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(),
            static_cast<int>(wstr.size()), nullptr, 0, nullptr, nullptr);
        std::string result(size, '\0');
        WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(),
            static_cast<int>(wstr.size()), &result[0], size, nullptr, nullptr);
        return result;
    }

    std::wstring ExportService::ToCsv(const QueryResult& result)
    {
        std::wstring csv;
        for (size_t i = 0; i < result.columnNames.size(); i++)
        {
            if (i > 0) csv += L',';
            csv += L'"';
            for (wchar_t c : result.columnNames[i])
            {
                if (c == L'"') csv += L"\"\"";
                else csv += c;
            }
            csv += L'"';
        }
        csv += L'\n';
        for (auto& row : result.rows)
        {
            for (size_t i = 0; i < result.columnNames.size(); i++)
            {
                if (i > 0) csv += L',';
                std::wstring val;
                auto it = row.find(result.columnNames[i]);
                if (it != row.end()) val = it->second;
                if (!isNullCell(val))
                {
                    csv += L'"';
                    for (wchar_t c : val)
                    {
                        if (c == L'"') csv += L"\"\"";
                        else csv += c;
                    }
                    csv += L'"';
                }
            }
            csv += L'\n';
        }
        return csv;
    }

    std::wstring ExportService::ToJson(const QueryResult& result)
    {
        std::wstring json = L"[\n";
        for (size_t r = 0; r < result.rows.size(); r++)
        {
            auto& row = result.rows[r];
            json += L"  {";
            for (size_t c = 0; c < result.columnNames.size(); c++)
            {
                if (c > 0) json += L',';
                json += L'\n';
                auto& colName = result.columnNames[c];
                std::wstring val;
                auto it = row.find(colName);
                if (it != row.end()) val = it->second;
                json += L"    \"";
                for (wchar_t ch : colName)
                {
                    if (ch == L'"') json += L"\\\"";
                    else if (ch == L'\\') json += L"\\\\";
                    else json += ch;
                }
                json += L"\": ";
                if (isNullCell(val)) json += L"null";
                else
                {
                    json += L'"';
                    for (wchar_t ch : val)
                    {
                        if (ch == L'"') json += L"\\\"";
                        else if (ch == L'\\') json += L"\\\\";
                        else if (ch == L'\n') json += L"\\n";
                        else json += ch;
                    }
                    json += L'"';
                }
            }
            json += L"\n  }";
            if (r + 1 < result.rows.size()) json += L',';
            json += L'\n';
        }
        json += L"]\n";
        return json;
    }

    std::wstring ExportService::ToSqlInsert(
        const QueryResult& result, const std::wstring& tableName)
    {
        std::wstring sql;
        for (auto& row : result.rows)
        {
            sql += L"INSERT INTO \"" + tableName + L"\" (";
            for (size_t i = 0; i < result.columnNames.size(); i++)
            {
                if (i > 0) sql += L", ";
                sql += L'"' + result.columnNames[i] + L'"';
            }
            sql += L") VALUES (";
            for (size_t i = 0; i < result.columnNames.size(); i++)
            {
                if (i > 0) sql += L", ";
                std::wstring val;
                auto it = row.find(result.columnNames[i]);
                if (it != row.end()) val = it->second;
                if (isNullCell(val)) sql += L"NULL";
                else
                {
                    sql += L'\'';
                    for (wchar_t c : val)
                    {
                        if (c == L'\'') sql += L"''";
                        else sql += c;
                    }
                    sql += L'\'';
                }
            }
            sql += L");\n";
        }
        return sql;
    }

    // SaveToFile now just writes to disk — no dialog
    bool ExportService::SaveToFile(
        const std::wstring& content,
        const std::wstring& /*defaultFileName*/,
        const std::wstring& /*filterName*/,
        const std::wstring& filterExtension,
        HWND /*hwnd*/)
    {
        // This is now a no-op placeholder — actual saving done via async picker in WorkspacePage
        (void)content; (void)filterExtension;
        return false;
    }

    bool ExportService::WriteToStorageFile(
        const std::wstring& content,
        const std::wstring& filterExtension,
        const std::wstring& filePath)
    {
        std::string utf8 = toUtf8(content);
        std::ofstream file(filePath, std::ios::binary);
        if (!file.is_open()) return false;
        if (filterExtension == L".csv")
            file.write("\xEF\xBB\xBF", 3);
        file.write(utf8.c_str(), utf8.size());
        file.close();
        lastSavedPath_ = filePath;
        return true;
    }
}
