#version 450
#extension GL_GOOGLE_include_directive : require
layout(location=0) out vec4 outColor;
#define STATE_ACCESS readonly
#include "abi.glsl"
#include "text.glsl"
#include "draw.glsl"

void main(){
    vec2 p = gl_FragCoord.xy;
    vec3 color = mix(vec3(.03, .08, .15), vec3(.02, .18, .28), p.y / 1080.0);

    // Main Panel
    float panel = fill(box(p, vec2(960, 540), vec2(860, 660), 28));
    color = mix(color, vec3(.06, .12, .20), panel);

    // Header Panel
    float header = fill(box(p, vec2(960, 130), vec2(800, 60), 16));
    color = mix(color, vec3(.09, .20, .34), header);
    color = mix(color, vec3(.95, .98, 1.0), text(p, vec2(960 - TEXT_TITLE.z / 2.0, 108), TEXT_TITLE));
    color = mix(color, vec3(.60, .80, .90), text(p, vec2(960 - TEXT_SUBTITLE.z / 2.0, 145), TEXT_SUBTITLE));

    int selected = NUM_FILES > 0 ? int(c.game.x % uint(NUM_FILES)) : 0;
    
    ivec4 fileTexts[32] = ivec4[32](
        TEXT_FILE_0, TEXT_FILE_1, TEXT_FILE_2, TEXT_FILE_3,
        TEXT_FILE_4, TEXT_FILE_5, TEXT_FILE_6, TEXT_FILE_7,
        TEXT_FILE_8, TEXT_FILE_9, TEXT_FILE_10, TEXT_FILE_11,
        TEXT_FILE_12, TEXT_FILE_13, TEXT_FILE_14, TEXT_FILE_15,
        TEXT_FILE_16, TEXT_FILE_17, TEXT_FILE_18, TEXT_FILE_19,
        TEXT_FILE_20, TEXT_FILE_21, TEXT_FILE_22, TEXT_FILE_23,
        TEXT_FILE_24, TEXT_FILE_25, TEXT_FILE_26, TEXT_FILE_27,
        TEXT_FILE_28, TEXT_FILE_29, TEXT_FILE_30, TEXT_FILE_31
    );

    int visibleCount = min(NUM_FILES, 10);
    int scrollOffset = max(0, min(selected - 4, NUM_FILES - visibleCount));

    for (int r = 0; r < 10; r++) {
        int i = scrollOffset + r;
        if (i >= NUM_FILES) break;

        float yPos = 210.0 + float(r * 46);
        float itemBox = fill(box(p, vec2(960, yPos + 18), vec2(800, 40), 8));
        vec3 itemColor = (i == selected) ? vec3(.16, .38, .60) : vec3(.08, .15, .24);
        color = mix(color, itemColor, itemBox);

        if (i == selected) {
            float badge = fill(box(p, vec2(175, yPos + 18), vec2(12, 24), 5));
            color = mix(color, vec3(.20, .85, .95), badge);
        }
        if (c.game.y == 1u && uint(i) == c.game.z) {
            float transBadge = fill(box(p, vec2(1735, yPos + 18), vec2(12, 24), 5));
            color = mix(color, vec3(.40, .95, .50), transBadge);
        }
        color = mix(color, vec3(.90, .95, 1.0), text(p, vec2(195, yPos + 7), fileTexts[i]));
    }

    // Predecoded video frames are RGB565 in the app data atlas. Frame timing
    // follows the compute shader's monotonic 60 Hz clock; X stops playback.
    if (c.game.y == 1u && c.game.z < uint(NUM_FILES)) {
        ivec3 video = VIDEO_META[int(c.game.z)];
        if (video.y > 0) {
            vec2 videoPos = p - vec2(960.0, 480.0);
            if (abs(videoPos.x) <= 480.0 && abs(videoPos.y) <= 270.0) {
                vec2 uv = (videoPos + vec2(480.0, 270.0)) / vec2(960.0, 540.0);
                ivec2 pixel = clamp(ivec2(uv * vec2(160.0, 90.0)), ivec2(0), ivec2(159, 89));
                uint frame = uint(c.motion.x * float(video.z)) % uint(video.y);
                uint byteIndex = uint(video.x) + (frame * 160u * 90u + uint(pixel.y * 160 + pixel.x)) * 2u;
                uint packed = (c.atlas[byteIndex >> 2u] >> ((byteIndex & 2u) * 8u)) & 65535u;
                vec3 rgb = vec3(float((packed >> 11u) & 31u) / 31.0,
                                float((packed >> 5u) & 63u) / 63.0,
                                float(packed & 31u) / 31.0);
                color = rgb;
            }
        }
    }

    // Status Panel
    float statusPanel = fill(box(p, vec2(960, 780), vec2(800, 44), 10));
    color = mix(color, vec3(.05, .10, .16), statusPanel);
    if (c.game.y == 1u) {
        color = mix(color, vec3(.60, .95, .60), text(p, vec2(960 - TEXT_STATUS_SELECTED.z / 2.0, 772), TEXT_STATUS_SELECTED));
    } else {
        color = mix(color, vec3(.80, .90, .95), text(p, vec2(960 - TEXT_STATUS_READY.z / 2.0, 772), TEXT_STATUS_READY));
    }

    // Controls Footer
    float ctrlPanel = fill(box(p, vec2(960, 840), vec2(800, 40), 10));
    color = mix(color, vec3(.05, .09, .14), ctrlPanel);
    color = mix(color, vec3(.75, .82, .90), text(p, vec2(960 - TEXT_CONTROLS.z / 2.0, 832), TEXT_CONTROLS));

    outColor = vec4(color * (1.0 - c.transition.x), 1);
}
