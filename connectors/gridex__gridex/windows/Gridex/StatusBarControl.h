#pragma once

#include "StatusBarControl.g.h"
#include <string>

namespace winrt::Gridex::implementation
{
    struct StatusBarControl : StatusBarControlT<StatusBarControl>
    {
        StatusBarControl();

        // Update all status fields at once. Two separate timings are
        // displayed so wide-table slowness is attributed to the right
        // layer instead of lumped under a single misleading number:
        //   queryTimeMs  = driver blocking call wall-clock (Exec) —
        //                  includes SQL send, server execution, and
        //                  full result transfer back to the client.
        //   renderTimeMs = UI grid build time (Render)
        void SetStatus(
            const std::wstring& connection,
            const std::wstring& schema,
            int                 rowCount,
            double              queryTimeMs,
            double              renderTimeMs);

    private:
        std::wstring connection_;
        std::wstring schema_;
        int          rowCount_     = 0;
        double       queryTimeMs_  = 0.0;
        double       renderTimeMs_ = 0.0;
    };
}

namespace winrt::Gridex::factory_implementation
{
    struct StatusBarControl : StatusBarControlT<StatusBarControl, implementation::StatusBarControl>
    {
    };
}
