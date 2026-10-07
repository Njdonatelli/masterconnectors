#pragma once

#include "DatabaseTypePickerDialog.g.h"
#include "Models/DatabaseType.h"
#include <functional>

namespace winrt::Gridex::implementation
{
    struct DatabaseTypePickerDialog : DatabaseTypePickerDialogT<DatabaseTypePickerDialog>
    {
        DatabaseTypePickerDialog();

        void TypeButton_Click(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& e);

        std::function<void(DBModels::DatabaseType)> OnTypeSelected;
    };
}

namespace winrt::Gridex::factory_implementation
{
    struct DatabaseTypePickerDialog : DatabaseTypePickerDialogT<DatabaseTypePickerDialog, implementation::DatabaseTypePickerDialog>
    {
    };
}
