'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Abi1ProjectGenerator = api;
})(globalThis, function () {
  const ENTITY = /\b(player|enemy|opponent|character|hero|npc|wall|floor|ground|platform|tree|rock|box|cube|sphere|ball|plane|sprite|image|light|camera|audio|sound|object)\b/i;
  const CREATE = /\b(create|add|make|build|place|put|include|spawn)\b/i;
  const BEHAVIOR = /\b(move|translate|slide|rotate|spin|scale|set\s+(?:the\s+)?(?:color|colour)|color\s+to|colour\s+to|oscillate|orbit|switch\s+(?:to\s+)?(?:the\s+)?(?:next|previous|random|scene)|play\s+(?:sound|audio)|stop\s+(?:sound|audio)|exit)\b/i;
  const COLORS = { red: '#ff3b4f', green: '#38d879', blue: '#4287ff', yellow: '#ffe34d', cyan: '#35d6e5', magenta: '#ec4be9', white: '#f2f5fa', black: '#20242a', orange: '#ff9d36', purple: '#a775ff' };
  const KINDS = [
    { re: /\b(audio|sound)\b/i, kind: 'audio', primitive: 'emitter' },
    { re: /\b(sprite|image|picture)\b/i, kind: 'sprite', primitive: 'plane' },
    { re: /\b(sphere|ball)\b/i, kind: 'mesh', primitive: 'sphere' },
    { re: /\b(plane|floor|ground)\b/i, kind: 'mesh', primitive: 'plane' },
    { re: /\b(box|cube|wall|platform|tree|rock|player|enemy|character|hero|npc|object)\b/i, kind: 'mesh', primitive: 'box' }
  ];
  const MAX_PROMPT_STEPS = 128;
  const PROPERTY_WORD = /\b(?:color|colour)\b/i;

  function splitPrompt(prompt) {
    const stages = [
      { name: 'newline', regex: /\r?\n+/ },
      { name: 'period', regex: /\.+/ },
      { name: 'comma', regex: /,+/ },
      { name: 'and', regex: /\band\b/i }
    ];
    let pieces = [{ text: String(prompt || '').trim(), by: 'prompt', path: [], part: 1, partCount: 1 }];
    for (const stage of stages) {
      const next = [];
      for (const piece of pieces) {
        const parts = piece.text.split(stage.regex).map(text => text.trim()).filter(Boolean);
        const didSplit = parts.length > 1;
        for (let index = 0; index < parts.length; index++) {
          next.push({
            text: parts[index].replace(/^[\s;]+|[\s;]+$/g, ''),
            by: didSplit ? stage.name : piece.by,
            path: didSplit ? [...piece.path, { delimiter: stage.name, part: index + 1, count: parts.length }] : piece.path,
            part: didSplit ? index + 1 : piece.part,
            partCount: didSplit ? parts.length : piece.partCount
          });
        }
      }
      pieces = next;
    }
    if (pieces.length > MAX_PROMPT_STEPS)
      throw new Error(`A prompt can contain at most ${MAX_PROMPT_STEPS} ordered steps.`);
    return pieces.map((piece, index) => ({ ...piece, order: index + 1 }));
  }

  function activeScene(project, sceneId) {
    return project?.scenes?.find(scene => scene.id === sceneId) || project?.scenes?.[0] || null;
  }

  function escaped(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function resolveReference(reference, project, sceneId, selectedId) {
    const scene = activeScene(project, sceneId);
    if (!scene) return null;
    const phrase = String(reference || '').trim().toLowerCase();
    if (phrase) {
      const byName = scene.objects
        .filter(object => object.name && new RegExp(`\\b${escaped(object.name)}\\b`, 'i').test(phrase))
        .sort((a, b) => b.name.length - a.name.length)[0];
      if (byName) return byName;
      const aliases = phrase.match(/\b(player|enemy|opponent|character|hero|npc|wall|floor|ground|platform|tree|rock|box|cube|sphere|ball|plane|sprite|image|light|camera|audio|sound|object)\b/gi) || [];
      for (const alias of aliases) {
        const candidate = scene.objects.find(object => {
          const name = object.name.toLowerCase();
          return name === alias.toLowerCase() || new RegExp(`\\b${escaped(alias)}\\b`, 'i').test(name) ||
            object.primitive === (alias.toLowerCase() === 'ball' ? 'sphere' : alias.toLowerCase());
        });
        if (candidate) return candidate;
      }
    }
    if (/\b(?:selected|current|this|it|them)\b/i.test(phrase) && selectedId)
      return scene.objects.find(object => object.id === selectedId) || null;
    return null;
  }

  function normalizeTarget(text) {
    return String(text || '').trim()
      .replace(/^(?:the|a|an)\s+/i, '')
      .replace(/(?:'s|’s)$/i, '')
      .replace(/\s+(?:object|color|colour|scale|position)$/i, '')
      .trim();
  }

  function parseModification(text) {
    let match;
    const colorNames = Object.keys(COLORS).join('|');
    match = text.match(new RegExp(`\\b(?:set|change|make|turn)\\s+(?:the\\s+)?(?:(.+?)\\s+)?(?:object\\s+)?colou?r\\s+(?:to|as)\\s+(${colorNames})\\b`, 'i'));
    if (match) return { action: 'color', target: normalizeTarget(match[1]), value: COLORS[match[2].toLowerCase()], label: `Set color to ${match[2].toLowerCase()}` };
    match = text.match(new RegExp(`^\\s*(?:make|turn)\\s+(?:the\\s+)?(.+?)\\s+(${colorNames})\\s*$`, 'i'));
    if (match && ENTITY.test(match[1]))
      return { action: 'color', target: normalizeTarget(match[1]), value: COLORS[match[2].toLowerCase()], label: `Set color to ${match[2].toLowerCase()}` };

    match = text.match(/^\s*rename\s+(?:the\s+)?(.+?)\s+to\s+["']?(.+?)["']?\s*$/i);
    if (match) return { action: 'rename', target: normalizeTarget(match[1]), value: match[2].trim().slice(0, 64), label: `Rename to ${match[2].trim()}` };

    match = text.match(/^\s*(?:set|change)\s+(?:the\s+)?(.+?)\s+(?:uniform\s+)?scale\s+(?:to|=)\s*(-?\d+(?:\.\d+)?)\s*$/i);
    if (match) {
      const value = Number(match[2]);
      if (Number.isFinite(value) && Math.abs(value) >= 0.01 && Math.abs(value) <= 100)
        return { action: 'scale', target: normalizeTarget(match[1]), value, label: `Set scale to ${value}` };
    }

    match = text.match(/^\s*(?:set|move|place)\s+(?:the\s+)?(.+?)\s+(?:position\s+)?([xyz])\s*(?:to|=)\s*(-?\d+(?:\.\d+)?)\s*$/i);
    if (match) {
      const value = Number(match[3]);
      if (Number.isFinite(value) && Math.abs(value) <= 10000)
        return { action: 'axis', target: normalizeTarget(match[1]), axis: match[2].toLowerCase(), value, label: `Set ${match[2].toUpperCase()} position to ${value}` };
    }

    match = text.match(/^\s*(?:change|turn|make)\s+(?:the\s+)?(.+?)\s+(?:into|to|as)\s+(?:a\s+|an\s+)?(sphere|ball|cube|box|plane|sprite)\s*$/i);
    if (match)
      return { action: 'primitive', target: normalizeTarget(match[1]), value: /sphere|ball/i.test(match[2]) ? 'sphere' : /plane/i.test(match[2]) ? 'plane' : /sprite/i.test(match[2]) ? 'sprite' : 'box', label: `Change primitive to ${match[2].toLowerCase()}` };

    match = text.match(/^\s*(?:delete|remove|destroy)\s+(?:the\s+)?(.+?)\s*$/i);
    if (match && ENTITY.test(match[1]))
      return { action: 'delete', target: normalizeTarget(match[1]), label: 'Delete object and its children' };
    return null;
  }

  function objectDescription(text) {
    const kindInfo = KINDS.find(item => item.re.test(text)) || KINDS[KINDS.length - 1];
    const color = Object.entries(COLORS).find(([name]) => new RegExp(`\\b${name}\\b`, 'i').test(text));
    const noun = text.match(/\b(player|enemy|opponent|character|hero|npc|wall|floor|ground|platform|tree|rock|box|cube|sphere|ball|plane|sprite|image|light|camera|audio|sound|object)\b/i);
    const name = noun ? `${noun[1][0].toUpperCase()}${noun[1].slice(1)}` : (kindInfo.kind === 'sprite' ? 'Sprite' : kindInfo.kind === 'audio' ? 'Audio' : 'Object');
    return { kind: kindInfo.kind, primitive: kindInfo.primitive, color: color?.[1] || null, name };
  }

  function describe(text, scriptGenerator, project, sceneId, selectedId) {
    const modification = parseModification(text);
    if (modification) {
      const target = resolveReference(modification.target || (selectedId ? 'selected' : text), project, sceneId, selectedId);
      const targetLabel = target?.name || modification.target || (selectedId ? 'selected object' : 'current object');
      const missing = !target;
      return {
        text, type: missing ? 'unsupported' : 'modify', operation: modification,
        targetId: target?.id || null,
        summary: missing ? `No matching object for ${targetLabel}: ${modification.label}` : `${modification.label} · ${targetLabel}`,
        error: missing ? `No object matches “${targetLabel}”. Add one first or adjust the target.` : ''
      };
    }

    const create = CREATE.test(text) && ENTITY.test(text);
    const behavior = BEHAVIOR.test(text) || PROPERTY_WORD.test(text);
    const isObject = ENTITY.test(text) && (create || !behavior);
    const details = objectDescription(text);
    let generatedScript = null;
    let error = '';
    if (behavior) {
      try { generatedScript = scriptGenerator.generateScript(text, project, sceneId); }
      catch (cause) { error = cause.message; }
    }
    if (isObject) {
      return {
        text, type: 'object', ...details, script: generatedScript, error,
        summary: `${details.kind === 'mesh' ? details.primitive : details.kind} object “${details.name}”${details.color ? ` · ${Object.keys(COLORS).find(name => COLORS[name] === details.color)} color` : ''}${generatedScript ? ` · ${generatedScript.name} behavior` : (behavior && error ? ` · behavior needs editing: ${error}` : '')}`
      };
    }
    if (generatedScript) {
      const target = resolveReference(text, project, sceneId, selectedId);
      const targetLabel = target?.name || 'selected / most recently added object';
      return { text, type: 'script', script: generatedScript, targetId: target?.id || null, summary: `Script “${generatedScript.name}” · ${targetLabel}` };
    }
    if (behavior || error)
      return { text, type: 'unsupported', summary: `Needs manual editing: ${error || 'Unsupported behavior'}`, error };
    return { text, type: 'note', summary: 'Kept as an ordered prompt note' };
  }

  function analyzePieces(pieces, scriptGenerator, model, project, sceneId, selectedId = null) {
    const source = project || model.createProject();
    const context = {
      ...source,
      scenes: source.scenes.map(scene => ({
        ...scene,
        objects: scene.objects.map(object => ({
          ...object,
          transform: { ...object.transform },
          scriptIds: [...(object.scriptIds || [])]
        }))
      })),
      scripts: (source.scripts || []).map(script => ({ ...script }))
    };
    const currentSceneId = sceneId ?? context.startupSceneId;
    const virtualIds = new Set();
    let contextualSelection = selectedId;
    const plan = [];
    for (let index = 0; index < pieces.length; index++) {
      const piece = pieces[index];
      const text = String(piece.text || '').trim();
      const step = {
        order: index + 1,
        delimiter: piece.delimiter || piece.by || 'manual',
        part: Number.isInteger(piece.part) ? piece.part : 1,
        partCount: Number.isInteger(piece.partCount) ? piece.partCount : 1,
        path: Array.isArray(piece.path) ? piece.path : [],
        ...describe(text, scriptGenerator, context, currentSceneId, contextualSelection)
      };
      step.text = text;
      if (virtualIds.has(step.targetId)) step.targetId = null;
      plan.push(step);
      const scene = activeScene(context, currentSceneId);
      if (step.type === 'object' && scene) {
        const object = model.createObject(step.kind, step.name);
        object.primitive = step.primitive;
        if (step.color) object.color = step.color;
        scene.objects.push(object);
        virtualIds.add(object.id);
        contextualSelection = object.id;
      } else if (step.type === 'modify' && scene) {
        const target = scene.objects.find(object => object.id === step.targetId) ||
          resolveReference(step.operation?.target, context, currentSceneId, selectedId);
        if (!target) continue;
        const operation = step.operation;
        if (operation.action === 'color') target.color = operation.value;
        else if (operation.action === 'scale') target.transform.sx = target.transform.sy = target.transform.sz = operation.value;
        else if (operation.action === 'axis') target.transform[operation.axis] = operation.value;
        else if (operation.action === 'rename') target.name = operation.value;
        else if (operation.action === 'primitive') {
          if (operation.value === 'sprite') { target.kind = 'sprite'; target.primitive = 'plane'; }
          else { target.kind = 'mesh'; target.primitive = operation.value; }
        } else if (operation.action === 'delete') {
          const removedIds = removeObjectTree(scene, target.id);
          if (removedIds.has(contextualSelection)) contextualSelection = null;
        }
      }
    }
    return plan;
  }

  function createPlan(prompt, scriptGenerator, model, project = null, sceneId = null, selectedId = null) {
    return analyzePieces(splitPrompt(prompt), scriptGenerator, model, project, sceneId, selectedId);
  }

  function cloneProject(project, model) {
    const copy = {
      ...project,
      app: { ...project.app },
      scenes: project.scenes.map(scene => ({
        ...scene,
        camera: {
          ...scene.camera,
          target: [...(scene.camera?.target || [0, 0, 0])],
          transform: { ...(scene.camera?.transform || {}) }
        },
        objects: scene.objects.map(object => ({
          ...object,
          transform: { ...object.transform },
          scriptIds: [...(object.scriptIds || [])]
        }))
      })),
      assets: (project.assets || []).map(asset => ({ ...asset })),
      scripts: (project.scripts || []).map(script => ({ ...script })),
      classes: (project.classes || []).map(item => ({ ...item }))
    };
    return model.normalizeProject(copy);
  }

  function findTarget(step, scene, selectedId, lastCreated) {
    if (step.targetId) return scene.objects.find(object => object.id === step.targetId) || null;
    const reference = step.operation?.target || step.text;
    if (lastCreated && reference && new RegExp(`\\b${escaped(lastCreated.name)}\\b`, 'i').test(reference)) return lastCreated;
    const explicit = scene.objects
      .filter(object => object.name && new RegExp(`\\b${escaped(object.name)}\\b`, 'i').test(reference))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (explicit) return explicit;
    const aliases = String(reference).match(/\b(player|enemy|opponent|character|hero|npc|wall|floor|ground|platform|tree|rock|box|cube|sphere|ball|plane|sprite|image|light|camera|audio|sound|object)\b/gi) || [];
    for (const alias of aliases) {
      const found = scene.objects.find(object => new RegExp(`\\b${escaped(alias)}\\b`, 'i').test(object.name) || object.primitive === alias.toLowerCase());
      if (found) return found;
    }
    if (/\b(?:selected|current|this|it|them)\b/i.test(reference) && selectedId)
      return scene.objects.find(object => object.id === selectedId) || lastCreated || null;
    return lastCreated || scene.objects.find(object => object.id === selectedId) || scene.objects[0] || null;
  }

  function removeObjectTree(scene, id) {
    const removed = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const object of scene.objects) {
        if (object.parentId && removed.has(object.parentId) && !removed.has(object.id)) {
          removed.add(object.id);
          changed = true;
        }
      }
    }
    scene.objects = scene.objects.filter(object => !removed.has(object.id));
    return removed;
  }

  function addScript(project, object, scriptInfo, model) {
    if (!object || !scriptInfo) return;
    const script = model.createScript(scriptInfo.name);
    script.source = scriptInfo.source;
    project.scripts.push(script);
    object.scriptIds.push(script.id);
  }

  function applyPlan(plan, sourceProject, model, scriptGenerator, options = {}) {
    const project = cloneProject(sourceProject, model);
    const sceneId = options.sceneId ?? project.startupSceneId;
    const scene = activeScene(project, sceneId);
    if (!scene) throw new Error('The selected scene no longer exists. Review the prompt again.');
    const selectedId = options.selectedId || null;
    let lastCreated = null;
    let lastTouched = null;
    let created = 0, modified = 0, removed = 0, attached = 0, skipped = 0;

    for (const step of plan) {
      if (!String(step.text || '').trim()) throw new Error(`Prompt step ${step.order} is empty. Edit it or remove it before applying.`);
      if (step.type === 'note' || step.type === 'unsupported') { skipped++; continue; }
      if (step.type === 'object') {
        if (model.flattenObjects(project).length >= 48) throw new Error('A project can contain at most 48 objects across all scenes.');
        const object = model.createObject(step.kind, step.name);
        object.primitive = step.primitive;
        if (step.color) object.color = step.color;
        const index = scene.objects.length;
        object.transform.x = (index % 4) * 1.5 - 2.25;
        object.transform.z = -Math.floor(index / 4) * 1.5;
        scene.objects.push(object);
        lastCreated = object;
        lastTouched = object;
        created++;
        if (step.script) { addScript(project, object, step.script, model); attached++; }
        continue;
      }
      if (step.type === 'modify') {
        const target = findTarget(step, scene, selectedId, lastCreated);
        if (!target) throw new Error(`Step ${step.order}: ${step.summary} (no target object).`);
        const operation = step.operation;
        lastTouched = target;
        if (operation.action === 'color') target.color = operation.value;
        else if (operation.action === 'scale') target.transform.sx = target.transform.sy = target.transform.sz = operation.value;
        else if (operation.action === 'axis') target.transform[operation.axis] = operation.value;
        else if (operation.action === 'rename') target.name = operation.value;
        else if (operation.action === 'primitive') {
          if (target.kind === 'audio') throw new Error(`Step ${step.order}: audio objects cannot be changed to a mesh primitive.`);
          if (operation.value === 'sprite') { target.kind = 'sprite'; target.primitive = 'plane'; }
          else { target.kind = 'mesh'; target.primitive = operation.value; }
        } else if (operation.action === 'delete') {
          const deleted = removeObjectTree(scene, target.id);
          removed += deleted.size;
          if (lastCreated && deleted.has(lastCreated.id)) lastCreated = null;
          if (lastTouched && deleted.has(lastTouched.id)) lastTouched = null;
          continue;
        }
        modified++;
        continue;
      }
      if (step.type === 'script') {
        let target = findTarget(step, scene, selectedId, lastCreated);
        if (!target) {
          if (model.flattenObjects(project).length >= 48) throw new Error('A project can contain at most 48 objects across all scenes.');
          target = model.createObject('mesh', 'Player');
          scene.objects.push(target);
          lastCreated = target;
          created++;
        }
        addScript(project, target, step.script, model);
        lastTouched = target;
        attached++;
      }
    }
    model.validateProject(project);
    return {
      project,
      selectedId: lastTouched?.id || (scene.objects.some(object => object.id === selectedId) ? selectedId : null),
      counts: { created, modified, removed, attached, skipped }
    };
  }

  function generateProject(plan, model, scriptGenerator, appName) {
    const blank = model.createProject();
    blank.app.name = (appName || 'Generated Project').trim().slice(0, 64) || 'Generated Project';
    blank.app.id = blank.app.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'generated-project';
    blank.app.description = 'Generated from a reviewed natural-language plan';
    return applyPlan(plan, blank, model, scriptGenerator).project;
  }

  return { splitPrompt, analyzePieces, createPlan, applyPlan, generateProject, parseModification, resolveReference };
});
