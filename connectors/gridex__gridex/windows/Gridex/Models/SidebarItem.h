#pragma once
#include <string>
#include <vector>
#include <memory>

namespace DBModels
{
    enum class SidebarItemType
    {
        Connection, Database, Schema, Group,
        Table, View, MaterializedView, Function, EnumType
    };

    struct SidebarItem
    {
        std::wstring id;
        std::wstring title;
        SidebarItemType type;
        std::wstring icon;     // Segoe Fluent Icons glyph
        std::vector<SidebarItem> children;
        bool isExpanded = false;
        int count = 0;          // badge count for groups
        std::wstring schema;    // parent schema name
    };

    // Icon glyphs for sidebar items
    inline std::wstring SidebarItemIcon(SidebarItemType type)
    {
        switch (type)
        {
        case SidebarItemType::Database:   return L"\xE968";  // Database
        case SidebarItemType::Schema:     return L"\xE8B7";  // Folder
        case SidebarItemType::Group:      return L"\xE8B7";  // Folder
        case SidebarItemType::Table:      return L"\xE80A";  // Table
        case SidebarItemType::View:       return L"\xE7B3";  // Eye
        case SidebarItemType::MaterializedView: return L"\xE7B3";
        case SidebarItemType::Function:   return L"\xE943";  // Code
        case SidebarItemType::EnumType:   return L"\xE8FD";  // List
        default: return L"\xE8B7";
        }
    }
}
