#version 450
#extension GL_GOOGLE_include_directive : require
layout(location=0) out vec4 outColor;
#define STATE_ACCESS readonly
#include "abi.glsl"
#include "text.glsl"
#include "draw.glsl"

void main(){
    vec2 p = gl_FragCoord.xy;
    vec3 color = mix(vec3(.08, .08, .09), vec3(.15, .02, .02), p.y / 1080.0);

    // Main Content Panel
    float panel = fill(box(p, vec2(960, 540), vec2(880, 680), 24));
    color = mix(color, vec3(.12, .12, .14), panel);

    // Header Panel (YouTube Red theme)
    float header = fill(box(p, vec2(960, 120), vec2(820, 64), 14));
    color = mix(color, vec3(.85, 0.0, 0.0), header);
    color = mix(color, vec3(1.0, 1.0, 1.0), text(p, vec2(960 - TEXT_TITLE.z / 2.0, 102), TEXT_TITLE));
    color = mix(color, vec3(.90, .90, .90), text(p, vec2(960 - TEXT_SUBTITLE.z / 2.0, 138), TEXT_SUBTITLE));

    int selected = NUM_YOUTUBE_ITEMS > 0 ? int(c.game.x % uint(NUM_YOUTUBE_ITEMS)) : 0;

    ivec4 itemTexts[12] = ivec4[12](
        TEXT_YT_ITEM_0, TEXT_YT_ITEM_1, TEXT_YT_ITEM_2, TEXT_YT_ITEM_3,
        TEXT_YT_ITEM_4, TEXT_YT_ITEM_5, TEXT_YT_ITEM_6, TEXT_YT_ITEM_7,
        TEXT_YT_ITEM_8, TEXT_YT_ITEM_9, TEXT_YT_ITEM_10, TEXT_YT_ITEM_11
    );

    int visibleCount = min(NUM_YOUTUBE_ITEMS, 10);
    int scrollOffset = max(0, min(selected - 4, NUM_YOUTUBE_ITEMS - visibleCount));

    for (int r = 0; r < 10; r++) {
        int i = scrollOffset + r;
        if (i >= NUM_YOUTUBE_ITEMS) break;

        float yPos = 200.0 + float(r * 44);
        float itemBox = fill(box(p, vec2(960, yPos + 18), vec2(800, 38), 8));
        vec3 itemColor = (i == selected) ? vec3(.95, .20, .20) : vec3(.18, .18, .22);
        color = mix(color, itemColor, itemBox);

        if (i == selected) {
            float badge = fill(box(p, vec2(170, yPos + 18), vec2(10, 22), 4));
            color = mix(color, vec3(1.0, 1.0, 1.0), badge);
        }
        if (c.game.y == 1u && uint(i) == c.game.z) {
            float playingBadge = fill(box(p, vec2(1750, yPos + 18), vec2(10, 22), 4));
            color = mix(color, vec3(.20, .90, .40), playingBadge);
        }
        color = mix(color, vec3(1.0, 1.0, 1.0), text(p, vec2(195, yPos + 7), itemTexts[i]));
    }

    // Live Stream Video Player View when playing (c.game.y == 1u)
    if (c.game.y == 1u) {
        vec2 uv = p / vec2(1920.0, 1080.0);
        ivec2 pixel = clamp(ivec2(uv * vec2(1920.0, 1080.0)), ivec2(0), ivec2(1919, 1079));
        uint byteIndex = uint(pixel.y * 1920 + pixel.x) * 2u;
        uint packed = (c.atlas[byteIndex >> 2u] >> ((byteIndex & 2u) * 8u)) & 65535u;
        vec3 rgb = vec3(float((packed >> 11u) & 31u) / 31.0,
                        float((packed >> 5u) & 63u) / 63.0,
                        float(packed & 31u) / 31.0);
        color = rgb;
    }

    // Status Panel
    float statusPanel = fill(box(p, vec2(960, 800), vec2(800, 40), 8));
    color = mix(color, vec3(.10, .10, .12), statusPanel);
    color = mix(color, vec3(.90, .90, .95), text(p, vec2(960 - TEXT_STATUS_READY.z / 2.0, 792), TEXT_STATUS_READY));

    // Controls Footer
    float ctrlPanel = fill(box(p, vec2(960, 860), vec2(800, 38), 8));
    color = mix(color, vec3(.08, .08, .10), ctrlPanel);
    color = mix(color, vec3(.80, .85, .90), text(p, vec2(960 - TEXT_CONTROLS.z / 2.0, 852), TEXT_CONTROLS));

    outColor = vec4(color * (1.0 - c.transition.x), 1);
}
