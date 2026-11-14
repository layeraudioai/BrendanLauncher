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
    '“play sound 2 when pressing A”, or “exit when pressing B”.';

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

  function generateScript(prompt) {
    if (typeof prompt !== 'string' || !prompt.trim())
      throw new Error(`Enter a prompt. ${SUPPORTED_EXAMPLE}`);
    const text = prompt.trim().toLowerCase();
    const control = parseControl(text);
    const actionText = control
      ? `${text.slice(0, control.start)} ${text.slice(control.end)}`
      : text;
    const isExit = /\b(exit|quit)\b/.test(text);
    const isSound = /\b(play|trigger|start)\b[\s\S]{0,24}\b(sound|audio)\b|\b(sound|audio)\b[\s\S]{0,24}\b(play|trigger|start)\b/.test(text);
    const hasColor = /\b(color|colour)\b/.test(text) ||
      /\b(?:make|turn|change|set)\b[\s\S]{0,20}\b(red|green|blue|yellow|cyan|magenta|white|black|orange|purple|#[0-9a-f]{6})\b/i.test(text);
    const isColor = hasColor && /\b(set|change|make|turn|become|colou?r)\b/.test(text);
    const isRotate = /\b(rotate|spin)\b/.test(text) ||
      (/\bturn\b/.test(text) && !isColor);
    const isScale = /\b(scale|resize|grow|shrink)\b/.test(text);
    const isMove = /\b(move|translate|slide)\b/.test(text);
    const intents = [isExit, isSound, isColor, isRotate, isScale, isMove].filter(Boolean).length;
    if (intents !== 1)
      throw new Error(`${intents ? 'Describe one behavior per script.' : 'I could not identify a supported behavior.'} ${SUPPORTED_EXAMPLE}`);

    if (isExit) {
      if (!control) throw new Error(`Specify a button or key to exit on. ${SUPPORTED_EXAMPLE}`);
      return generated('Exit', 'hbExit();', control);
    }
    if (isSound) {
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
