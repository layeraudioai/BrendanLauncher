#version 450
#extension GL_GOOGLE_include_directive : require
layout(location=0) out vec4 outColor;
#define STATE_ACCESS readonly
#include "abi.glsl"
#include "text.glsl"
#include "draw.glsl"
void main(){
 vec2 p=gl_FragCoord.xy;
 vec3 color=mix(vec3(.05,.12,.22),vec3(.08,.28,.40),p.y/1080.0);
 float panel=fill(box(p,vec2(960,540),vec2(760,340),32));
 color=mix(color,vec3(.10,.20,.32),panel);
 color=mix(color,vec3(.90,.95,1.0),text(p,vec2(960-TEXT_TITLE.z/2,410),TEXT_TITLE));
 color=mix(color,vec3(.70,.85,.95),text(p,vec2(960-TEXT_SUBTITLE.z/2,510),TEXT_SUBTITLE));
 color=mix(color,vec3(.20,1.0,.80),text(p,vec2(960-TEXT_STATUS.z/2,590),TEXT_STATUS));
 color=mix(color,vec3(.60,.70,.80),text(p,vec2(960-TEXT_RETURN.z/2,670),TEXT_RETURN));
 outColor=vec4(color*(1.0-c.transition.x),1);
}
