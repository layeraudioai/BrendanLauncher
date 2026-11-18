#version 450
// Fullscreen triangle. ABI-1 GPU apps draw exactly one triangle per frame; all
// layout work happens in the fragment shader from the shared storage buffer.
void main(){vec2 p=vec2((gl_VertexIndex<<1)&2,gl_VertexIndex&2);gl_Position=vec4(p*2.0-1.0,0,1);}
