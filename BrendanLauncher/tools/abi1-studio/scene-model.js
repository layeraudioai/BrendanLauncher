'use strict';
// Shared, browser-safe scene graph model for the editor and package builder.

(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.Abi1SceneModel = model;
})(globalThis, function () {
  const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
  const KIND_RE = /^(sprite|mesh|audio)$/;

  function createProject() {
    return {
      format: 'brendan-abi1-studio',
      version: 1,
      app: {
        id: 'my-gpu-app',
        name: 'My GPU App',
        description: 'Created with ABI-1 Studio',
        version: '1.0.0'
      },
      camera: { yaw: 0.68, pitch: 0.48, distance: 9 },
      assets: [],
      scripts: [],
      objects: []
    };
  }

  function createScript(name) {
    return { id: randomId(), name: name || 'New Script', source: '' };
  }

  function createObject(kind, name) {
    if (!KIND_RE.test(kind)) throw new Error(`Unsupported object kind: ${kind}`);
    return {
      id: randomId(),
      name: name || `New ${kind}`,
      kind,
      primitive: kind === 'mesh' ? 'box' : kind === 'sprite' ? 'plane' : 'emitter',
      parentId: null,
      transform: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
      color: kind === 'audio' ? '#e5b64b' : kind === 'sprite' ? '#48cbe0' : '#8097ff',
      audioEventId: kind === 'audio' ? 1 : 0,
      assetId: null,
      scriptIds: []
    };
  }

  function randomId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
      return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    return Math.random().toString(36).slice(2, 18).padEnd(16, '0');
  }

  function normalizeProject(value) {
    if (!value || value.format !== 'brendan-abi1-studio' || value.version !== 1)
      throw new Error('Unsupported or invalid ABI-1 Studio project');
    const project = {
      ...createProject(),
      ...value,
      app: { ...createProject().app, ...(value.app || {}) },
      camera: { ...createProject().camera, ...(value.camera || {}) },
      assets: Array.isArray(value.assets) ? value.assets : [],
      scripts: Array.isArray(value.scripts) ? value.scripts.map(script => ({ ...script })) : [],
      objects: Array.isArray(value.objects) ? value.objects.map(object => ({
        ...createObject(object.kind, object.name),
        ...object,
        transform: { ...createObject(object.kind, object.name).transform, ...(object.transform || {}) },
        scriptIds: Array.isArray(object.scriptIds) ? [...object.scriptIds] : []
      })) : []
    };
    for (const object of project.objects) {
      if (typeof object.script === 'string' && object.script.trim()) {
        const script = createScript(`${object.name} Script`);
        script.source = object.script;
        project.scripts.push(script);
        object.scriptIds.push(script.id);
      }
      delete object.script;
    }
    validateProject(project);
    return project;
  }

  function validateProject(project) {
    if (!project || project.format !== 'brendan-abi1-studio' || project.version !== 1)
      throw new Error('Invalid project format');
    if (!project.app || !ID_RE.test(project.app.id || ''))
      throw new Error('App ID must use lowercase letters, digits, and hyphens');
    if (typeof project.app.name !== 'string' || !project.app.name.trim() || project.app.name.length > 64)
      throw new Error('App name must be between 1 and 64 characters');
    if (typeof project.app.description !== 'string' || !project.app.description.trim() ||
        project.app.description.length > 160)
      throw new Error('App description must not exceed 160 characters');
    if (typeof project.app.version !== 'string' || project.app.version.length > 32)
      throw new Error('App version must be a string of at most 32 characters');
    if (!Array.isArray(project.objects) || project.objects.length > 48)
      throw new Error('A project can contain at most 48 objects');
    if (!Array.isArray(project.assets)) throw new Error('Project assets must be a list');
    if (!Array.isArray(project.scripts)) throw new Error('Project scripts must be a list');

    const scriptsById = new Map();
    for (const script of project.scripts) {
      if (!script || typeof script.id !== 'string' || !script.id || scriptsById.has(script.id))
        throw new Error('Script IDs must be unique non-empty strings');
      if (typeof script.name !== 'string' || !script.name.trim() || script.name.length > 64)
        throw new Error('Script names must be between 1 and 64 characters');
      if (typeof script.source !== 'string' || script.source.length > 8192)
        throw new Error(`Script ${script.name} exceeds the 8 KiB limit`);
      scriptsById.set(script.id, script);
    }
    const ids = new Set();
    for (const object of project.objects) {
      if (!object || typeof object.id !== 'string' || !object.id || ids.has(object.id))
        throw new Error('Object IDs must be unique non-empty strings');
      ids.add(object.id);
      if (!KIND_RE.test(object.kind)) throw new Error(`Invalid kind on object ${object.name}`);
      if (!object.transform || Object.values(object.transform).some(value => !Number.isFinite(value)))
        throw new Error(`Object ${object.name} has an invalid transform`);
      if (['sx', 'sy', 'sz'].some(key => Math.abs(object.transform[key]) < 0.001))
        throw new Error(`Object ${object.name} scale cannot be zero`);
      if (!/^#[0-9a-f]{6}$/i.test(object.color || ''))
        throw new Error(`Object ${object.name} has an invalid color`);
      if (object.kind === 'audio' && (!Number.isInteger(object.audioEventId) ||
          object.audioEventId < 1 || object.audioEventId > 31))
        throw new Error(`Audio object ${object.name} needs an event ID from 1 to 31`);
      if (!Array.isArray(object.scriptIds) || new Set(object.scriptIds).size !== object.scriptIds.length)
        throw new Error(`Object ${object.name} has an invalid or duplicate script attachment`);
      let attachedSourceLength = 0;
      for (const scriptId of object.scriptIds) {
        const script = scriptsById.get(scriptId);
        if (!script) throw new Error(`Object ${object.name} references a missing script`);
        attachedSourceLength += script.source.length;
      }
      if (attachedSourceLength > 8192)
        throw new Error(`Object ${object.name} attached scripts exceed the 8 KiB limit`);
    }

    const byId = new Map(project.objects.map(object => [object.id, object]));
    for (const object of project.objects) {
      if (object.parentId !== null && !byId.has(object.parentId))
        throw new Error(`Object ${object.name} references a missing parent`);
      const visited = new Set([object.id]);
      let parent = object.parentId;
      while (parent !== null) {
        if (visited.has(parent)) throw new Error('Object hierarchy contains a cycle');
        visited.add(parent);
        parent = byId.get(parent).parentId;
      }
    }

    const assetIds = new Set();
    const audioEvents = new Set();
    for (const asset of project.assets) {
      if (!asset || typeof asset.id !== 'string' || assetIds.has(asset.id))
        throw new Error('Asset IDs must be unique strings');
      assetIds.add(asset.id);
      if (typeof asset.data !== 'string') throw new Error(`Asset ${asset.name || ''} has no data`);
      if (asset.kind === 'audio' && asset.eventId !== undefined) {
        if (!Number.isInteger(asset.eventId) || asset.eventId < 1 || asset.eventId > 31 ||
            audioEvents.has(asset.eventId))
          throw new Error(`Audio asset ${asset.name || ''} has an invalid or duplicate event ID`);
        audioEvents.add(asset.eventId);
      }
    }
    for (const object of project.objects) {
      if (object.assetId && !assetIds.has(object.assetId))
        throw new Error(`Object ${object.name} references a missing asset`);
    }
    return true;
  }

  function quaternion(transform) {
    const rx = transform.rx * Math.PI / 360;
    const ry = transform.ry * Math.PI / 360;
    const rz = transform.rz * Math.PI / 360;
    const sx = Math.sin(rx), cx = Math.cos(rx);
    const sy = Math.sin(ry), cy = Math.cos(ry);
    const sz = Math.sin(rz), cz = Math.cos(rz);
    return [
      sx * cy * cz - cx * sy * sz,
      cx * sy * cz + sx * cy * sz,
      cx * cy * sz - sx * sy * cz,
      cx * cy * cz + sx * sy * sz
    ];
  }

  function multiplyQuaternion(a, b) {
    const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
    return [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz
    ];
  }

  function rotateVector(q, vector) {
    const [x, y, z, w] = q;
    const uv = [y * vector[2] - z * vector[1],
      z * vector[0] - x * vector[2], x * vector[1] - y * vector[0]];
    const uuv = [y * uv[2] - z * uv[1],
      z * uv[0] - x * uv[2], x * uv[1] - y * uv[0]];
    return vector.map((value, index) => value + 2 * (w * uv[index] + uuv[index]));
  }

  function worldDeltaToParentLocal(parentWorld, worldDelta) {
    if (!parentWorld) return [...worldDelta];
    const inverseRotation = [-parentWorld.rotation[0], -parentWorld.rotation[1],
      -parentWorld.rotation[2], parentWorld.rotation[3]];
    const unrotated = rotateVector(inverseRotation, worldDelta);
    return unrotated.map((value, index) => value / parentWorld.scale[index]);
  }

  function cameraPlaneDelta(camera, deltaX, deltaY, depth, width, height) {
    const focalLength = Math.min(width, height) * 0.44;
    if (!camera || ![camera.yaw, camera.pitch, deltaX, deltaY, depth, width, height]
      .every(Number.isFinite) || focalLength <= 0)
      throw new Error('Invalid camera drag parameters');
    const scale = Math.max(1.5, depth) / focalLength;
    const yaw = camera.yaw, pitch = camera.pitch;
    const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const up = [-Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch),
      -Math.sin(pitch) * Math.cos(yaw)];
    return right.map((value, index) =>
      (value * deltaX - up[index] * deltaY) * scale);
  }

  function eulerFromQuaternion(q) {
    const [x, y, z, w] = q;
    const sinr = 2 * (w * x + y * z), cosr = 1 - 2 * (x * x + y * y);
    const sinp = 2 * (w * y - z * x);
    const siny = 2 * (w * z + x * y), cosy = 1 - 2 * (y * y + z * z);
    return [
      Math.atan2(sinr, cosr) * 180 / Math.PI,
      Math.asin(Math.max(-1, Math.min(1, sinp))) * 180 / Math.PI,
      Math.atan2(siny, cosy) * 180 / Math.PI
    ];
  }

  function worldTransforms(project) {
    const objects = new Map(project.objects.map(object => [object.id, object]));
    const cache = new Map();
    function world(id) {
      if (cache.has(id)) return cache.get(id);
      const object = objects.get(id);
      const local = object.transform;
      if (!object.parentId) {
        const transform = {
          position: [local.x, local.y, local.z],
          rotation: quaternion(local),
          scale: [local.sx, local.sy, local.sz]
        };
        cache.set(id, transform);
        return transform;
      }
      const parent = world(object.parentId);
      const offset = rotateVector(parent.rotation,
        [local.x * parent.scale[0], local.y * parent.scale[1], local.z * parent.scale[2]]);
      const transform = {
        position: parent.position.map((value, index) => value + offset[index]),
        rotation: multiplyQuaternion(parent.rotation, quaternion(local)),
        scale: parent.scale.map((value, index) => value * [local.sx, local.sy, local.sz][index])
      };
      cache.set(id, transform);
      return transform;
    }
    for (const object of project.objects) world(object.id);
    return cache;
  }

  function cloneSubtree(project, objectId, { preserveIds = false } = {}) {
    const byId = new Map(project.objects.map(object => [object.id, object]));
    if (!byId.has(objectId)) throw new Error(`Unknown object: ${objectId}`);
    const included = new Set();
    const add = id => {
      included.add(id);
      for (const child of project.objects.filter(item => item.parentId === id)) add(child.id);
    };
    add(objectId);
    const idMap = new Map([...included].map(id => [id, preserveIds ? id : randomId()]));
    return project.objects.filter(object => included.has(object.id)).map(object => ({
      ...JSON.parse(JSON.stringify(object)),
      id: idMap.get(object.id),
      parentId: object.parentId && included.has(object.parentId) ? idMap.get(object.parentId) : null
    }));
  }

  function decodeBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function toSceneData(project) {
    validateProject(project);
    const worlds = worldTransforms(project);
    const visible = project.objects;
    const headerWords = 4;
    const recordWords = 20;
    const recordsEnd = (headerWords + visible.length * recordWords) * 4;
    const imageAssets = [];
    for (const object of visible) {
      const asset = project.assets.find(item => item.id === object.assetId && item.kind === 'image');
      if (asset) imageAssets.push({ object, asset });
    }
    const decoded = imageAssets.map(({ object, asset }) => {
      if (!Number.isInteger(asset.width) || !Number.isInteger(asset.height) ||
          !Number.isInteger(asset.rgbaBytes) || asset.rgbaBytes !== asset.width * asset.height * 4)
        throw new Error(`Image asset ${asset.name} is missing decoded RGBA pixels`);
      const bytes = decodeBase64(asset.data);
      if (bytes.length !== asset.rgbaBytes) throw new Error(`Image asset ${asset.name} has corrupt pixels`);
      return { object, asset, bytes };
    });
    const aligned = value => (value + 3) & ~3;
    let cursor = recordsEnd;
    const offsets = new Map();
    for (const item of decoded) {
      cursor = aligned(cursor);
      offsets.set(item.object.id, cursor / 4);
      cursor += item.bytes.length;
    }
    if (cursor > 7 * 1024 * 1024) throw new Error('Scene assets exceed the ABI-1 7 MiB data budget');

    const output = new Uint8Array(cursor);
    const view = new DataView(output.buffer);
    view.setUint32(0, visible.length, true);
    view.setUint32(4, recordWords, true);
    view.setUint32(8, headerWords, true);
    view.setUint32(12, 1, true);
    const recordIndex = new Map(visible.map((object, index) => [object.id, index]));
    visible.forEach((object, index) => {
      const at = (headerWords + index * recordWords) * 4;
      const world = worlds.get(object.id);
      const [rx, ry, rz] = eulerFromQuaternion(world.rotation).map(value => value * Math.PI / 180);
      const color = parseColor(object.color);
      const shape = object.kind === 'audio' ? 0 : object.kind === 'sprite' ? 3 :
        object.primitive === 'sphere' ? 2 : object.primitive === 'plane' ? 4 : 1;
      const values = [
        shape, ...color,
        ...world.position, rx, ry, rz, ...world.scale,
        object.audioEventId || 0, 1,
        offsets.get(object.id) || 0, 0, 0, 0
      ];
      values.forEach((value, field) => {
        if (field === 0 || field === 15 || field === 16 || field === 17 || field === 18 || field === 19)
          view.setUint32(at + field * 4, value >>> 0, true);
        else view.setFloat32(at + field * 4, value, true);
      });
      const asset = project.assets.find(item => item.id === object.assetId && item.kind === 'image');
      if (asset) {
        view.setUint32(at + 17 * 4, asset.width, true);
        view.setUint32(at + 18 * 4, asset.height, true);
      }
      if (object.parentId && recordIndex.has(object.parentId))
        view.setUint32(at + 19 * 4, recordIndex.get(object.parentId), true);
    });
    for (const item of decoded)
      output.set(item.bytes, offsets.get(item.object.id) * 4);
    return output;
  }

  function parseColor(color) {
    const value = Number.parseInt(color.slice(1), 16);
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, 1];
  }

  class Abi1SceneModel {}
  Object.assign(Abi1SceneModel, { createProject, createScript, createObject, normalizeProject, validateProject,
    worldTransforms, worldDeltaToParentLocal, cameraPlaneDelta, cloneSubtree, toSceneData, parseColor });
  return Abi1SceneModel;
});
