'use strict';
/* WebPort v1: native UI compiler for a deliberately small HTML/CSS/action subset. */
const fs = require('node:fs/promises');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

function escC(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '').replace(/\t/g, '\\t') + '"';
}
function cleanText(value) {
  return value.replace(/<!--[^]*?-->/g, '').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ').trim();
}
function color(value, fallback) {
  if (!value) return fallback;
  let match = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (match) {
    let hex = match[1];
    if (hex.length === 3) hex = [...hex].map(ch => ch + ch).join('');
    return `HBX_RGB(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  }
  match = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (match) return `HBX_RGB(${Math.min(255, +match[1])}, ${Math.min(255, +match[2])}, ${Math.min(255, +match[3])})`;
  if (value === 'white') return 'HBX_RGB(255, 255, 255)';
  if (value === 'black') return 'HBX_RGB(0, 0, 0)';
  return fallback;
}
function cssRules(css) {
  const output = {};
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const props = {};
    for (const declaration of match[2].split(';')) {
      const index = declaration.indexOf(':');
      if (index > 0) props[declaration.slice(0, index).trim().toLowerCase()] = declaration.slice(index + 1).trim();
    }
    for (const selector of match[1].split(',').map(value => value.trim())) {
      if (['body', '.card', 'main', 'h1', 'h2', 'p', 'button'].includes(selector))
        output[selector] = {...(output[selector] || {}), ...props};
    }
  }
  return output;
}
function attr(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(String.raw`(?:^|\s)${escaped}\s*=\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match?.[1] ?? match?.[2] ?? null;
}
function validateHtmlTags(html) {
  const start = html.toLowerCase().indexOf('<body');
  const body = start >= 0 ? html.slice(start) : html;
  const supported = new Set(['html','head','meta','title','link','body','main','div','section','span','strong','em','h1','h2','p','button','br','script']);
  for (const match of body.matchAll(/<([A-Za-z][A-Za-z0-9-]*)/g)) {
    const tag = match[1].toLowerCase();
    if (!supported.has(tag)) throw Error(`WebPort v1 does not support the <${tag}> element`);
  }
}
function collect(html) {
  const output = {title: '', paragraphs: [], buttons: []};
  const body = html.match(/<body\b[^>]*>([^]*?)<\/body\s*>/i)?.[1] || html;
  for (const match of body.matchAll(/<(h1|h2|p|button)\b([^>]*)>([^]*?)<\/\1\s*>/gi)) {
    const tag = match[1].toLowerCase();
    const value = cleanText(match[3]);
    if (!value) continue;
    if (tag === 'h1' || tag === 'h2') { if (!output.title) output.title = value; }
    else if (tag === 'button') output.buttons.push({label: value, action: attr(match[2], 'data-native-action') || ''});
    else output.paragraphs.push(value);
  }
  return output;
}
function wrap(value, max = 74) {
  const lines = []; let line = '';
  for (const word of value.split(/\s+/)) {
    if (line && line.length + word.length + 1 > max) { lines.push(line); line = word; }
    else line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
function cProgram(model, colors) {
  let y = 370;
  const paragraphCalls = [];
  for (const paragraph of model.paragraphs) {
    for (const line of wrap(paragraph, 94)) {
      paragraphCalls.push(`        hbx_ui_text(ctx, 232.0f, ${y}.0f, HBX_FONT_BODY, ${escC(line)}, ${colors.text});`);
      y += 34;
    }
    y += 18;
  }
  const rows = [];
  for (let index = 0; index < model.buttons.length; index++) {
    const rowY = y;
    rows.push([
      `        hbx_ui_rect(ctx, 232.0f, ${rowY}.0f, 1456.0f, 68.0f, 12.0f, selected == ${index}u ? HBX_RGB(51, 78, 39) : ${colors.buttonBg});`,
      `        hbx_ui_stroke(ctx, 232.0f, ${rowY}.0f, 1456.0f, 68.0f, 12.0f, 2.0f, selected == ${index}u ? HBX_RGB(162, 239, 93) : HBX_RGB(67, 85, 65));`,
      `        hbx_ui_text(ctx, 260.0f, ${rowY + 20}.0f, HBX_FONT_BODY, button_labels[${index}], ${colors.buttonText});`
    ].join('\n'));
    y += 90;
  }
  const counterIndex = model.buttons.findIndex(button => button.action === 'counter');
  const counterUpdate = counterIndex >= 0 ? `count++; append_uint(count_text,count);\n            hbx_memcpy(button_labels[${counterIndex}], "Clicked ", 8);\n            hbx_memcpy(button_labels[${counterIndex}]+8, count_text, hbx_strlen(count_text));\n            hbx_memcpy(button_labels[${counterIndex}]+8+hbx_strlen(count_text), count==1u ? " time" : " times", count==1u ? 5u : 6u);\n            button_labels[${counterIndex}][8+hbx_strlen(count_text)+(count==1u?5u:6u)]=0;` : '';
  const touchHandlers = model.buttons.map((button, index) => {
    const rowY = 370 + model.paragraphs.reduce((sum, p) => sum + wrap(p, 94).length * 34 + 18, 0) + index * 90;
    return `            if(hbx_touch_hit(&input.touch[t],232,${rowY},1456,68)) {\n                selected=${index}u;\n                if(last_touch_id!=input.touch[t].id) { ${button.action === 'counter' ? counterUpdate : ''} }\n                last_touch_id=input.touch[t].id;\n            }`;
  }).join('\\n');
  const labelInit = model.buttons.length ? model.buttons.map(button => escC(button.label)).join(', ') : '""';
  return `/* Generated by WebPort v1. Edits will be overwritten. */
#include "hbx_sdk.h"
#include "hbx_app.h"
#include "hbx_ui.h"

static void append_uint(char *out, unsigned value) {
    char reverse[12]; unsigned n=0, i=0;
    do { reverse[n++]=(char)('0'+(value%10u)); value/=10u; } while(value && n<sizeof reverse);
    while(n) out[i++]=reverse[--n];
    out[i]=0;
}

int hbx_app_main(const struct hbx_ctx *ctx) {
    struct hbx_input_state input; uint64_t deadline=0; uint32_t frames=0;
    uint32_t selected=0, count=0; char count_text[12];
    ${model.buttons.length ? 'uint32_t last_touch_id=0xffffffffu, t;' : ''}
    char button_labels[${Math.max(model.buttons.length, 1)}][96] = {${labelInit}};
    if(hbx_ctx_check(ctx)!=HBX_OK) return HBX_ERR_ABI;
    hbx_memset(&input,0,sizeof input);
    hbx_log(ctx, "WebPort native UI started");
    while(!hbx_stop_requested(ctx)) {
        hbx_input_poll(ctx,&input);
        if(input.pressed & (HBX_B|HBX_PLUS)) break;
        ${model.buttons.length ? `if(input.pressed & HBX_DOWN) selected=(selected+1u)%${model.buttons.length}u;
        if(input.pressed & HBX_UP) selected=(selected+${model.buttons.length - 1}u)%${model.buttons.length}u;` : ''}
        ${counterIndex >= 0 ? `if((input.pressed & HBX_A) && selected==${counterIndex}u) { ${counterUpdate} }` : ''}
        ${model.buttons.length ? `if(input.touch_count==0u) last_touch_id=0xffffffffu;
        for(t=0;t<input.touch_count && t<HBX_MAX_TOUCH;t++) {\n${touchHandlers}\n        }` : ''}
        hbx_ui_begin(ctx, ${colors.pageBg});
        hbx_ui_rect(ctx, 152.0f, 112.0f, 1616.0f, 856.0f, 24.0f, ${colors.cardBg});
        hbx_ui_stroke(ctx, 152.0f, 112.0f, 1616.0f, 856.0f, 24.0f, 2.0f, HBX_RGB(51, 67, 50));
        hbx_ui_text(ctx, 232.0f, 220.0f, HBX_FONT_H1, ${escC(model.title || 'Web app')}, ${colors.heading});
${paragraphCalls.join('\n')}
${rows.join('\n')}
        hbx_ui_text(ctx, 232.0f, 900.0f, HBX_FONT_SMALL, ${escC(model.buttons.length ? 'Touch/A: activate  ·  B: return  ·  D-pad: select' : 'B: return')}, HBX_RGB(165, 184, 158));
        hbx_ui_present(ctx); frames++; hbx_frame_end(ctx); hbx_pace(ctx,&deadline,60);
    }
    hbx_logf(ctx,"WebPort exited after %u frames",frames);
    return HBX_OK;
}
`;
}
async function build(id, {root = ROOT, skipVite = false, skipNativeBuild = false} = {}) {
  if (!ID.test(id)) throw Error('Invalid web-app id');
  const webDir = path.join(root, 'web-apps', id);
  const manifest = JSON.parse(await fs.readFile(path.join(webDir, 'webapp.json'), 'utf8'));
  if (manifest.format !== 'brendan.webapp' || manifest.runtime !== 'static' || manifest.nativePort?.enabled !== true || manifest.nativePort.version !== 1)
    throw Error(`${id}: enable nativePort version 1 in webapp.json first`);
  if (!skipVite) execFileSync(process.execPath, [path.join(root, 'tools', 'build-webapps.cjs'), id, '--install'], {cwd: root, stdio: 'inherit'});
  const dist = path.join(webDir, manifest.distDir || 'dist');
  const builtHtml = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
  const sourceEntry = path.join(webDir, manifest.build?.entry || 'index.html');
  const sourceHtml = await fs.readFile(sourceEntry, 'utf8');
  validateHtmlTags(sourceHtml);
  const model = collect(sourceHtml);
  if (!model.title) throw Error(`${id}: native port requires at least one <h1> or <h2> title`);
  if (model.paragraphs.length > 12 || model.buttons.length > 6) throw Error(`${id}: WebPort v1 limits: 12 paragraphs and 6 buttons`);
  if (model.paragraphs.some(value => value.length > 300) || model.buttons.some(button => button.label.length > 80)) throw Error(`${id}: text exceeds WebPort v1 limits`);
  const declared = new Set(Array.isArray(manifest.nativePort.actions) ? manifest.nativePort.actions : []);
  for (const button of model.buttons) {
    if (button.action && (!['counter'].includes(button.action) || !declared.has(button.action)))
      throw Error(`${id}: unsupported or undeclared native action ${button.action}; declare supported actions in webapp.json`);
  }
  let css = '';
  for (const match of builtHtml.matchAll(/<link\b[^>]*href=["']([^"']+\.css)["'][^>]*>/gi)) {
    const file = path.resolve(dist, match[1].replace(/^\.\//, ''));
    if (!file.startsWith(dist + path.sep)) throw Error('CSS asset escaped dist directory');
    css += '\n' + await fs.readFile(file, 'utf8');
  }
  const rules = cssRules(css);
  const colors = {
    pageBg: color(rules.body?.background || rules.body?.['background-color'], 'HBX_RGB(16, 21, 16)'),
    cardBg: color(rules['.card']?.background || rules['.card']?.['background-color'] || rules.main?.background, 'HBX_RGB(23, 30, 24)'),
    text: color(rules.p?.color || rules.body?.color, 'HBX_RGB(226, 235, 222)'),
    heading: color(rules.h1?.color || rules.h2?.color || rules.body?.color, 'HBX_RGB(237, 244, 233)'),
    buttonBg: color(rules.button?.background || rules.button?.['background-color'], 'HBX_RGB(162, 239, 93)'),
    buttonText: color(rules.button?.color, 'HBX_RGB(20, 32, 13)')
  };
  const nativeId = (id + '-native').slice(0, 64);
  const out = path.join(root, 'apps', nativeId);
  const marker = path.join(out, '.webport-generated.json');
  try {
    await fs.access(out);
    let previous;
    try { previous = JSON.parse(await fs.readFile(marker, 'utf8')); }
    catch { throw Error(`Refusing to overwrite existing app ${nativeId}`); }
    if (previous.format !== 'brendan.webport-generated' || previous.sourceId !== id) throw Error(`Refusing to overwrite existing app ${nativeId}`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.join(out, 'src'), {recursive: true});
  const nativeManifest = {id: nativeId, name: (manifest.name || id).slice(0, 64), description: `Native Switch UI port of ${manifest.name || id} (WebPort v1)`, version: manifest.version || '1.0.0', abi: 3, kind: 'native', assets: [], limits: {heap_bytes: 4194304, stack_bytes: 1048576, frames: 0}};
  await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(nativeManifest, null, 2) + '\n');
  await fs.writeFile(marker, JSON.stringify({format: 'brendan.webport-generated', version: 1, sourceId: id}, null, 2) + '\n');
  await fs.writeFile(path.join(out, 'src', 'app.c'), cProgram(model, colors));
  const notes = [
    `# Native port of ${manifest.name || id}`,
    '',
    `Generated from web-apps/${id} by WebPort v1.`,
    '',
    'This is a real ABI-3 app package for the Switch-side BrendanLauncher runtime.',
    'WebPort maps semantic markup and declared data-native-action interactions to the native renderer/input API.',
    'It does not execute the Vite JavaScript bundle on-console.',
    'Supported markup: h1/h2, paragraphs and buttons; supported CSS: simple color properties; supported action: counter.',
    'Unsupported browser features require an explicit native implementation.',
    '',
    `Rebuild with node tools/port-webapp.cjs ${id}.`,
    ''
  ].join('\n');
  await fs.writeFile(path.join(out, 'WEBPORT.md'), notes);
  console.log(`[WebPort] Generated native app source: apps/${nativeId}`);
  if (!skipNativeBuild) {
    const python = require('../scripts/python.cjs').pythonCommand();
    execFileSync(python, [path.join(root, 'sdk', 'tools', 'hbx-build.py'), out], {cwd: root, stdio: 'inherit', env: process.env});
  }
  console.log('[WebPort] Native UI and declared actions are compiled; arbitrary DOM/JavaScript APIs do not run on Switch.');
  return out;
}
async function main() {
  const args = process.argv.slice(2);
  const id = args.find(value => !value.startsWith('--'));
  if (!id) throw Error('Usage: node tools/port-webapp.cjs <web-app-id> [--skip-vite] [--no-build]');
  await build(id, {skipVite: args.includes('--skip-vite'), skipNativeBuild: args.includes('--no-build')});
}
if (require.main === module) main().catch(error => {console.error('[WebPort failed] ' + (error.stack || error.message)); process.exitCode = 1;});
module.exports = {build, collect, cssRules};
