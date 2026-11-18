'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Abi1ScriptExpression = api;
})(globalThis, function () {
  const SPECIAL = /(?:\^|\*\*|%|!|\b(?:random|rand|factorial|fact|root|cbrt|sqrt|abs|log|log10|ln)\s*\()/i;
  const TOKEN_RE = /\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*|\*\*|\|\||&&|==|!=|<=|>=|[()+\-*/%^!,?:<>]/y;
  const PRECEDENCE = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '^': 7, '**': 7 };

  function tokenize(source) {
    const tokens = [];
    TOKEN_RE.lastIndex = 0;
    while (TOKEN_RE.lastIndex < source.length) {
      const at = TOKEN_RE.lastIndex;
      const match = TOKEN_RE.exec(source);
      if (!match) throw new Error(`Unsupported math-expression character at column ${at + 1}`);
      if (!/^\s+$/.test(match[0])) tokens.push(match[0]);
    }
    tokens.push('<end>');
    return tokens;
  }

  function parseExpression(source) {
    const tokens = tokenize(source);
    let cursor = 0;
    const peek = () => tokens[cursor];
    const take = () => tokens[cursor++];
    const expect = token => {
      if (take() !== token) throw new Error(`Expected '${token}' in math expression`);
    };

    function primary() {
      const token = take();
      let node;
      if (token === '+' || token === '-' || token === '!') node = { type: 'unary', op: token, value: expression(7) };
      else if (token === '(') { node = expression(0); expect(')'); }
      else if (/^(?:\d|\.)/.test(token)) node = { type: 'atom', value: token };
      else if (/^[A-Za-z_]/.test(token)) {
        if (peek() === '(') {
          take();
          const args = [];
          if (peek() !== ')') {
            do { args.push(expression(0)); if (peek() !== ',') break; take(); } while (true);
          }
          expect(')');
          node = { type: 'call', name: token, args };
        } else node = { type: 'atom', value: token };
      } else throw new Error(`Expected a number, variable, or function near '${token}'`);

      while (peek() === '!') { take(); node = { type: 'factorial', value: node }; }
      return node;
    }

    function expression(minPrecedence) {
      let left = primary();
      while (Object.hasOwn(PRECEDENCE, peek()) && PRECEDENCE[peek()] >= minPrecedence) {
        const op = take();
        const precedence = PRECEDENCE[op];
        const right = expression(precedence + ((op === '^' || op === '**') ? 0 : 1));
        left = { type: 'binary', op, left, right };
      }
      if (minPrecedence === 0 && peek() === '?') {
        take(); const yes = expression(0); expect(':'); const no = expression(0);
        left = { type: 'conditional', condition: left, yes, no };
      }
      return left;
    }

    const tree = expression(0);
    if (peek() !== '<end>') throw new Error(`Unexpected '${peek()}' in math expression`);
    return tree;
  }

  function render(node) {
    if (node.type === 'atom') {
      if (node.value === 'pi' || node.value === 'PI') return '3.141592653589793';
      if (node.value === 'e' || node.value === 'E') return '2.718281828459045';
      return node.value;
    }
    if (node.type === 'unary') return `(${node.op}${render(node.value)})`;
    if (node.type === 'factorial') return `hbFactorial(float(${render(node.value)}))`;
    if (node.type === 'conditional') return `((${render(node.condition)}) ? (${render(node.yes)}) : (${render(node.no)}))`;
    if (node.type === 'binary') {
      const left = render(node.left), right = render(node.right);
      if (node.op === '^' || node.op === '**') return `pow(float(${left}), float(${right}))`;
      if (node.op === '%') return `mod(float(${left}), float(${right}))`;
      return `((${left}) ${node.op} (${right}))`;
    }
    if (node.type === 'call') {
      const name = node.name.toLowerCase();
      const args = node.args.map(render);
      if (name === 'random' || name === 'rand') {
        if (args.length === 0) return 'hbRandom(objectIndex)';
        if (args.length === 2) return `hbRandomRange(float(${args[0]}), float(${args[1]}), objectIndex)`;
        throw new Error('random() takes either no arguments or a minimum and maximum');
      }
      if (name === 'factorial' || name === 'fact') {
        if (args.length !== 1) throw new Error(`${node.name}() takes one argument`);
        return `hbFactorial(float(${args[0]}))`;
      }
      if (name === 'root') {
        if (args.length !== 2) throw new Error('root(degree, value) takes two arguments');
        return `hbRoot(float(${args[0]}), float(${args[1]}))`;
      }
      if (name === 'cbrt') {
        if (args.length !== 1) throw new Error('cbrt() takes one argument');
        return `(sign(float(${args[0]})) * pow(abs(float(${args[0]})), 0.3333333333333333))`;
      }
      if (name === 'ln' || name === 'log10' || name === 'sqrt' || name === 'abs') {
        if (args.length !== 1) throw new Error(`${node.name}() takes one argument`);
        if (name === 'ln') return `log(float(${args[0]}))`;
        if (name === 'log10') return `(log(float(${args[0]})) / log(10.0))`;
        return `${name}(float(${args[0]}))`;
      }
      if (name === 'log') {
        if (args.length === 1) return `log(float(${args[0]}))`;
        if (args.length === 2) return `(log(float(${args[1]})) / log(float(${args[0]})))`;
        throw new Error('log() takes one value or a base and value');
      }
      return `${node.name}(${args.join(', ')})`;
    }
    throw new Error('Invalid math expression');
  }

  function extractComments(source) {
    let code = '', i = 0;
    const comments = [];
    while (i < source.length) {
      if (source.startsWith('//', i)) {
        const end = source.indexOf('\n', i + 2);
        const stop = end < 0 ? source.length : end;
        comments.push(source.slice(i, stop));
        code += `\u0001${comments.length - 1}\u0002`;
        i = stop;
      } else if (source.startsWith('/*', i)) {
        const end = source.indexOf('*/', i + 2);
        if (end < 0) throw new Error('Unclosed comment in math expression');
        comments.push(source.slice(i, end + 2));
        code += `\u0001${comments.length - 1}\u0002`;
        i = end + 2;
      } else code += source[i++];
    }
    return { code, comments };
  }

  function transpileExpression(source) {
    const { code, comments } = extractComments(source);
    const leading = code.match(/^\s*/)[0];
    const trailing = code.match(/\s*$/)[0];
    const cleanCode = code.replace(/\u0001\d+\u0002/g, ' ');
    const result = render(parseExpression(cleanCode.trim()));
    const preserved = `${leading}${result}${trailing}`;
    return comments.length ? `${preserved} ${comments.join('\n')}` : preserved;
  }

  function wrapOnceBlocks(source, allocateOnceSlot) {
    const replacements = [];
    let i = 0, state = 'code';
    while (i < source.length) {
      const ch = source[i], next = source[i + 1];
      if (state === 'line-comment') { if (ch.charCodeAt(0) === 10) state = 'code'; i++; continue; }
      if (state === 'block-comment') { if (ch === '*' && next === '/') { state = 'code'; i += 2; } else i++; continue; }
      if (ch === '/' && next === '/') { state = 'line-comment'; i += 2; continue; }
      if (ch === '/' && next === '*') { state = 'block-comment'; i += 2; continue; }
      if (source.startsWith('once', i) && !/[A-Za-z0-9_]/.test(source[i - 1] || ' ') &&
          !/[A-Za-z0-9_]/.test(source[i + 4] || ' ')) {
        let open = i + 4;
        while (source[open] && source[open].trim() === '') open++;
        if (source[open] === '{') {
          let depth = 1, end = open + 1, blockState = 'code';
          for (; end < source.length && depth; end++) {
            const c = source[end], n = source[end + 1];
            if (blockState === 'line-comment') { if (c.charCodeAt(0) === 10) blockState = 'code'; continue; }
            if (blockState === 'block-comment') { if (c === '*' && n === '/') { blockState = 'code'; end++; } continue; }
            if (c === '/' && n === '/') { blockState = 'line-comment'; end++; continue; }
            if (c === '/' && n === '*') { blockState = 'block-comment'; end++; continue; }
            if (c === '{') depth++;
            else if (c === '}') depth--;
          }
          if (depth) throw new Error('Unclosed once { ... } block');
          const slot = allocateOnceSlot();
          if (!Number.isInteger(slot) || slot < 0 || slot > 22)
            throw new Error('One-time script slots must be between 0 and 22 per object');
          const body = wrapOnceBlocks(source.slice(open + 1, end - 1), allocateOnceSlot);
          replacements.push({ start: i, end, value: `if (hbRunOnce(onceFlags, ${slot}u)) {${body}}` });
          i = end;
          continue;
        }
      }
      i++;
    }
    let result = source;
    for (let index = replacements.length - 1; index >= 0; index--) {
      const item = replacements[index];
      result = result.slice(0, item.start) + item.value + result.slice(item.end);
    }
    return result;
  }

  function isFloatAssignmentTarget(left) {
    const value = left.trim();
    if (/^(?:(?:const|highp|mediump|lowp)\s+)*(?:float|vec[234])\s+[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return true;
    return /(?:^|[^A-Za-z0-9_])(?:position|rotation|scale)(?:\.[xyzw]{1,4})?(?:\[[^\]]+\])?\s*[+\-*/%]?$/.test(value) ||
      /(?:^|[^A-Za-z0-9_])color(?:\.(?:[rgba]{1,4}))?\s*[+\-*/%]?$/.test(value);
  }

  function floatIntegerLiterals(source) {
    let result = '', i = 0, state = 'code';
    while (i < source.length) {
      const ch = source[i], next = source[i + 1];
      if (state === 'line-comment') { result += ch; if (ch === '\n') state = 'code'; i++; continue; }
      if (state === 'block-comment') {
        result += ch;
        if (ch === '*' && next === '/') { result += next; i += 2; state = 'code'; } else i++;
        continue;
      }
      if (state === 'string' || state === 'char') {
        result += ch;
        if (ch === '\\' && next) { result += next; i += 2; continue; }
        if ((state === 'string' && ch === '"') || (state === 'char' && ch === "'")) state = 'code';
        i++; continue;
      }
      if (ch === '/' && next === '/') { result += '//'; i += 2; state = 'line-comment'; continue; }
      if (ch === '/' && next === '*') { result += '/*'; i += 2; state = 'block-comment'; continue; }
      if (ch === '"') { result += ch; i++; state = 'string'; continue; }
      if (ch === "'") { result += ch; i++; state = 'char'; continue; }
      if (/\d/.test(ch) || (ch === '.' && /\d/.test(next || ''))) {
        const match = source.slice(i).match(/^(?:0[xX][0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:[uU])?/)[0];
        const previous = source[i - 1] || '';
        const isInteger = !/^0[xX]/.test(match) && !/[.eEuU]/.test(match) &&
          !/[A-Za-z0-9_.]/.test(previous) && !/[A-Za-z_]/.test(source[i + match.length] || '');
        result += isInteger ? `${match}.0` : match;
        i += match.length;
        continue;
      }
      result += ch;
      i++;
    }
    return result;
  }

  function transpileSource(source, options = {}) {
    let localSlot = 0;
    const allocate = options.allocateOnceSlot || (() => localSlot++);
    source = wrapOnceBlocks(source, allocate);
    const assignments = [];
    let i = 0, state = 'code';
    while (i < source.length) {
      const ch = source[i], next = source[i + 1];
      if (state === 'line-comment') { if (ch === '\n') state = 'code'; i++; continue; }
      if (state === 'block-comment') { if (ch === '*' && next === '/') { state = 'code'; i += 2; } else i++; continue; }
      if (state === 'string' || state === 'char') {
        if (ch === '\\') { i += 2; continue; }
        if ((state === 'string' && ch === '"') || (state === 'char' && ch === "'")) state = 'code';
        i++; continue;
      }
      if (ch === '/' && next === '/') { state = 'line-comment'; i += 2; continue; }
      if (ch === '/' && next === '*') { state = 'block-comment'; i += 2; continue; }
      if (ch === '"') { state = 'string'; i++; continue; }
      if (ch === "'") { state = 'char'; i++; continue; }
      if (ch !== '=') { i++; continue; }
      const previous = source[i - 1] || '', after = next || '';
      if (after === '=' || ['=', '!', '<', '>'].includes(previous)) { i++; continue; }
      let start = i + 1, depth = 0, end = start, innerState = 'code';
      for (; end < source.length; end++) {
        const c = source[end], n = source[end + 1];
        if (innerState === 'line-comment') { if (c === '\n') innerState = 'code'; continue; }
        if (innerState === 'block-comment') { if (c === '*' && n === '/') { innerState = 'code'; end++; } continue; }
        if (innerState === 'string' || innerState === 'char') {
          if (c === '\\') { end++; continue; }
          if ((innerState === 'string' && c === '"') || (innerState === 'char' && c === "'")) innerState = 'code';
          continue;
        }
        if (c === '/' && n === '/') { innerState = 'line-comment'; end++; continue; }
        if (c === '/' && n === '*') { innerState = 'block-comment'; end++; continue; }
        if (c === '"') { innerState = 'string'; continue; }
        if (c === "'") { innerState = 'char'; continue; }
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (c === ';' && depth === 0) break;
      }
      if (end < source.length) {
        const rhs = source.slice(start, end);
        const boundary = Math.max(source.lastIndexOf(';', i - 1), source.lastIndexOf('{', i - 1), source.lastIndexOf('}', i - 1));
        const left = extractComments(source.slice(boundary + 1, i)).code;
        if (SPECIAL.test(extractComments(rhs).code.replace(/\u0001\d+\u0002/g, ' '))) assignments.push({ start, end, value: transpileExpression(rhs) });
        else if (isFloatAssignmentTarget(left)) {
          const normalized = floatIntegerLiterals(rhs);
          if (normalized !== rhs) assignments.push({ start, end, value: normalized });
        }
        i = end + 1;
      } else i = start;
    }
    let result = source;
    for (let index = assignments.length - 1; index >= 0; index--) {
      const item = assignments[index];
      result = result.slice(0, item.start) + item.value + result.slice(item.end);
    }
    return result;
  }

  return { transpileExpression, transpileSource };
});
