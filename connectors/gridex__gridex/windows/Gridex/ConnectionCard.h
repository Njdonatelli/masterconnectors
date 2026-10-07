#pragma once

#include "ConnectionCard.g.h"
#include "Models/ConnectionConfig.h"
#include <functional>

namespace winrt::Gridex::implementation
{
    struct ConnectionCard : ConnectionCardT<ConnectionCard>
    {
        ConnectionCard();

        void SetConnection(const DBModels::ConnectionConfig& config);

        void ContextConnect_Click(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& e);
        void ContextEdit_Click(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& e);
        void ContextDelete_Click(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& e);

        std::function<void(const std::wstring& id)> OnDelete;
        std::function<void(const std::wstring& id)> OnEdit;

    private:
        std::wstring connectionId_;
    };
}

namespace winrt::Gridex::factory_implementation
{
    struct ConnectionCard : ConnectionCardT<ConnectionCard, implementation::ConnectionCard>
    {
    };
}
