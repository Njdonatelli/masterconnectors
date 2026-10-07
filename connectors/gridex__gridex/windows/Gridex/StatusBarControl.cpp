#include "pch.h"
#include "xaml-includes.h"
#include "StatusBarControl.h"
#include <winrt/Microsoft.UI.Xaml.Controls.h>
#if __has_include("StatusBarControl.g.cpp")
#include "StatusBarControl.g.cpp"
#endif

namespace winrt::Gridex::implementation
{
    namespace mux  = winrt::Microsoft::UI::Xaml;
    namespace muxc = winrt::Microsoft::UI::Xaml::Controls;

    StatusBarControl::StatusBarControl()
    {
        InitializeComponent();
    }

    void StatusBarControl::SetStatus(
        const std::wstring& connection,
        const std::wstring& schema,
        int                 rowCount,
        double              queryTimeMs,
        double              renderTimeMs)
    {
        connection_   = connection;
        schema_       = schema;
        rowCount_     = rowCount;
        queryTimeMs_  = queryTimeMs;
        renderTimeMs_ = renderTimeMs;

        ConnectionText().Text(winrt::hstring(connection_));
        SchemaText().Text(winrt::hstring(schema_));

        std::wstring rowStr = std::to_wstring(rowCount_) + L" rows";
        RowCountText().Text(winrt::hstring(rowStr));

        // "Exec Nms · Render Nms" — two-way split so a slow UI build on a
        // wide table does not get mis-attributed to a slow SQL query.
        std::wstring timeStr =
            L"Exec "   + std::to_wstring(static_cast<int>(queryTimeMs_))  + L"ms" +
            L"  \x00B7  " +
            L"Render " + std::to_wstring(static_cast<int>(renderTimeMs_)) + L"ms";
        QueryTimeText().Text(winrt::hstring(timeStr));

        // Tooltip clarifies what each number actually measures -- users
        // otherwise read "Exec" as pure server execution when it really
        // includes the full driver round-trip and result transfer.
        muxc::ToolTip tip;
        tip.Content(winrt::box_value(winrt::hstring(
            L"Exec   = driver blocking call: send SQL, server execution, "
            L"receive all result bytes. Dominated by network transfer on "
            L"remote databases with wide rows.\n"
            L"Render = UI cost to build the visual grid (StackPanel + "
            L"TextBlock per cell).")));
        muxc::ToolTipService::SetToolTip(QueryTimeText(), tip);
    }
}
