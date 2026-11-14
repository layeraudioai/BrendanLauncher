'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Abi1ScriptGenerator = api;
})(globalThis, function () {
  const CONTROL_TOKEN = '(?:left\\s+(?:arrow|d-?pad)|right\\s+(?:arrow|d-?pad)|' +
    'up\\s+(?:arrow|d-?pad)|down\\s+(?:arrow|d-?pad)|space(?:\\s*bar)?|' +
    'enter|return|escape|esc|plus|start|minus|select|back|[abxylr])';
  const CONTROL_BITS = {
    a: ['HB_A', 'A'], b: ['HB_B', 'B'], x: ['HB_X', 'X'], y: ['HB_Y', 'Y'],
    l: ['HB_L', 'L'], r: ['HB_R', 'R'],
    space: ['HB_A', 'A'], spacebar: ['HB_A', 'A'],
    leftarrow: ['HB_LEFT', 'Left'], leftdpad: ['HB_LEFT', 'Left'],
    rightarrow: ['HB_RIGHT', 'Right'], rightdpad: ['HB_RIGHT', 'Right'],
    uparrow: ['HB_UP', 'Up'], updpad: ['HB_UP', 'Up'],
    downarrow: ['HB_DOWN', 'Down'], downdpad: ['HB_DOWN', 'Down'],
    enter: ['HB_PLUS', 'Plus'], return: ['HB_PLUS', 'Plus'],
    plus: ['HB_PLUS', 'Plus'], start: ['HB_PLUS', 'Plus'],
    escape: ['HB_MINUS', 'Minus'], esc: ['HB_MINUS', 'Minus'],
    minus: ['HB_MINUS', 'Minus'], select: ['HB_MINUS', 'Minus'], back: ['HB_MINUS', 'Minus']
  };
  const COLORS = {
    red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1],
    yellow: [1, 1, 0], cyan: [0, 1, 1], magenta: [1, 0, 1],
    white: [1, 1, 1], black: [0, 0, 0], orange: [1, 0.5, 0],
    purple: [0.5, 0, 0.5]
  };
  const SUPPORTED_EXAMPLE = 'Try “move right at 2 units per second when pressing A”, ' +
    '“rotate around Y at 90 degrees per second”, “set color to blue”, ' +
    '“spawn a red sphere at (1, 2, 3) when pressing A”, ' +
    '“set color to a random color”, “switch to the next scene”, ' +
    '“play the audio attached to this object”, or “exit when pressing B”.';

  function parseControl(text) {
    const patterns = [
      new RegExp('\\b(?:(?:when|while)\\s+(?:(?:pressing|press|holding|hold)\\s+)?|' +
        'press(?:ing)?\\s+|hold(?:ing)?\\s+|on\\s+|using\\s+)(?:the\\s+)?' +
        '(?:(?:button|key)\\s+)?(' + CONTROL_TOKEN + ')' +
        '(?:\\s+(?:button|key|arrow))?(?:\\s+(?:is\\s+)?(?:pressed|held|down))?\\b', 'g'),
      new RegExp('\\b(?:button|key)\\s+(' + CONTROL_TOKEN +
        ')(?:\\s+(?:is\\s+)?(?:pressed|held|down))?\\b', 'g')
    ];
    const matches = [];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const key = match[1].replace(/[\s-]/g, '');
        const control = CONTROL_BITS[key];
        if (control) matches.push({
          bit: control[0], label: control[1], start: match.index,
          end: match.index + match[0].length, key,
          held: /\b(?:hold(?:ing)?|held|down)\b/.test(match[0])
        });
      }
    }
    const unique = [...new Map(matches.map(item => [item.bit, item])).values()];
    if (unique.length > 1)
      throw new Error('Use one button or key condition per generated script.');
    return unique[0] || null;
  }

  function numberText(value) {
    return Number(value.toFixed(6)).toString();
  }

  function ratePerSecond(text, fallback) {
    const match = text.match(/(\d+(?:\.\d+)?)\s*(?:units?\s*)?(?:per\s*(?:second|sec)|\/\s*s)\b/);
    return match ? Number(match[1]) : fallback;
  }

  function wrapAction(action, control) {
    if (!control) return action;
    const input = control.held ? 'hbButtons()' : 'buttons';
    return `if ((${input} & ${control.bit}) != 0u) {\n    ${action}\n}`;
  }

  function generated(name, action, control) {
    return {
      name: control ? `${name} ${control.held ? 'while holding' : 'on'} ${control.label}` : name,
      source: `// Generated offline by ABI-1 Studio.\n${wrapAction(action, control)}`
    };
  }

  function findMoveDirection(text, control) {
    const match = text.match(/\b(?:move|translate|slide)\b[\s\S]{0,48}?\b(left|right|up|down|forward|forwards|back|backward|backwards)\b/);
    if (match) return /^forwards$/.test(match[1]) ? 'forward' :
      /^(back|backward|backwards)$/.test(match[1]) ? 'back' : match[1];
    const axisMatch = text.match(/\balong\s+(?:the\s+)?([xyz])(?:\s+axis)?\b/);
    if (axisMatch) return axisMatch[1];
    if (control) {
      const directionByButton = {
        HB_LEFT: 'left', HB_RIGHT: 'right', HB_UP: 'up', HB_DOWN: 'down'
      };
      return directionByButton[control.bit] || null;
    }
    return null;
  }

  function makeMove(text, control) {
    const direction = findMoveDirection(text, control);
    const axes = {
      left: ['x', '-'], right: ['x', '+'], up: ['y', '+'], down: ['y', '-'],
      forward: ['z', '-'], back: ['z', '+'], x: ['x', '+'], y: ['y', '+'], z: ['z', '+']
    };
    if (!direction || !axes[direction])
      throw new Error('Specify a movement direction such as left, right, up, down, forward, or back.');
    const [axis, operator] = axes[direction];
    const speed = ratePerSecond(text, 1);
    return generated(`Move ${direction[0].toUpperCase()}${direction.slice(1)}`,
      `position.${axis} ${operator}= dt * ${numberText(speed)};`, control);
  }

  function makeRotate(text, control) {
    const axisMatch = text.match(/\b(?:around|about|on|axis)\s+(?:the\s+)?([xyz])\b|\b([xyz])\s+axis\b/);
    const axis = axisMatch ? axisMatch[1] || axisMatch[2] : 'y';
    const radians = text.match(/(\d+(?:\.\d+)?)\s*(?:radians?|rads?)\s*(?:per\s*(?:second|sec)|\/\s*s)\b/);
    const degrees = text.match(/(\d+(?:\.\d+)?)\s*(?:degrees?|degs?|°)\s*(?:per\s*(?:second|sec)|\/\s*s)\b/);
    let speed = radians ? Number(radians[1]) :
      degrees ? Number(degrees[1]) * Math.PI / 180 : Math.PI / 2;
    if (/\b(counterclockwise|counter-clockwise|anticlockwise|reverse|negative)\b/.test(text))
      speed *= -1;
    return generated(`Rotate ${axis.toUpperCase()}`,
      `rotation.${axis} += dt * ${numberText(speed)};`, control);
  }

  function makeColor(text, control) {
    if (/\brandom(?:ly)?\s+colou?r\b/.test(text))
      return generated('Set random color',
        'color.rgb = hbRandomColor(objectIndex);', control);
    let rgb;
    const hex = text.match(/#([0-9a-f]{6})\b/i);
    if (hex) {
      const value = Number.parseInt(hex[1], 16);
      rgb = [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
    } else {
      const color = Object.keys(COLORS).find(name => new RegExp(`\\b${name}\\b`).test(text));
      if (!color) throw new Error('Choose a supported color name or provide a #RRGGBB value.');
      rgb = COLORS[color];
    }
    const colorName = Object.entries(COLORS).find(([, value]) =>
      value.every((component, index) => component === rgb[index]));
    const name = colorName ? colorName[0] : `#${hex[1].toUpperCase()}`;
    return generated(`Set color ${name}`, `color.rgb = vec3(${rgb.map(numberText).join(', ')});`, control);
  }

  function randomRange(text, seed) {
    const match = text.match(/\brandom(?:\s+(?:number|value|amount))?(?:\s+between|\s+from)\s+(-?\d+(?:\.\d+)?)\s+(?:and|to)\s+(-?\d+(?:\.\d+)?)/);
    const minimum = match ? Number(match[1]) : 0;
    const maximum = match ? Number(match[2]) : 1;
    return `hbRandomRange(${numberText(minimum)}, ${numberText(maximum)}, objectIndex + ${seed}u)`;
  }

  function makeRandomValue(text, control) {
    const axisMatch = text.match(/\b(?:position|coordinate)\s+([xyz])\b|\b([xyz])\s+(?:position|coordinate)\b/);
    const axis = axisMatch && (axisMatch[1] || axisMatch[2]);
    if (axis) {
      return generated(`Randomize ${axis.toUpperCase()} position`,
        `position.${axis} = ${randomRange(text, 1)};`, control);
    }
    if (/\bscale\b/.test(text)) {
      const scaleMatch = text.match(/\bscale\s+([xyz])\b/);
      if (scaleMatch)
        return generated(`Randomize ${scaleMatch[1].toUpperCase()} scale`,
          `scale.${scaleMatch[1]} = ${randomRange(text, 2)};`, control);
      return generated('Randomize scale', `scale = vec3(${randomRange(text, 2)});`, control);
    }
    if (/\brotation\b/.test(text)) {
      const rotationMatch = text.match(/\brotation\s+([xyz])\b/);
      if (rotationMatch)
        return generated(`Randomize ${rotationMatch[1].toUpperCase()} rotation`,
          `rotation.${rotationMatch[1]} = ${randomRange(text, 3)};`, control);
      return generated('Randomize rotation', `rotation = vec3(${randomRange(text, 3)});`, control);
    }
    throw new Error('Name position, scale, or rotation, such as “set position x to a random number between -2 and 2”.');
  }

  function colorExpression(text) {
    if (/\brandom(?:ly)?\s+colou?r\b/.test(text)) return 'hbRandomColor(objectIndex)';
    const hex = text.match(/#([0-9a-f]{6})\b/i);
    if (hex) {
      const value = Number.parseInt(hex[1], 16);
      return `vec3(${numberText((value >> 16 & 255) / 255)}, ${numberText((value >> 8 & 255) / 255)}, ${numberText((value & 255) / 255)})`;
    }
    const color = Object.keys(COLORS).find(name => new RegExp(`\\b${name}\\b`).test(text));
    if (!color) return 'vec3(1.0)';
    return `vec3(${COLORS[color].map(numberText).join(', ')})`;
  }

  function makeObjectAudio(text, control, project) {
    const objects = project && Array.isArray(project.scenes)
      ? project.scenes.flatMap(scene => scene.objects || []) : [];
    const namedAudio = objects.find(object => {
      if (object.kind !== 'audio' || !object.name) return false;
      const found = new RegExp(`\\b${object.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
        .test(text);
      return found;
    });
    if (namedAudio) {
      const eventId = Number(namedAudio.audioEventId || 0);
      if (!Number.isInteger(eventId) || eventId < 1 || eventId > 31)
        throw new Error(`Audio object ${namedAudio.name} has no valid sound event.`);
      return generated(`Play ${namedAudio.name} audio`, `hbSound(${eventId}u);`, control);
    }
    return generated('Play object audio', 'hbPlayObjectAudio(objectIndex);', control);
  }

  function makeSetObjectAudio(text, control) {
    const match = text.match(/\b(?:event|id)(?:\s+number)?\s*(?:to|=)?\s*(\d+)\b/);
    if (!match) throw new Error('Specify an audio event ID from 0 to 31.');
    const eventId = Number(match[1]);
    if (eventId > 31) throw new Error('Audio event IDs must be between 0 and 31.');
    return generated(`Set object audio event ${eventId}`,
      `hbSetObjectAudio(objectIndex, ${eventId}u);`, control);
  }

  function makeSpawn(text, control) {
    const shapeMatch = text.match(/\b(box|cube|sphere|sprite|plane)\b/);
    if (!shapeMatch) throw new Error('Choose a box, sphere, sprite, or plane to spawn.');
    const shapeName = shapeMatch[1];
    const shape = shapeName === 'cube' ? 'BOX' : shapeName.toUpperCase();
    const point = text.match(/\bat\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/);
    let position = point
      ? `vec3(${numberText(Number(point[1]))}, ${numberText(Number(point[2]))}, ${numberText(Number(point[3]))})`
      : 'position + vec3(1.0, 0.0, 0.0)';
    if (/\brandom\s+position\b/.test(text))
      position = `position + vec3(${randomRange(text, 11)}, ${randomRange(text, 12)}, ${randomRange(text, 13)})`;
    const scaleMatch = text.match(/\bscale\s+(?:to\s+)?(\d+(?:\.\d+)?)/);
    const scale = scaleMatch ? `vec3(${numberText(Number(scaleMatch[1]))})` : 'vec3(1.0)';
    const color = colorExpression(text);
    const shapeConstant = `HB_SHAPE_${shape}`;
    const helper = !control && !/\b(every|each)\s+frame\b/.test(text)
      ? 'hbSpawnOnce' : 'hbSpawnObject';
    const args = helper === 'hbSpawnOnce'
      ? `objectIndex, ${shapeConstant}, ${position}, ${scale}, ${color}`
      : `${shapeConstant}, ${position}, ${scale}, ${color}`;
    return generated(`Spawn ${shapeName}`, `${helper}(${args});`, control);
  }

  function makeSceneSwitch(text, control, project, currentSceneId) {
    const scenes = project && Array.isArray(project.scenes) ? project.scenes : [];
    if (!scenes.length) throw new Error('Scene switching prompts need the current project scene list.');
    let action;
    if (/\b(next|following)\s+scene\b/.test(text) || /\bscene\s+after\b/.test(text)) {
      const currentIndex = scenes.findIndex(scene => scene.id === currentSceneId);
      if (currentIndex < 0) throw new Error('The active scene is not available in the project.');
      action = `hbLoadScene(${scenes[(currentIndex + 1) % scenes.length].id}u);`;
    } else if (/\b(previous|prior|last)\s+scene\b/.test(text)) {
      const currentIndex = scenes.findIndex(scene => scene.id === currentSceneId);
      if (currentIndex < 0) throw new Error('The active scene is not available in the project.');
      action = `hbLoadScene(${scenes[(currentIndex + scenes.length - 1) % scenes.length].id}u);`;
    } else if (/\brandom\s+scene\b/.test(text)) {
      const choices = scenes.filter(scene => scene.id !== currentSceneId);
      if (!choices.length) throw new Error('Add another scene before choosing a random scene.');
      const branches = choices.map((scene, index) =>
        `${index ? 'else ' : ''}if(sceneChoice < ${numberText((index + 1) / choices.length)}) hbLoadScene(${scene.id}u);`)
        .join(' ');
      action = `float sceneChoice = hbRandom(objectIndex); ${branches}`;
    } else {
      const numeric = text.match(/\bscene(?:\s+(?:id|number))?\s+(\d+)\b/);
      const named = scenes.find(scene => scene.name &&
        new RegExp(`\\b${scene.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
      const scene = numeric
        ? scenes.find(item => item.id === Number(numeric[1]))
        : named;
      if (!scene) throw new Error('Name a scene in this project, use its numeric ID, or say “next scene”.');
      action = `hbLoadScene(${scene.id}u);`;
    }
    if (currentSceneId && !control)
      action = `if (hbCurrentScene() == ${currentSceneId}u) { ${action} }`;
    return generated('Switch scene', action, control);
  }

  function generateScript(prompt, project, currentSceneId) {
    if (typeof prompt !== 'string' || !prompt.trim())
      throw new Error(`Enter a prompt. ${SUPPORTED_EXAMPLE}`);
    const text = prompt.trim().toLowerCase();
    const control = parseControl(text);
    const actionText = control
      ? `${text.slice(0, control.start)} ${text.slice(control.end)}`
      : text;
    const isExit = /\b(exit|quit)\b/.test(text);
    const isSound = /\b(play|trigger|start|switch|select)\b[\s\S]{0,24}\b(sound|audio)\b|\b(sound|audio)\b[\s\S]{0,24}\b(play|trigger|start|switch|select)\b/.test(text);
    const isStopSound = /\b(stop|silence|mute)\b[\s\S]{0,24}\b(sound|audio)\b|\b(sound|audio)\b[\s\S]{0,24}\b(stop|silence|mute)\b/.test(text);
    const isSetObjectAudio = /\b(set|assign|change)\b[\s\S]{0,24}\b(audio|sound)\b[\s\S]{0,24}\b(event|id)\b/.test(text);
    const isObjectAudio = /\b(attached|this object|object's|objects)\b/.test(text) &&
      /\b(sound|audio)\b/.test(text);
    const isSpawn = /\b(spawn|create|add)\b/.test(text) &&
      /\b(box|cube|sphere|sprite|plane|object)\b/.test(text);
    const namesScene = project && Array.isArray(project.scenes) &&
      project.scenes.some(scene => scene.name &&
        new RegExp(`\\b${scene.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
    const isSceneSwitch = /\b(switch|change|load|go)\b[\s\S]{0,32}\b(scene|next|previous)\b|\b(next|previous|random)\s+scene\b/.test(text) ||
      Boolean(namesScene && /\b(switch|change|load|go)\b/.test(text));
    const isRandomValue = !isSpawn && /\brandom\b/.test(text) &&
      /\b(position|coordinate|scale|rotation)\b/.test(text);
    const hasColor = /\b(color|colour)\b/.test(text) ||
      /\b(?:make|turn|change|set)\b[\s\S]{0,20}\b(red|green|blue|yellow|cyan|magenta|white|black|orange|purple|#[0-9a-f]{6})\b/i.test(text);
    const isColor = !isSpawn && hasColor &&
      /\b(set|change|make|turn|become|colou?r)\b/.test(text);
    const isRotate = /\b(rotate|spin)\b/.test(text) ||
      (/\bturn\b/.test(text) && !isColor);
    const isScale = !isRandomValue && /\b(scale|resize|grow|shrink)\b/.test(text);
    const isMove = !isRandomValue && /\b(move|translate|slide)\b/.test(text);
    const intents = [isExit, isSound, isStopSound, isSetObjectAudio, isColor, isRotate, isScale,
      isMove, isSpawn, isSceneSwitch, isRandomValue].filter(Boolean).length;
    if (intents !== 1)
      throw new Error(`${intents ? 'Describe one behavior per script.' : 'I could not identify a supported behavior.'} ${SUPPORTED_EXAMPLE}`);

    if (isExit) {
      if (!control) throw new Error(`Specify a button or key to exit on. ${SUPPORTED_EXAMPLE}`);
      return generated('Exit', 'hbExit();', control);
    }
    if (isSpawn) return makeSpawn(actionText, control);
    if (isSceneSwitch) return makeSceneSwitch(actionText, control, project, currentSceneId);
    if (isRandomValue) return makeRandomValue(actionText, control);
    if (isStopSound) return generated('Stop sound', 'hbStopSound();', control);
    if (isSetObjectAudio) return makeSetObjectAudio(actionText, control);
    if (isSound) {
      if (isObjectAudio)
        return makeObjectAudio(text, control, project);
      if (/\bswitch\b/.test(text)) {
        const match = text.match(/\b(?:sound|audio)(?:\s+event)?\s*(?:id\s*)?(\d+)\b/);
        const eventId = match ? Number(match[1]) : 1;
        if (eventId < 1 || eventId > 31)
          throw new Error('Sound event IDs must be between 1 and 31.');
        return generated(`Switch to sound ${eventId}`, `hbSwitchSound(${eventId}u);`, control);
      }
      const match = text.match(/\b(?:sound|audio)(?:\s+event)?\s*(?:id\s*)?(\d+)\b/);
      const eventId = match ? Number(match[1]) : 1;
      if (eventId < 1 || eventId > 31)
        throw new Error('Sound event IDs must be between 1 and 31.');
      return generated(`Play sound ${eventId}`, `hbSound(${eventId}u);`, control);
    }
    if (isColor) return makeColor(text, control);
    if (isRotate) return makeRotate(text, control);
    if (isScale) {
      const match = text.match(/\b(?:scale|size)\b[\s\S]{0,20}?\bto\s+(\d+(?:\.\d+)?)/);
      if (match) {
        const value = numberText(Number(match[1]));
        return generated('Set scale', `scale = vec3(${value});`, control);
      }
      if (/\b(grow|shrink)\b/.test(text)) {
        const amount = ratePerSecond(text, 0.5) * (/\bshrink\b/.test(text) ? -1 : 1);
        const operator = amount < 0 ? '-=' : '+=';
        return generated(amount < 0 ? 'Shrink' : 'Grow',
          `scale ${operator} vec3(dt * ${numberText(Math.abs(amount))});`, control);
      }
      throw new Error('Specify a target scale, such as “set scale to 2”, or say “grow” or “shrink”.');
    }
    return makeMove(actionText, control);
  }

  return { generateScript };
});
