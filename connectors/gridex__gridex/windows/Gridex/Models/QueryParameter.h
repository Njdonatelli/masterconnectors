#pragma once
#include <string>
#include "RowValue.h"

namespace DBModels
{
    struct QueryParameter
    {
        std::wstring name;
        RowValue value;
    };
}
