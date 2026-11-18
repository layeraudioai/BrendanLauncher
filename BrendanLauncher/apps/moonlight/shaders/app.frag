#version 450
// Moonlight for BrendanLauncher, ABI-1 GPU app, presentation pass.
//
// The console contributes no code: this shader reads the shared 8 MiB storage
// buffer, where the PC bridge has already published three things:
//   * a 1024x576 R8 "band" holding every dynamic string (host names, game
//     titles, pairing PIN, stream statistics), pre-rasterised on the PC,
//   * an item table (screen-space rectangles) describing what the band text
//     belongs to, so selection highlights need no string knowledge here,
//   * up to two RGB565 1280x720 frames in the video slots, written by the
//     bridge from the Sunshine RTP stream.
#extension GL_GOOGLE_include_directive : require
layout(location=0) out vec4 outColor;
#define STATE_ACCESS readonly
#include "abi.glsl"
#include "text.glsl"
#include "draw.glsl"

uint hdrWord(uint index) { return c.atlas[HDR_WORD + index]; }

// 8-bit alpha sample from the host-rendered text band (band space).
float bandAt(vec2 p) {
    ivec2 q = ivec2(floor(p / BAND_SCALE));
    if (q.x < 0 || q.y < 0 || q.x >= int(BAND_WIDTH) || q.y >= int(BAND_HEIGHT)) return 0.0;
    uint index = uint(q.y) * BAND_WIDTH + uint(q.x);
    uint word = c.atlas[BAND_WORD + (index >> 2u)];
    return float((word >> ((index & 3u) * 8u)) & 255u) / 255.0;
}

// Picture rectangle for the current stream resolution, centred on 1920x1080.
vec4 videoRect() {
    float scale = min(1920.0 / float(VIDEO_WIDTH), 1080.0 / float(VIDEO_HEIGHT));
    vec2 size = vec2(float(VIDEO_WIDTH), float(VIDEO_HEIGHT)) * scale;
    return vec4(vec2(960.0, 540.0) - size * 0.5, size);
}

// RGB565 little-endian sample from the current video slot.
vec3 videoAt(vec2 p) {
    vec4 rect = videoRect();
    vec2 uv = clamp((p - rect.xy) / rect.zw, vec2(0.0), vec2(1.0));
    ivec2 q = clamp(ivec2(uv * vec2(float(VIDEO_WIDTH), float(VIDEO_HEIGHT))),
                    ivec2(0), ivec2(int(VIDEO_WIDTH) - 1, int(VIDEO_HEIGHT) - 1));
    uint slot = hdrWord(H_FRAME_SLOT) % uint(VIDEO_SLOTS);
    uint pixel = uint(q.y) * VIDEO_WIDTH + uint(q.x);
    uint word = c.atlas[VIDEO_WORD + slot * VIDEO_STRIDE + (pixel >> 1u)];
    uint packed = (word >> ((pixel & 1u) * 16u)) & 0xffffu;
    return vec3(float((packed >> 11u) & 31u) / 31.0,
                float((packed >> 5u) & 63u) / 63.0,
                float(packed & 31u) / 31.0);
}

vec4 itemRect(uint index) {
    uint base = H_ITEMS_BASE + index * 5u;
    return vec4(float(hdrWord(base)), float(hdrWord(base + 1u)),
                float(hdrWord(base + 2u)), float(hdrWord(base + 3u)));
}

void main() {
    vec2 p = gl_FragCoord.xy;
    uint flags = hdrWord(H_FLAGS);
    bool streaming = (flags & FLAG_VIDEO) != 0u && (flags & FLAG_STREAMING) != 0u;

    vec3 color = mix(vec3(.024, .043, .086), vec3(.020, .106, .180), p.y / 1080.0);

    if (streaming) {
        vec4 rect = videoRect();
        vec2 q = abs(p - vec2(960.0, 540.0)) - rect.zw * 0.5;
        float inside = 1.0 - fill(max(q.x, q.y));
        color = mix(vec3(.008, .016, .031), videoAt(p), inside);
        if ((flags & FLAG_BUSY) != 0u) {
            color = mix(color, vec3(.05, .08, .12), 0.35);
        }
    } else {
        // Content panel; the band supplies all text and iconography.
        float panel = fill(box(p, vec2(960, 545), vec2(880, 470), 26));
        color = mix(color, vec3(.043, .082, .133), panel);
        float header = fill(box(p, vec2(960, 96), vec2(880, 58), 18));
        color = mix(color, vec3(.071, .157, .271), header);
        color = mix(color, vec3(.93, .96, 1.0), text(p, vec2(88, 74), TEXT_BRAND));
        color = mix(color, vec3(.55, .76, .90), text(p, vec2(92, 116), TEXT_TAGLINE));

        // Host-rendered text band covers the whole canvas at 1/1.875 scale.
        color = mix(color, vec3(.90, .95, 1.0), bandAt(p) * 0.96);

        // Selection and item badges come from the item table only.
        uint count = min(hdrWord(H_ITEMS), 32u);
        uint selected = hdrWord(H_SELECTED);
        for (uint i = 0u; i < count; i++) {
            vec4 r = itemRect(i);
            if (r.z <= 0.0 || r.w <= 0.0) continue;
            vec2 center = r.xy + r.zw * 0.5;
            bool focused = i == selected;
            float pill = fill(box(p, center, r.zw * 0.5, 10));
            color = mix(color, focused ? vec3(.11, .27, .47) : vec3(.055, .106, .172), pill * 0.9);
            if (focused) {
                float badge = fill(box(p, vec2(r.x + 10.0, center.y), vec2(6, r.w * 0.30), 4));
                color = mix(color, vec3(.20, .85, .95), badge);
            }
        }

        // Footer: static hints plus the live stream statistics line from the band.
        float statBar = fill(box(p, vec2(960, 1016), vec2(880, 24), 10));
        color = mix(color, vec3(.035, .071, .118), statBar);
        color = mix(color, vec3(.50, .72, .86), text(p, vec2(92, 1004), TEXT_HINT_NAV));
        color = mix(color, vec3(.44, .66, .80), text(p, vec2(560, 1004), TEXT_BADGE_LIVE));
    }

    // Entry fade: the compute pass counts transition.x down from 1.
    color *= 1.0 - clamp(c.transition.x, 0.0, 1.0);
    outColor = vec4(color, 1.0);
}
