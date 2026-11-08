#version 450
#extension GL_GOOGLE_include_directive : require
layout(location=0) out vec4 outColor;
#define STATE_ACCESS readonly
#include "abi.glsl"
#include "text.glsl"
#include "draw.glsl"

void main(){
    vec2 p = gl_FragCoord.xy;
    vec3 color = mix(vec3(.06, .08, .14), vec3(.02, .05, .10), p.y / 1080.0);

    // Main Panel
    float panel = fill(box(p, vec2(960, 560), vec2(1600, 720), 24));
    color = mix(color, vec3(.08, .12, .20), panel);

    // Header Panel
    float header = fill(box(p, vec2(960, 110), vec2(1520, 70), 16));
    color = mix(color, vec3(.12, .18, .30), header);
    color = mix(color, vec3(.95, .98, 1.0), text(p, vec2(960 - TEXT_TITLE.z / 2.0, 92), TEXT_TITLE));
    color = mix(color, vec3(.60, .80, .95), text(p, vec2(960 - TEXT_SUBTITLE.z / 2.0, 130), TEXT_SUBTITLE));

    // Tab Bar (4 tabs)
    ivec4 tabTexts[4] = ivec4[4](TEXT_TAB_HOME, TEXT_TAB_BROWSER, TEXT_TAB_STORE, TEXT_TAB_TOOLS);
    int activeTab = int(c.game.y);
    float tabWidth = 360.0;
    float tabStartX = 340.0;

    for (int t = 0; t < 4; t++) {
        float tx = tabStartX + float(t) * (tabWidth + 20.0);
        float tbox = fill(box(p, vec2(tx + tabWidth / 2.0, 200), vec2(tabWidth, 48), 10));
        vec3 tcolor = (t == activeTab) ? vec3(.20, .45, .75) : vec3(.10, .16, .26);
        color = mix(color, tcolor, tbox);
        color = mix(color, vec3(.90, .95, 1.0), text(p, vec2(tx + tabWidth / 2.0 - float(tabTexts[t].z) / 2.0, 188), tabTexts[t]));
    }

    // Items List for Active Tab
    int selected = int(c.game.x);
    uint browserMode = c.game.z;
    
    for (int i = 0; i < 8; i++) {
        float yPos = 280.0 + float(i * 54);
        float itemBox = fill(box(p, vec2(960, yPos + 22), vec2(1520, 46), 8));
        
        bool isSelected = (i == selected);
        vec3 itemColor = isSelected ? vec3(.18, .38, .60) : vec3(.06, .10, .18);
        color = mix(color, itemColor, itemBox);

        if (isSelected) {
            float indicator = fill(box(p, vec2(215, yPos + 22), vec2(12, 28), 4));
            color = mix(color, vec3(.20, .90, 1.0), indicator);
        }

        if (activeTab == 0 && i < NUM_APPS) {
            ivec4 appTexts[5] = ivec4[5](TEXT_APP_0, TEXT_APP_1, TEXT_APP_2, TEXT_APP_3, TEXT_APP_4);
            color = mix(color, vec3(.90, .95, 1.0), text(p, vec2(245, yPos + 10), appTexts[i]));
        } else if (activeTab == 1) {
            if (browserMode == 0u && i < NUM_BROWSER_ROOT) {
                ivec4 browserRootTexts[5] = ivec4[5](TEXT_BROWSER_ROOT_0, TEXT_BROWSER_ROOT_1, TEXT_BROWSER_ROOT_2, TEXT_BROWSER_ROOT_3, TEXT_BROWSER_ROOT_4);
                color = mix(color, vec3(.90, .95, 1.0), text(p, vec2(245, yPos + 10), browserRootTexts[i]));
            } else if (browserMode == 1u && i < NUM_BROWSER_SUB) {
                ivec4 browserSubTexts[5] = ivec4[5](TEXT_BROWSER_SUB_0, TEXT_BROWSER_SUB_1, TEXT_BROWSER_SUB_2, TEXT_BROWSER_SUB_3, TEXT_BROWSER_SUB_4);
                color = mix(color, vec3(.90, .95, 1.0), text(p, vec2(245, yPos + 10), browserSubTexts[i]));
            }
        } else if (activeTab == 2 && i < NUM_STORE) {
            ivec4 storeTexts[4] = ivec4[4](TEXT_STORE_0, TEXT_STORE_1, TEXT_STORE_2, TEXT_STORE_3);
            color = mix(color, vec3(.90, .95, 1.0), text(p, vec2(245, yPos + 10), storeTexts[i]));
        } else if (activeTab == 3 && i < NUM_TOOLS) {
            ivec4 toolTexts[5] = ivec4[5](TEXT_TOOL_0, TEXT_TOOL_1, TEXT_TOOL_2, TEXT_TOOL_3, TEXT_TOOL_4);
            color = mix(color, vec3(.90, .95, 1.0), text(p, vec2(245, yPos + 10), toolTexts[i]));
        }
    }

    // Status Footer
    float statusPanel = fill(box(p, vec2(960, 775), vec2(1520, 44), 10));
    color = mix(color, vec3(.05, .09, .15), statusPanel);
    color = mix(color, vec3(.75, .90, 1.0), text(p, vec2(960 - TEXT_STATUS_READY.z / 2.0, 767), TEXT_STATUS_READY));

    // Controls Footer
    float ctrlPanel = fill(box(p, vec2(960, 840), vec2(1520, 40), 10));
    color = mix(color, vec3(.04, .07, .12), ctrlPanel);
    color = mix(color, vec3(.70, .80, .90), text(p, vec2(960 - TEXT_CONTROLS.z / 2.0, 832), TEXT_CONTROLS));

    outColor = vec4(color * (1.0 - c.transition.x), 1);
}
