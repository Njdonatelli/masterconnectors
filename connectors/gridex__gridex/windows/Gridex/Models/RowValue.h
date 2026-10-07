#pragma once
#include <string>
#include <optional>

namespace DBModels
{
    enum class ValueType
    {
        String, Integer, Float, Boolean, Null, Binary, Json, Date, Timestamp
    };

    struct RowValue
    {
        std::wstring text;
        ValueType type = ValueType::String;
        bool isNull = false;

        RowValue() : isNull(true), type(ValueType::Null) {}
        RowValue(const std::wstring& val) : text(val), type(ValueType::String), isNull(false) {}
        RowValue(const std::wstring& val, ValueType t) : text(val), type(t), isNull(false) {}

        static RowValue null() { return RowValue(); }
        static RowValue fromString(const std::wstring& val) { return RowValue(val); }
        static RowValue fromInt(int64_t val) { return RowValue(std::to_wstring(val), ValueType::Integer); }
        static RowValue fromDouble(double val) { return RowValue(std::to_wstring(val), ValueType::Float); }
        static RowValue fromBool(bool val) { return RowValue(val ? L"true" : L"false", ValueType::Boolean); }

        std::wstring displayValue() const
        {
            if (isNull) return L"NULL";
            return text;
        }
    };
}
