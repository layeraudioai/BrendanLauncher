'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Abi1Preview = api;
})(globalThis, function () {
  const BUTTONS = {
    A: 1, B: 2, X: 4, Y: 8, L: 64, R: 128,
    PLUS: 1024, MINUS: 2048,
    LEFT: 4096, UP: 8192, RIGHT: 16384, DOWN: 32768
  };
  const KEY_BUTTONS = new Map([
    ['Space', BUTTONS.A], ['KeyX', BUTTONS.B], ['KeyZ', BUTTONS.X],
    ['KeyC', BUTTONS.Y], ['ShiftLeft', BUTTONS.L], ['ShiftRight', BUTTONS.R],
    ['Enter', BUTTONS.PLUS], ['Escape', BUTTONS.MINUS],
    ['ArrowLeft', BUTTONS.LEFT], ['ArrowUp', BUTTONS.UP],
    ['ArrowRight', BUTTONS.RIGHT], ['ArrowDown', BUTTONS.DOWN]
  ]);
  const GAMEPAD_BUTTONS = [
    [0, BUTTONS.A], [1, BUTTONS.B], [2, BUTTONS.X], [3, BUTTONS.Y],
    [4, BUTTONS.L], [5, BUTTONS.R], [8, BUTTONS.MINUS], [9, BUTTONS.PLUS],
    [12, BUTTONS.UP], [13, BUTTONS.DOWN], [14, BUTTONS.LEFT], [15, BUTTONS.RIGHT]
  ];
  const FEEDBACK_STRIDE = 32;
  const TRANSFORM_STRIDE = 16;
  const RECORD_WORDS = 20;

  class Abi1PreviewRuntime {
    constructor({ model, builder, canvas, onExit = () => {} }) {
      if (!model || !builder || !canvas) throw new Error('Preview runtime requires a model, builder, and canvas');
      this.model = model;
      this.builder = builder;
      this.canvas = canvas;
      this.onExit = onExit;
      this.gl = null;
      this.programs = [];
      this.shaders = [];
      this.textures = [];
      this.buffers = [];
      this.vertexArrays = [];
      this.transformFeedback = null;
      this.audioContext = null;
      this.audioBuffers = new Map();
      this.audioSources = new Set();
      this.running = false;
      this.frameRequest = 0;
      this.lastFrameTime = 0;
      this.accumulator = 0;
      this.keyboardButtons = 0;
      this.previousButtons = 0;
      this.currentBuffer = 0;
      this.keyDownHandler = event => this.handleKeyDown(event);
      this.keyUpHandler = event => this.handleKeyUp(event);
      this.blurHandler = () => { this.keyboardButtons = 0; };
    }

    async start(projectValue) {
      this.stop();
      this.project = this.model.normalizeProject(JSON.parse(JSON.stringify(projectValue)));
      this.projectObjectCount = this.model.flattenObjects(this.project).length;
      this.sceneCount = this.project.scenes.length * this.model.OBJECT_CAPACITY;
      this.activeSceneId = this.project.startupSceneId;
      if (!this.projectObjectCount) throw new Error('Add at least one object before previewing');
      this.frameIndex = 0;

      this.canvas.width = 960;
      this.canvas.height = 540;
      this.gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false });
      if (!this.gl) throw new Error('PC Preview requires a browser with WebGL 2 support');

      try {
        const sceneData = this.model.toPreviewSceneData(this.project);
        this.createSceneTexture(sceneData);
        this.createPrograms();
        this.createTransformBuffers(sceneData);
        this.createTransformTexture(sceneData);
        this.createAudioContext();
        window.addEventListener('keydown', this.keyDownHandler);
        window.addEventListener('keyup', this.keyUpHandler);
        window.addEventListener('blur', this.blurHandler);
        if (this.audioContext) this.audioContext.resume().catch(error =>
          console.warn('PC Preview audio could not start:', error.message));
        this.running = true;
        this.lastFrameTime = performance.now();
        this.draw();
        this.frameRequest = requestAnimationFrame(time => this.frame(time));
      } catch (error) {
        this.stop();
        throw error;
      }
    }

    stop() {
      this.running = false;
      if (this.frameRequest) cancelAnimationFrame(this.frameRequest);
      this.frameRequest = 0;
      window.removeEventListener('keydown', this.keyDownHandler);
      window.removeEventListener('keyup', this.keyUpHandler);
      window.removeEventListener('blur', this.blurHandler);
      for (const source of this.audioSources) {
        try { source.stop(); } catch {}
      }
      this.audioSources.clear();
      if (this.audioContext) {
        this.audioContext.close().catch(error =>
          console.warn('PC Preview audio context could not close:', error.message));
      }
      this.audioContext = null;
      if (this.gl) {
        for (const program of this.programs) this.gl.deleteProgram(program);
        for (const shader of this.shaders) this.gl.deleteShader(shader);
        for (const texture of this.textures) this.gl.deleteTexture(texture);
        for (const buffer of this.buffers) this.gl.deleteBuffer(buffer);
        for (const vertexArray of this.vertexArrays) this.gl.deleteVertexArray(vertexArray);
        if (this.transformFeedback) this.gl.deleteTransformFeedback(this.transformFeedback);
      }
      this.programs = [];
      this.shaders = [];
      this.textures = [];
      this.buffers = [];
      this.vertexArrays = [];
      this.transformFeedback = null;
      this.gl = null;
      this.audioBuffers.clear();
      this.previousButtons = 0;
      this.keyboardButtons = 0;
    }

    createSceneTexture(sceneData) {
      const gl = this.gl;
      const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const wordCount = Math.ceil(sceneData.byteLength / 4);
      const texelCount = Math.ceil(wordCount / 4);
      const width = Math.min(maxSize, Math.max(1, Math.ceil(Math.sqrt(texelCount))));
      const height = Math.ceil(texelCount / width);
      if (height > maxSize) throw new Error('Scene data exceeds the PC preview texture limit');
      const words = new Uint32Array(width * height * 4);
      const view = new DataView(sceneData.buffer, sceneData.byteOffset, sceneData.byteLength);
      for (let i = 0; i < wordCount; i++) words[i] = view.getUint32(i * 4, true);

      this.sceneData = sceneData;
      this.sceneTextureWidth = width;
      this.sceneTextureHeight = height;
      this.sceneTexture = gl.createTexture();
      this.textures.push(this.sceneTexture);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, width, height, 0,
        gl.RGBA_INTEGER, gl.UNSIGNED_INT, words);
    }

    updateSceneTexture() {
      const gl = this.gl;
      const wordCount = Math.ceil(this.sceneData.byteLength / 4);
      const words = new Uint32Array(this.sceneTextureWidth * this.sceneTextureHeight * 4);
      const view = new DataView(this.sceneData.buffer, this.sceneData.byteOffset, this.sceneData.byteLength);
      for (let i = 0; i < wordCount; i++) words[i] = view.getUint32(i * 4, true);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.sceneTextureWidth, this.sceneTextureHeight,
        gl.RGBA_INTEGER, gl.UNSIGNED_INT, words);
    }

    createPrograms() {
      this.updateProgram = this.linkProgram(this.updateVertexSource(), this.updateFragmentSource(), [
        'vPosition', 'vRotation', 'vScale', 'vColor', 'vSound', 'vExit',
        'vSceneId', 'vSceneRequest', 'vObjectIndex', 'vSpawnShape',
        'vSpawnPosition', 'vSpawnScale', 'vSpawnColor', 'vSpawnOrigin',
        'vSpawnOnce', 'vSpawned', 'vAudioEvent'
      ]);
      this.renderProgram = this.linkProgram(this.fullscreenVertexSource(),
        this.previewFragmentSource(), null);
      const gl = this.gl;
      this.updateLocations = {
        buttons: gl.getUniformLocation(this.updateProgram, 'uButtons'),
        previousButtons: gl.getUniformLocation(this.updateProgram, 'uPreviousButtons'),
        sceneId: gl.getUniformLocation(this.updateProgram, 'uSceneId'),
        frameIndex: gl.getUniformLocation(this.updateProgram, 'uFrameIndex'),
        position: gl.getAttribLocation(this.updateProgram, 'aPosition'),
        rotation: gl.getAttribLocation(this.updateProgram, 'aRotation'),
        scale: gl.getAttribLocation(this.updateProgram, 'aScale'),
        color: gl.getAttribLocation(this.updateProgram, 'aColor'),
        objectSceneId: gl.getAttribLocation(this.updateProgram, 'aSceneId'),
        objectIndex: gl.getAttribLocation(this.updateProgram, 'aObjectIndex'),
        spawned: gl.getAttribLocation(this.updateProgram, 'aSpawned'),
        audioEvent: gl.getAttribLocation(this.updateProgram, 'aAudioEvent')
      };
      this.renderLocations = {
        sceneData: gl.getUniformLocation(this.renderProgram, 'uSceneData'),
        sceneWidth: gl.getUniformLocation(this.renderProgram, 'uSceneWidth'),
        transforms: gl.getUniformLocation(this.renderProgram, 'uTransforms'),
        resolution: gl.getUniformLocation(this.renderProgram, 'uResolution'),
        sceneId: gl.getUniformLocation(this.renderProgram, 'uSceneId'),
        maxTravel: gl.getUniformLocation(this.renderProgram, 'uMaxTravel'),
        transition: gl.getUniformLocation(this.renderProgram, 'uTransition')
      };
      for (const [location, label] of [
        [this.updateLocations.buttons, 'preview input'],
        [this.updateLocations.previousButtons, 'previous preview input'],
        [this.updateLocations.sceneId, 'active scene'],
        [this.renderLocations.sceneData, 'scene data'],
        [this.renderLocations.sceneWidth, 'scene texture width'],
        [this.renderLocations.transforms, 'scene transforms'],
        [this.renderLocations.resolution, 'preview resolution'],
        [this.renderLocations.sceneId, 'active scene'],
        [this.renderLocations.maxTravel, 'preview ray distance'],
        [this.renderLocations.transition, 'scene transition']
      ]) if (location === null) throw new Error(`PC Preview shader is missing its ${label} uniform`);
      for (const [location, label] of [
        [this.updateLocations.position, 'position'],
        [this.updateLocations.rotation, 'rotation'],
        [this.updateLocations.scale, 'scale'],
        [this.updateLocations.color, 'color'],
        [this.updateLocations.objectSceneId, 'object scene'],
        [this.updateLocations.objectIndex, 'object index'],
        [this.updateLocations.spawned, 'spawn marker'],
        [this.updateLocations.audioEvent, 'object audio event']
      ]) if (location < 0) throw new Error(`PC Preview shader is missing its ${label} attribute`);
    }

    linkProgram(vertexSource, fragmentSource, varyings) {
      const gl = this.gl;
      const vertex = this.compileShader(gl.VERTEX_SHADER, vertexSource);
      const fragment = fragmentSource ? this.compileShader(gl.FRAGMENT_SHADER, fragmentSource) : null;
      const program = gl.createProgram();
      gl.attachShader(program, vertex);
      if (fragment) gl.attachShader(program, fragment);
      if (varyings)
        gl.transformFeedbackVaryings(program, varyings, gl.INTERLEAVED_ATTRIBS);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const detail = gl.getProgramInfoLog(program) || 'unknown link error';
        gl.deleteProgram(program);
        throw new Error(`PC Preview shader link failed: ${detail}`);
      }
      this.programs.push(program);
      return program;
    }

    compileShader(type, source) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const detail = gl.getShaderInfoLog(shader) || 'unknown compiler error';
        gl.deleteShader(shader);
        throw new Error(`PC Preview shader compile failed: ${detail}`);
      }
      this.shaders.push(shader);
      return shader;
    }

    updateVertexSource() {
      const compute = this.builder.shaderSources(this.project).compute;
      const start = compute.indexOf('void updateObject(');
      const end = compute.indexOf('\nvoid main()', start);
      if (start < 0 || end < 0) throw new Error('Could not extract the ABI-1 object update script');
      const updateObject = compute.slice(start, end);
      const audioCases = this.model.flattenObjects(this.project)
        .map(({ object }, index) => object.kind === 'audio' && object.audioEventId
          ? `if(objectIndex==${index}u)hbSound(${object.audioEventId}u);` : '')
        .join('');
      const audioObjectGuard = this.model.flattenObjects(this.project)
        .map(({ object }, index) => object.kind === 'audio' ? `objectIndex==${index}u` : '')
        .filter(Boolean).join('||') || 'false';
      return `#version 300 es
precision highp float;
precision highp int;
in vec3 aPosition;
in vec3 aRotation;
in vec3 aScale;
in vec4 aColor;
in float aSceneId;
in float aObjectIndex;
in float aSpawned;
in float aAudioEvent;
uniform uint uButtons;
uniform uint uPreviousButtons;
uniform uint uSceneId;
uniform uint uFrameIndex;
out vec3 vPosition;
out vec3 vRotation;
out vec3 vScale;
out vec4 vColor;
out float vSound;
out float vExit;
out float vSceneId;
out float vSceneRequest;
out float vObjectIndex;
out float vSpawnShape;
out vec3 vSpawnPosition;
out vec3 vSpawnScale;
out vec3 vSpawnColor;
out float vSpawnOrigin;
out float vSpawnOnce;
out float vSpawned;
out float vAudioEvent;
const uint HB_A=1u,HB_B=2u,HB_X=4u,HB_Y=8u,HB_L=64u,HB_R=128u;
const uint HB_PLUS=1024u,HB_MINUS=2048u;
const uint HB_LEFT=4096u,HB_UP=8192u,HB_RIGHT=16384u,HB_DOWN=32768u;
const uint HB_SHAPE_BOX=1u,HB_SHAPE_SPHERE=2u,HB_SHAPE_SPRITE=3u,HB_SHAPE_PLANE=4u;
float previewSound;
float previewExit;
uint previewScene;
uint previewSpawnShape;
vec3 previewSpawnPosition;
vec3 previewSpawnScale;
vec3 previewSpawnColor;
float previewSpawnOrigin;
float previewSpawnOnce;
float previewAudioEvent;
uint hbHash(uint value){
    value^=value>>16u;value*=0x7feb352du;value^=value>>15u;
    value*=0x846ca68bu;value^=value>>16u;return value;
}
float hbRandom(uint seed){return float(hbHash(seed^(uFrameIndex*0x9e3779b9u))>>8u)/16777215.0;}
float hbRandom(){return hbRandom(uint(aObjectIndex)+1u);}
float hbRandomRange(float minimum,float maximum,uint seed){return mix(minimum,maximum,hbRandom(seed));}
vec3 hbRandomColor(uint seed){return vec3(hbRandom(seed),hbRandom(seed+1u),hbRandom(seed+2u));}
uint hbButtons(){return uButtons;}
uint hbPressed(){return uButtons&~uPreviousButtons;}
bool hbConnected(){return true;}
void hbSound(uint id){previewSound=float(id);}
void hbStopSound(){hbSound(0u);}
void hbSwitchSound(uint id){previewSound=-float(id+1u);}
uint hbCurrentScene(){return uSceneId;}
void hbExit(){previewExit=1.0;}
bool hbStreamRequest(uint assetId,uint offset,uint length){return false;}
bool hbStreamReady(){return false;}
bool hbStreamFailed(){return false;}
uint hbStreamByte(uint index){return 0u;}
uint hbSpawnObject(uint shape,vec3 position,vec3 scale,vec3 color){
    if(shape<HB_SHAPE_BOX||shape>HB_SHAPE_PLANE||previewSpawnShape!=0u)return 0xffffffffu;
    previewSpawnShape=shape;
    previewSpawnPosition=position;
    previewSpawnScale=scale;
    previewSpawnColor=color;
    return 0u;
}
uint hbSpawnOnce(uint objectIndex,uint shape,vec3 position,vec3 scale,vec3 color){
    if(aSpawned>0.5)return 0xffffffffu;
    uint result=hbSpawnObject(shape,position,scale,color);
    if(result!=0xffffffffu){
        previewSpawnOnce=1.0;
        previewSpawnOrigin=float(objectIndex);
    }
    return result;
}
void hbPlayObjectAudio(uint objectIndex){
    if(aObjectIndex>=0.0&&objectIndex==uint(aObjectIndex)){
        uint eventId=uint(previewAudioEvent);
        if(eventId>0u)hbSound(eventId);
        return;
    }
    ${audioCases}
}
bool hbSetObjectAudio(uint objectIndex,uint eventId){
    if(eventId>31u||aObjectIndex<0.0||objectIndex!=uint(aObjectIndex)||
       !(${audioObjectGuard}))return false;
    previewAudioEvent=float(eventId);
    return true;
}
void hbLoadScene(uint id){${this.project.scenes.map(scene => `if(id==${scene.id}u)previewScene=id;`).join('')}}
${this.project.classes.map(item => item.source).filter(Boolean).join('\n')}
${updateObject}
void main(){
    uint objectIndex=uint(max(aObjectIndex,0.0));
    float dt=1.0/60.0;
    uint buttons=hbPressed();
    vec3 position=aPosition;
    vec3 rotation=aRotation;
    vec3 scale=aScale;
    vec4 color=aColor;
    previewSound=-1.0;
    previewExit=0.0;
    previewScene=uSceneId;
    previewSpawnShape=0u;
    previewSpawnPosition=vec3(0.0);
    previewSpawnScale=vec3(1.0);
    previewSpawnColor=vec3(1.0);
    previewSpawnOrigin=-1.0;
    previewSpawnOnce=0.0;
    previewAudioEvent=aAudioEvent;
    vSpawned=aSpawned;
    if(uint(aSceneId)==uSceneId&&aObjectIndex>=0.0)
        updateObject(position,rotation,scale,color,objectIndex,dt,buttons);
    vPosition=position;
    vRotation=rotation;
    vScale=scale;
    vColor=color;
    vSound=previewSound;
    vExit=previewExit;
    vSceneId=aSceneId;
    vSceneRequest=float(previewScene);
    vObjectIndex=aObjectIndex;
    vSpawnShape=float(previewSpawnShape);
    vSpawnPosition=previewSpawnPosition;
    vSpawnScale=previewSpawnScale;
    vSpawnColor=previewSpawnColor;
    vSpawnOrigin=previewSpawnOrigin;
    vSpawnOnce=previewSpawnOnce;
    vAudioEvent=previewAudioEvent;
    gl_Position=vec4(0.0,0.0,0.0,1.0);
}
`;
    }

    fullscreenVertexSource() {
      return `#version 300 es
void main(){
    vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);
    gl_Position=vec4(p*2.0-1.0,0.0,1.0);
}
`;
    }

    updateFragmentSource() {
      return `#version 300 es
precision highp float;
out vec4 outColor;
void main(){outColor=vec4(0.0);}
`;
    }

    previewFragmentSource() {
      let source = this.builder.shaderSources(this.project).fragment;
      const blockStart = source.indexOf('#define STATE_ACCESS readonly');
      const blockEnd = source.indexOf('} c;', blockStart);
      if (blockStart < 0 || blockEnd < 0)
        throw new Error('Could not adapt the ABI-1 scene data for PC Preview');
      const previewAbi = `uniform highp usampler2D uSceneData;
uniform int uSceneWidth;
uniform highp sampler2D uTransforms;
uniform vec2 uResolution;
uniform uint uSceneId;
uniform float uMaxTravel;
uniform float uTransition;
uint atlasWord(uint wordIndex){
    uint texelIndex=wordIndex>>2u;
    ivec2 coord=ivec2(int(texelIndex%uint(uSceneWidth)),int(texelIndex/uint(uSceneWidth)));
    uvec4 texel=texelFetch(uSceneData,coord,0);
    return texel[int(wordIndex&3u)];
}
`;
      source = source.slice(0, blockStart) + previewAbi + source.slice(blockEnd + 4);
      source = source
        .replace('#version 450', '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp usampler2D;\n')
        .replace(/^#extension GL_GOOGLE_include_directive : require\s*$/gm, '')
        .replace(/layout\(set=0,binding=1,std430\) readonly buffer ImageData \{ uint imageData\[\]; \} imageStore;/, '')
        .replace(/imageStore\.imageData\[([^\]]+)\]/g, 'atlasWord(uint($1))')
        .replace('layout(location=0) out vec4 outColor;', 'out vec4 outColor;')
        .replace(/c\.atlas\[([^\]]+)\]/g, 'atlasWord(uint($1))')
        .replace(/c\.reserved\.x/g, 'uSceneId')
        .replace(/c\.transition\.x/g, 'uTransition')
        .replace('if(travel>60.0)', 'if(travel>uMaxTravel)')
        .replace('vec2 screen=(gl_FragCoord.xy-vec2(960.0,540.0))/1080.0;',
          'vec2 screen=(gl_FragCoord.xy-uResolution*0.5)/uResolution.y;');
      const replacements = [
        [/^\s*vec3 position=.*;$/m, '    vec3 position=texelFetch(uTransforms,ivec2(int(i*4u),0),0).xyz;'],
        [/^\s*vec3 rotation=.*;$/m, '    vec3 rotation=texelFetch(uTransforms,ivec2(int(i*4u+1u),0),0).xyz;'],
        [/^\s*vec3 scale=.*;$/m, '    vec3 scale=max(abs(texelFetch(uTransforms,ivec2(int(i*4u+2u),0),0).xyz),vec3(.001));'],
        [/^\s*vec3 color=.*;$/m, '    vec3 color=texelFetch(uTransforms,ivec2(int(i*4u+3u),0),0).rgb;']
      ];
      for (const [pattern, replacement] of replacements) {
        const adapted = source.replace(pattern, replacement);
        if (adapted === source) throw new Error('PC Preview could not adapt an ABI-1 object transform');
        source = adapted;
      }
      return source;
    }

    createTransformBuffers(sceneData) {
      const gl = this.gl;
      const count = this.sceneCount;
      const view = new DataView(sceneData.buffer, sceneData.byteOffset, sceneData.byteLength);
      const initial = new Float32Array(count * FEEDBACK_STRIDE);
      this.objectSceneIds = new Uint32Array(count);
      this.staticObjectIndices = new Int32Array(count);
      this.staticObjectIndices.fill(-1);
      this.audioEventValues = new Uint32Array(count);
      for (const [sceneIndex, scene] of this.project.scenes.entries()) {
        const descriptor = (4 + sceneIndex * 4) * 4;
        const firstRecord = view.getUint32(descriptor + 12, true);
        for (let slot = 0; slot < this.model.OBJECT_CAPACITY; slot++) {
          const index = sceneIndex * this.model.OBJECT_CAPACITY + slot;
          const record = (firstRecord + slot * RECORD_WORDS) * 4;
          const offset = index * FEEDBACK_STRIDE;
          this.objectSceneIds[index] = scene.id;
          for (let axis = 0; axis < 3; axis++) {
            initial[offset + axis] = view.getFloat32(record + (5 + axis) * 4, true);
            initial[offset + 3 + axis] = view.getFloat32(record + (8 + axis) * 4, true);
            initial[offset + 6 + axis] = view.getFloat32(record + (11 + axis) * 4, true);
            initial[offset + 9 + axis] = view.getFloat32(record + (1 + axis) * 4, true);
          }
          initial[offset + 12] = 1;
          const objectIndex = view.getUint32(record + 15 * 4, true);
          initial[offset + 17] = objectIndex === 0xffffffff ? -1 : objectIndex;
          initial[offset + 30] = (view.getUint32(record + 19 * 4, true) & 0x80000000) ? 1 : 0;
          if (objectIndex !== 0xffffffff) this.staticObjectIndices[index] = objectIndex;
          const audioEvent = view.getUint32(record + 14 * 4, true);
          initial[offset + 31] = audioEvent;
          this.audioEventValues[index] = audioEvent;
          initial[offset + 15] = scene.id;
          initial[offset + 16] = scene.id;
        }
      }

      const locations = this.updateLocations;
      const stride = FEEDBACK_STRIDE * Float32Array.BYTES_PER_ELEMENT;
      for (let index = 0; index < 2; index++) {
        const buffer = gl.createBuffer();
        this.buffers.push(buffer);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        if (index === 0) gl.bufferData(gl.ARRAY_BUFFER, initial, gl.DYNAMIC_COPY);
        else gl.bufferData(gl.ARRAY_BUFFER, initial.byteLength, gl.DYNAMIC_COPY);
        const vertexArray = gl.createVertexArray();
        this.vertexArrays.push(vertexArray);
        gl.bindVertexArray(vertexArray);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        for (const [location, size, offset] of [
          [locations.position, 3, 0], [locations.rotation, 3, 3],
          [locations.scale, 3, 6], [locations.color, 4, 9],
          [locations.objectSceneId, 1, 15], [locations.objectIndex, 1, 17],
          [locations.spawned, 1, 30], [locations.audioEvent, 1, 31]
        ]) {
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride,
            offset * Float32Array.BYTES_PER_ELEMENT);
        }
      }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.transformFeedback = gl.createTransformFeedback();
    }

    createTransformTexture(sceneData) {
      const gl = this.gl;
      const view = new DataView(sceneData.buffer, sceneData.byteOffset, sceneData.byteLength);
      const values = new Float32Array(this.sceneCount * 16);
      for (const [sceneIndex] of this.project.scenes.entries()) {
        const descriptor = (4 + sceneIndex * 4) * 4;
        const firstRecord = view.getUint32(descriptor + 12, true);
        for (let slot = 0; slot < this.model.OBJECT_CAPACITY; slot++) {
          const index = sceneIndex * this.model.OBJECT_CAPACITY + slot;
          const record = (firstRecord + slot * RECORD_WORDS) * 4;
          const base = index * 16;
          for (let axis = 0; axis < 3; axis++) {
            values[base + axis] = view.getFloat32(record + (5 + axis) * 4, true);
            values[base + 4 + axis] = view.getFloat32(record + (8 + axis) * 4, true);
            values[base + 8 + axis] = view.getFloat32(record + (11 + axis) * 4, true);
            values[base + 12 + axis] = view.getFloat32(record + (1 + axis) * 4, true);
          }
          values[base + 3] = 1;
          values[base + 11] = 1;
          values[base + 15] = 1;
        }
      }
      this.transformValues = values;
      this.transformTexture = gl.createTexture();
      this.textures.push(this.transformTexture);
      gl.bindTexture(gl.TEXTURE_2D, this.transformTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.sceneCount * 4, 1, 0,
        gl.RGBA, gl.FLOAT, values);
    }

    createAudioContext() {
      const AudioContextType = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextType || !this.project.assets.some(asset => asset.kind === 'audio')) return;
      try { this.audioContext = new AudioContextType({ sampleRate: 48000 }); }
      catch (error) {
        console.warn('PC Preview audio is unavailable:', error.message);
      }
    }

    updateTransforms(buttons) {
      const gl = this.gl;
      const outputIndex = 1 - this.currentBuffer;
      gl.useProgram(this.updateProgram);
      gl.uniform1ui(this.updateLocations.buttons, buttons >>> 0);
      gl.uniform1ui(this.updateLocations.previousButtons, this.previousButtons >>> 0);
      gl.uniform1ui(this.updateLocations.sceneId, this.activeSceneId >>> 0);
      gl.uniform1ui(this.updateLocations.frameIndex, this.frameIndex++ >>> 0);
      gl.bindVertexArray(this.vertexArrays[this.currentBuffer]);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.transformFeedback);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.buffers[outputIndex]);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, this.sceneCount);
      gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD);

      const output = new Float32Array(this.sceneCount * FEEDBACK_STRIDE);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, this.buffers[outputIndex]);
      gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      gl.bindVertexArray(null);
      this.currentBuffer = outputIndex;
      let requestedScene = this.activeSceneId;
      let sceneDataChanged = false;
      for (let i = 0; i < this.sceneCount; i++) {
        const inputOffset = i * FEEDBACK_STRIDE, textureOffset = i * TRANSFORM_STRIDE;
        this.transformValues.set(output.subarray(inputOffset, inputOffset + 3), textureOffset);
        this.transformValues.set(output.subarray(inputOffset + 3, inputOffset + 6), textureOffset + 4);
        this.transformValues.set(output.subarray(inputOffset + 6, inputOffset + 9), textureOffset + 8);
        this.transformValues.set(output.subarray(inputOffset + 9, inputOffset + 13), textureOffset + 12);
        const soundSignal = Math.trunc(output[inputOffset + 13]);
        if (soundSignal === 0) this.playSound(0);
        else if (soundSignal < -1) {
          this.playSound(0);
          this.playSound(-soundSignal - 1);
        } else if (soundSignal > 0) this.playSound(soundSignal);
        if (output[inputOffset + 14] !== 0) return true;
        const sceneRequest = Math.trunc(output[inputOffset + 16]);
        if (sceneRequest !== this.activeSceneId &&
            this.project.scenes.some(scene => scene.id === sceneRequest))
          requestedScene = sceneRequest;
        const spawnShape = Math.trunc(output[inputOffset + 18]);
        if (spawnShape > 0) {
          const sceneId = Math.trunc(output[inputOffset + 16]);
          const spawnedIndex = this.recordSpawn(sceneId, spawnShape,
            output.subarray(inputOffset + 19, inputOffset + 22),
            output.subarray(inputOffset + 22, inputOffset + 25),
            output.subarray(inputOffset + 25, inputOffset + 28),
            output);
          if (spawnedIndex >= 0) {
            sceneDataChanged = true;
            if (output[inputOffset + 29] !== 0)
              this.markSpawnOnce(Math.trunc(output[inputOffset + 15]),
                output[inputOffset + 28], output);
          }
        }
        const audioEvent = Math.max(0, Math.trunc(output[inputOffset + 31]));
        if (audioEvent !== this.audioEventValues[i] && this.staticObjectIndices[i] >= 0) {
          this.writeObjectAudioEvent(this.objectSceneIds[i], this.staticObjectIndices[i], audioEvent);
          this.audioEventValues[i] = audioEvent;
          sceneDataChanged = true;
        }
      }
      this.activeSceneId = requestedScene;
      if (sceneDataChanged) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[outputIndex]);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, output);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        this.updateSceneTexture();
      }
      gl.bindTexture(gl.TEXTURE_2D, this.transformTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.sceneCount * 4, 1,
        gl.RGBA, gl.FLOAT, this.transformValues);
      this.previousButtons = buttons;
      return false;
    }

    recordSpawn(sceneId, shape, position, scale, color, output) {
      const sceneIndex = this.project.scenes.findIndex(scene => scene.id === sceneId);
      if (sceneIndex < 0 || shape > 4) return -1;
      const view = new DataView(this.sceneData.buffer, this.sceneData.byteOffset, this.sceneData.byteLength);
      const descriptor = (4 + sceneIndex * 4) * 4;
      const firstObject = view.getUint32(descriptor + 4, true);
      const objectCount = view.getUint32(descriptor + 8, true);
      const firstRecord = view.getUint32(descriptor + 12, true);
      let slot = -1;
      for (let candidate = 0; candidate < this.model.OBJECT_CAPACITY; candidate++) {
        const record = (firstRecord + candidate * RECORD_WORDS) * 4;
        if (view.getUint32(record, true) === 0 &&
            view.getUint32(record + 15 * 4, true) === 0xffffffff) {
          slot = candidate;
          break;
        }
      }
      if (slot < 0) return -1;
      if (slot >= objectCount) view.setUint32(descriptor + 8, slot + 1, true);

      const record = (firstRecord + slot * RECORD_WORDS) * 4;
      view.setUint32(record, shape, true);
      for (let axis = 0; axis < 3; axis++) {
        view.setFloat32(record + (1 + axis) * 4, Math.max(0, Math.min(1, color[axis])), true);
        view.setFloat32(record + (5 + axis) * 4, position[axis], true);
        view.setFloat32(record + (8 + axis) * 4, 0, true);
        view.setFloat32(record + (11 + axis) * 4, Math.max(0.001, Math.abs(scale[axis])), true);
      }
      view.setUint32(record + 4 * 4, 0, true);
      view.setUint32(record + 14 * 4, 0, true);
      view.setUint32(record + 15 * 4, 0xffffffff, true);
      view.setUint32(record + 16 * 4, 0, true);
      view.setUint32(record + 17 * 4, 0, true);
      view.setUint32(record + 18 * 4, 0, true);
      view.setUint32(record + 19 * 4, sceneId, true);

      const index = firstObject + slot;
      const offset = index * FEEDBACK_STRIDE;
      output[offset] = position[0];
      output[offset + 1] = position[1];
      output[offset + 2] = position[2];
      output[offset + 3] = output[offset + 4] = output[offset + 5] = 0;
      output[offset + 6] = Math.max(0.001, Math.abs(scale[0]));
      output[offset + 7] = Math.max(0.001, Math.abs(scale[1]));
      output[offset + 8] = Math.max(0.001, Math.abs(scale[2]));
      output[offset + 9] = color[0];
      output[offset + 10] = color[1];
      output[offset + 11] = color[2];
      output[offset + 12] = 1;
      output[offset + 15] = sceneId;
      output[offset + 16] = sceneId;
      output[offset + 17] = -1;
      output[offset + 30] = 0;
      output[offset + 31] = 0;
      this.objectSceneIds[index] = sceneId;
      this.staticObjectIndices[index] = -1;
      this.audioEventValues[index] = 0;
      return index;
    }

    writeObjectAudioEvent(sceneId, objectIndex, eventId) {
      const sceneIndex = this.project.scenes.findIndex(scene => scene.id === sceneId);
      if (sceneIndex < 0) return;
      const view = new DataView(this.sceneData.buffer, this.sceneData.byteOffset, this.sceneData.byteLength);
      const descriptor = (4 + sceneIndex * 4) * 4;
      const count = view.getUint32(descriptor + 8, true);
      const firstRecord = view.getUint32(descriptor + 12, true);
      for (let slot = 0; slot < count; slot++) {
        const record = (firstRecord + slot * RECORD_WORDS) * 4;
        if (view.getUint32(record + 15 * 4, true) === objectIndex &&
            view.getUint32(record, true) === 0) {
          view.setUint32(record + 14 * 4, eventId, true);
          return;
        }
      }
    }

    markSpawnOnce(sceneId, objectIndex, output) {
      const sceneIndex = this.project.scenes.findIndex(scene => scene.id === sceneId);
      if (sceneIndex < 0 || !Number.isInteger(objectIndex) || objectIndex < 0) return;
      const view = new DataView(this.sceneData.buffer, this.sceneData.byteOffset, this.sceneData.byteLength);
      const descriptor = (4 + sceneIndex * 4) * 4;
      const count = view.getUint32(descriptor + 8, true);
      const firstRecord = view.getUint32(descriptor + 12, true);
      for (let slot = 0; slot < count; slot++) {
        const record = (firstRecord + slot * RECORD_WORDS) * 4;
        if (view.getUint32(record + 15 * 4, true) === objectIndex) {
          const flags = view.getUint32(record + 19 * 4, true);
          view.setUint32(record + 19 * 4, flags | 0x80000000, true);
          const index = view.getUint32(descriptor + 4, true) + slot;
          output[index * FEEDBACK_STRIDE + 30] = 1;
          break;
        }
      }
    }

    draw() {
      const gl = this.gl;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0.025, 0.055, 0.09, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.renderProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.transformTexture);
      gl.uniform1i(this.renderLocations.transforms, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
      gl.uniform1i(this.renderLocations.sceneData, 1);
      gl.uniform1i(this.renderLocations.sceneWidth, this.sceneTextureWidth);
      gl.uniform2f(this.renderLocations.resolution, this.canvas.width, this.canvas.height);
      gl.uniform1ui(this.renderLocations.sceneId, this.activeSceneId >>> 0);
      gl.uniform1f(this.renderLocations.maxTravel, this.maxTravelDistance());
      gl.uniform1f(this.renderLocations.transition, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    maxTravelDistance() {
      let maxTravel = 60;
      for (let i = 0; i < this.sceneCount; i++) {
        const offset = i * 16;
        const x = this.transformValues[offset];
        const y = this.transformValues[offset + 1];
        const z = this.transformValues[offset + 2];
        const sx = this.transformValues[offset + 8];
        const sy = this.transformValues[offset + 9];
        const sz = this.transformValues[offset + 10];
        const centerDistance = Math.hypot(x, y, z - 9);
        const objectRadius = Math.hypot(sx, sy, sz);
        maxTravel = Math.max(maxTravel, centerDistance + objectRadius);
      }
      return maxTravel;
    }

    frame(time) {
      if (!this.running) return;
      this.accumulator += Math.min(0.25, Math.max(0, (time - this.lastFrameTime) / 1000));
      this.lastFrameTime = time;
      const fixedStep = 1 / 60;
      let steps = 0;
      while (this.accumulator >= fixedStep && steps < 5) {
        const exit = this.updateTransforms(this.readButtons());
        this.accumulator -= fixedStep;
        steps++;
        if (exit) {
          this.running = false;
          this.onExit();
          return;
        }
      }
      this.draw();
      this.frameRequest = requestAnimationFrame(next => this.frame(next));
    }

    readButtons() {
      let buttons = this.keyboardButtons;
      if (navigator.getGamepads) {
        for (const gamepad of navigator.getGamepads()) {
          if (!gamepad || !gamepad.connected) continue;
          for (const [index, bit] of GAMEPAD_BUTTONS)
            if (gamepad.buttons[index]?.pressed) buttons |= bit;
        }
      }
      return buttons >>> 0;
    }

    handleKeyDown(event) {
      const bit = KEY_BUTTONS.get(event.code);
      if (!bit) return;
      event.preventDefault();
      this.keyboardButtons |= bit;
    }

    handleKeyUp(event) {
      const bit = KEY_BUTTONS.get(event.code);
      if (!bit) return;
      event.preventDefault();
      this.keyboardButtons &= ~bit;
    }

    playSound(eventId) {
      if (!this.audioContext) return;
      if (eventId === 0) {
        for (const source of this.audioSources) {
          try { source.stop(); } catch {}
        }
        this.audioSources.clear();
        return;
      }
      const audioAssets = this.project.assets.filter(asset => asset.kind === 'audio');
      const asset = audioAssets.find((item, index) => (item.eventId || index + 1) === eventId);
      if (!asset) return;
      let buffer = this.audioBuffers.get(eventId);
      if (!buffer) {
        const bytes = this.decodeBase64(asset.data);
        if (!bytes.length || bytes.length % 4) throw new Error(`Invalid preview audio data for ${asset.name}`);
        const frames = bytes.length / 4;
        buffer = this.audioContext.createBuffer(2, frames, 48000);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const left = new Float32Array(frames), right = new Float32Array(frames);
        for (let i = 0; i < frames; i++) {
          left[i] = view.getInt16(i * 4, true) / 32768;
          right[i] = view.getInt16(i * 4 + 2, true) / 32768;
        }
        buffer.copyToChannel(left, 0);
        buffer.copyToChannel(right, 1);
        this.audioBuffers.set(eventId, buffer);
      }
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);
      source.onended = () => this.audioSources.delete(source);
      this.audioSources.add(source);
      source.start();
    }

    decodeBase64(value) {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
  }

  return { Abi1PreviewRuntime };
});
