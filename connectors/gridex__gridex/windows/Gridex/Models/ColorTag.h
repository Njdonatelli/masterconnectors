#pragma once
#include <string>
#include <cstdint>
#include <array>

namespace DBModels
{
    enum class ColorTag
    {
        Red,
        Orange,
        Green,
        Blue,
        Purple,
        Gray
    };

    struct ColorTagInfo
    {
        ColorTag tag;
        std::wstring hint;
        uint8_t r, g, b;
    };

    inline constexpr size_t COLOR_TAG_COUNT = 6;

    inline const std::array<ColorTagInfo, COLOR_TAG_COUNT>& GetColorTags()
    {
        static const std::array<ColorTagInfo, COLOR_TAG_COUNT> tags = {{
            { ColorTag::Red,    L"Production",  226, 75,  74  },
            { ColorTag::Orange, L"Staging",     239, 159, 39  },
            { ColorTag::Green,  L"Development", 99,  153, 34  },
            { ColorTag::Blue,   L"Local",       55,  138, 221 },
            { ColorTag::Purple, L"Custom",      83,  74,  183 },
            { ColorTag::Gray,   L"Other",       128, 128, 128 },
        }};
        return tags;
    }

    inline const ColorTagInfo& GetColorTagInfo(ColorTag tag)
    {
        return GetColorTags()[static_cast<size_t>(tag)];
    }
}
