#pragma once
#include <string>
#include <vector>
#include <optional>
#include "ContentTab.h"
#include "SidebarItem.h"
#include "ColumnInfo.h"
#include "QueryResult.h"
#include "ConnectionConfig.h"

namespace DBModels
{
    struct WorkspaceState
    {
        ConnectionConfig connection;
        std::vector<ContentTab> tabs;
        std::wstring activeTabId;
        std::vector<SidebarItem> sidebarItems;
        bool sidebarVisible = true;
        bool detailsPanelVisible = true;

        // Status bar. Two-way split so a slow UI build on a wide table
        // does not get mis-attributed to a slow SQL query:
        //   Exec   = driver blocking call wall-clock (SQL send, server
        //            execution, result bytes delivered to the client).
        //   Render = DataGridView::SetData cost on the UI thread
        //            (StackPanel + TextBlock construction).
        std::wstring statusConnection;
        std::wstring statusSchema;
        int statusRowCount = 0;
        double statusQueryTimeMs  = 0.0;   // Exec (driver wall-clock)
        double statusRenderTimeMs = 0.0;   // Render (UI build)

        // Current view data (for active tab)
        QueryResult currentData;
        std::vector<ColumnInfo> currentColumns;
        std::vector<IndexInfo> currentIndexes;
        std::vector<ForeignKeyInfo> currentForeignKeys;
        std::vector<ConstraintInfo> currentConstraints;

        // Pagination
        int currentPage = 0;
        int pageSize = 100;

        // Selected row details
        std::optional<int> selectedRowIndex;
    };
}
