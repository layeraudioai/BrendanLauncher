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
      this.sceneCount = this.project.objects.length;
      if (!this.sceneCount) throw new Error('Add at least one object before previewing');

      this.canvas.width = 960;
      this.canvas.height = 540;
      this.gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false });
      if (!this.gl) throw new Error('PC Preview requires a browser with WebGL 2 support');

      try {
        const sceneData = this.model.toSceneData(this.project);
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

      this.sceneTextureWidth = width;
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

    createPrograms() {
      this.updateProgram = this.linkProgram(this.updateVertexSource(), this.updateFragmentSource(), [
        'vPosition', 'vRotation', 'vScale', 'vColor', 'vSound', 'vExit'
      ]);
      this.renderProgram = this.linkProgram(this.fullscreenVertexSource(),
        this.previewFragmentSource(), null);
      const gl = this.gl;
      this.updateLocations = {
        buttons: gl.getUniformLocation(this.updateProgram, 'uButtons'),
        previousButtons: gl.getUniformLocation(this.updateProgram, 'uPreviousButtons'),
        position: gl.getAttribLocation(this.updateProgram, 'aPosition'),
        rotation: gl.getAttribLocation(this.updateProgram, 'aRotation'),
        scale: gl.getAttribLocation(this.updateProgram, 'aScale'),
        color: gl.getAttribLocation(this.updateProgram, 'aColor')
      };
      this.renderLocations = {
        sceneData: gl.getUniformLocation(this.renderProgram, 'uSceneData'),
        sceneWidth: gl.getUniformLocation(this.renderProgram, 'uSceneWidth'),
        transforms: gl.getUniformLocation(this.renderProgram, 'uTransforms'),
        resolution: gl.getUniformLocation(this.renderProgram, 'uResolution'),
        transition: gl.getUniformLocation(this.renderProgram, 'uTransition')
      };
      for (const [location, label] of [
        [this.updateLocations.buttons, 'preview input'],
        [this.updateLocations.previousButtons, 'previous preview input'],
        [this.renderLocations.sceneData, 'scene data'],
        [this.renderLocations.sceneWidth, 'scene texture width'],
        [this.renderLocations.transforms, 'scene transforms'],
        [this.renderLocations.resolution, 'preview resolution'],
        [this.renderLocations.transition, 'scene transition']
      ]) if (location === null) throw new Error(`PC Preview shader is missing its ${label} uniform`);
      for (const [location, label] of [
        [this.updateLocations.position, 'position'],
        [this.updateLocations.rotation, 'rotation'],
        [this.updateLocations.scale, 'scale'],
        [this.updateLocations.color, 'color']
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
      return `#version 300 es
precision highp float;
precision highp int;
in vec3 aPosition;
in vec3 aRotation;
in vec3 aScale;
in vec4 aColor;
uniform uint uButtons;
uniform uint uPreviousButtons;
out vec3 vPosition;
out vec3 vRotation;
out vec3 vScale;
out vec4 vColor;
out float vSound;
out float vExit;
const uint HB_A=1u,HB_B=2u,HB_X=4u,HB_Y=8u,HB_L=64u,HB_R=128u;
const uint HB_PLUS=1024u,HB_MINUS=2048u;
const uint HB_LEFT=4096u,HB_UP=8192u,HB_RIGHT=16384u,HB_DOWN=32768u;
float previewSound;
float previewExit;
uint hbButtons(){return uButtons;}
uint hbPressed(){return uButtons&~uPreviousButtons;}
bool hbConnected(){return true;}
void hbSound(uint id){previewSound=float(id);}
void hbStopSound(){hbSound(0u);}
void hbExit(){previewExit=1.0;}
${updateObject}
void main(){
    uint objectIndex=uint(gl_VertexID);
    float dt=1.0/60.0;
    uint buttons=hbPressed();
    vec3 position=aPosition;
    vec3 rotation=aRotation;
    vec3 scale=aScale;
    vec4 color=aColor;
    previewSound=0.0;
    previewExit=0.0;
    updateObject(position,rotation,scale,color,objectIndex,dt,buttons);
    vPosition=position;
    vRotation=rotation;
    vScale=scale;
    vColor=color;
    vSound=previewSound;
    vExit=previewExit;
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
        .replace('layout(location=0) out vec4 outColor;', 'out vec4 outColor;')
        .replace(/c\.atlas\[([^\]]+)\]/g, 'atlasWord(uint($1))')
        .replace(/c\.transition\.x/g, 'uTransition')
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
      const initial = new Float32Array(count * 15);
      for (let i = 0; i < count; i++) {
        const record = (4 + i * 20) * 4;
        const offset = i * 15;
        for (let axis = 0; axis < 3; axis++) {
          initial[offset + axis] = view.getFloat32(record + (5 + axis) * 4, true);
          initial[offset + 3 + axis] = view.getFloat32(record + (8 + axis) * 4, true);
          initial[offset + 6 + axis] = view.getFloat32(record + (11 + axis) * 4, true);
        }
        for (let component = 0; component < 3; component++)
          initial[offset + 9 + component] = view.getFloat32(record + (1 + component) * 4, true);
        initial[offset + 12] = 1;
      }

      const locations = this.updateLocations;
      const stride = 15 * Float32Array.BYTES_PER_ELEMENT;
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
          [locations.scale, 3, 6], [locations.color, 4, 9]
        ]) {
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride,
            offset * Float32Array.BYTES_PER_ELEMENT);
        }
      }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.transformFeedback = gl.createTransformFeedback();
      this.buffers = this.buffers;
    }

    createTransformTexture(sceneData) {
      const gl = this.gl;
      const view = new DataView(sceneData.buffer, sceneData.byteOffset, sceneData.byteLength);
      const values = new Float32Array(this.sceneCount * 16);
      for (let i = 0; i < this.sceneCount; i++) {
        const record = (4 + i * 20) * 4;
        const base = i * 16;
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
      gl.bindVertexArray(this.vertexArrays[this.currentBuffer]);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.transformFeedback);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.buffers[outputIndex]);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, this.sceneCount);
      gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD);

      const output = new Float32Array(this.sceneCount * 15);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, this.buffers[outputIndex]);
      gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output);
      gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      gl.bindVertexArray(null);
      this.currentBuffer = outputIndex;
      for (let i = 0; i < this.sceneCount; i++) {
        const inputOffset = i * 15, textureOffset = i * 16;
        this.transformValues.set(output.subarray(inputOffset, inputOffset + 3), textureOffset);
        this.transformValues.set(output.subarray(inputOffset + 3, inputOffset + 6), textureOffset + 4);
        this.transformValues.set(output.subarray(inputOffset + 6, inputOffset + 9), textureOffset + 8);
        this.transformValues.set(output.subarray(inputOffset + 9, inputOffset + 13), textureOffset + 12);
        const soundId = Math.max(0, Math.trunc(output[inputOffset + 13]));
        if (soundId) this.playSound(soundId);
        if (output[inputOffset + 14] !== 0) return true;
      }
      gl.bindTexture(gl.TEXTURE_2D, this.transformTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.sceneCount * 4, 1,
        gl.RGBA, gl.FLOAT, this.transformValues);
      this.previousButtons = buttons;
      return false;
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
      gl.uniform1f(this.renderLocations.transition, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
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
