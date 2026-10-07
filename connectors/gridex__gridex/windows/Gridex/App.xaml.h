#pragma once

#include "App.xaml.g.h"

namespace winrt::Gridex::implementation
{
    struct App : AppT<App>
    {
        App();

        void OnLaunched(Microsoft::UI::Xaml::LaunchActivatedEventArgs const&);
        static HWND MainHwnd;

    private:
        winrt::Microsoft::UI::Xaml::Window window{ nullptr };
    };
}
