'use strict';

const assert = require('node:assert/strict');
const model = require('./scene-model.js');
const scriptGenerator = require('./script-generator.js');
const generator = require('./project-generator.js');

const ordered = generator.splitPrompt('first and second, third.\nfourth');
assert.deepEqual(ordered.map(item => item.text), ['first', 'second', 'third', 'fourth']);
assert.deepEqual(ordered.map(item => item.order), [1, 2, 3, 4]);
assert.equal(ordered[0].by, 'and');
assert.equal(ordered[0].part, 1);
assert.equal(ordered[0].partCount, 2);
assert.equal(ordered[1].part, 2);
assert.equal(ordered[2].by, 'comma');
assert.equal(ordered[2].part, 2);
assert.equal(ordered[3].by, 'newline');
assert.deepEqual(ordered[0].path.map(item => item.delimiter), ['newline', 'comma', 'and']);

const staged = generator.splitPrompt(`one. two, three and four
five`);
assert.deepEqual(staged.map(item => item.text), ['one', 'two', 'three', 'four', 'five']);
assert.deepEqual(staged.map(item => item.by), ['period', 'comma', 'and', 'and', 'newline']);
assert.deepEqual(staged.map(item => item.order), [1, 2, 3, 4, 5]);

const plan = generator.createPlan(
  'Create a blue player cube and move right at 2 units per second when pressing A. Add a red enemy sphere',
  scriptGenerator, model);
assert.deepEqual(plan.map(step => step.type), ['object', 'script', 'object']);
assert.ok(plan.every(step => Number.isInteger(step.part) && Number.isInteger(step.partCount)));
assert.equal(plan[0].primitive, 'box');
assert.equal(plan[0].color, '#4287ff');
assert.match(plan[1].script.source, /position\.x \+= dt \* 2/);

const project = generator.generateProject(plan, model, scriptGenerator, 'Space Demo');
assert.equal(project.app.name, 'Space Demo');
assert.equal(project.scenes[0].objects.length, 2);
assert.equal(project.scripts.length, 1);
assert.equal(project.scenes[0].objects[0].scriptIds[0], project.scripts[0].id);
assert.equal(project.scenes[0].objects[1].primitive, 'sphere');
model.validateProject(project);

const unsupported = generator.createPlan('Make it spectacular', scriptGenerator, model);
assert.equal(unsupported[0].type, 'note');
assert.match(unsupported[0].summary, /ordered prompt note/);

const behaviorOnly = generator.createPlan('move up when pressing B', scriptGenerator, model);
const behaviorProject = generator.generateProject(behaviorOnly, model, scriptGenerator, 'Solo Behavior');
assert.equal(behaviorProject.scenes[0].objects[0].name, 'Player');
assert.equal(behaviorProject.scenes[0].objects[0].scriptIds.length, 1);
model.validateProject(behaviorProject);

const current = model.createProject();
current.app.name = 'Existing App';
const player = model.createObject('mesh', 'Player');
player.transform.x = 7;
current.scenes[0].objects.push(player);
const refinementPlan = generator.createPlan(
  'change player color to red. add a blue enemy sphere, move enemy left when pressing B',
  scriptGenerator, model, current, current.startupSceneId, player.id);
assert.deepEqual(refinementPlan.map(step => step.type), ['modify', 'object', 'script']);
const applied = generator.applyPlan(refinementPlan, current, model, scriptGenerator, {
  sceneId: current.startupSceneId, selectedId: player.id
});
assert.equal(applied.project.app.name, 'Existing App');
assert.equal(applied.project.scenes[0].objects[0].id, player.id);
assert.equal(applied.project.scenes[0].objects[0].transform.x, 7);
assert.equal(applied.project.scenes[0].objects[0].color, '#ff3b4f');
assert.equal(applied.project.scenes[0].objects[1].name, 'Enemy');
assert.equal(applied.project.scripts.length, 1);
assert.equal(applied.project.scenes[0].objects[1].scriptIds[0], applied.project.scripts[0].id);
assert.deepEqual(applied.counts, { created: 1, modified: 1, removed: 0, attached: 1, skipped: 0 });
model.validateProject(applied.project);

const deletionProject = model.createProject();
const parent = model.createObject('mesh', 'Player');
const child = model.createObject('mesh', 'Player Child');
child.parentId = parent.id;
deletionProject.scenes[0].objects.push(parent, child);
const deletePlan = generator.createPlan('delete Player', scriptGenerator, model, deletionProject);
assert.equal(deletePlan[0].type, 'modify');
const deleted = generator.applyPlan(deletePlan, deletionProject, model, scriptGenerator);
assert.equal(deleted.counts.removed, 2);
assert.equal(deleted.project.scenes[0].objects.length, 0);
assert.equal(deletionProject.scenes[0].objects.length, 2, 'source project is not mutated');

const fullProject = model.createProject();
for (let i = 0; i < 48; i++) fullProject.scenes[0].objects.push(model.createObject('mesh', `Object ${i}`));
const overCapacity = generator.createPlan('add a sphere', scriptGenerator, model, fullProject);
assert.throws(() => generator.applyPlan(overCapacity, fullProject, model, scriptGenerator), /48 objects/i);
assert.equal(fullProject.scenes[0].objects.length, 48, 'failed application is atomic');

const invalidTarget = generator.createPlan('change dragon color to purple', scriptGenerator, model, current);
assert.equal(invalidTarget[0].type, 'unsupported');
assert.match(invalidTarget[0].summary, /No matching object/);
const orderedNew = generator.createPlan('add a red player cube and change player color to blue', scriptGenerator, model);
assert.deepEqual(orderedNew.map(step => step.type), ['object', 'modify']);
const newProject = generator.generateProject(orderedNew, model, scriptGenerator, 'Order Demo');
assert.equal(newProject.scenes[0].objects.length, 1);
assert.equal(newProject.scenes[0].objects[0].color, '#4287ff');
const combinedInstruction = generator.createPlan('make a player move right at 2 units per second', scriptGenerator, model);
assert.equal(combinedInstruction[0].type, 'object');
assert.ok(combinedInstruction[0].script.source.includes('position.x += dt * 2;'));
const defaultMovement = scriptGenerator.generateScript('Move right');
assert.ok(defaultMovement.source.includes('position.x += dt;'));
assert.ok(!defaultMovement.source.includes('dt * 1'));
const combinedProject = generator.generateProject(combinedInstruction, model, scriptGenerator, 'Combined');
assert.equal(combinedProject.scripts.length, 1);
assert.equal(combinedProject.scenes[0].objects[0].scriptIds.length, 1);
assert.deepEqual(generator.splitPrompt('  \n . , and  '), []);
console.log('ABI-1 project generator tests passed');
