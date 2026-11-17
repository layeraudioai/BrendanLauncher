'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { importProject } = require('./project-importer.js');

test('importer recognizes Unity project and returns warnings', () => {
  const { project, warnings } = importProject('GameObject: Player\n m_Component: Rigidbody', 'scene.unity');
  assert.strictEqual(project.format, 'brendan-abi1-studio');
  assert.strictEqual(project.scenes.length, 1);
  assert.ok(warnings.some(w => w.includes('Unity project format detected')));
});

test('importer recognizes Godot project and returns warnings', () => {
  const { project, warnings } = importProject('[node name="Player" type="Node3D"]', 'main.tscn');
  assert.strictEqual(project.format, 'brendan-abi1-studio');
  assert.ok(warnings.some(w => w.includes('Godot scene')));
});

test('importer recognizes Three.js JSON and maps objects', () => {
  const threeJson = {
    objects: [
      { name: 'Cube1', type: 'Mesh', position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] }
    ]
  };
  const { project, warnings } = importProject(JSON.stringify(threeJson), 'scene.json');
  assert.strictEqual(project.scenes[0].objects.length, 1);
  assert.strictEqual(project.scenes[0].objects[0].name, 'Cube1');
  assert.strictEqual(project.scenes[0].objects[0].transform.x, 1);
  assert.ok(warnings.some(w => w.includes('Three.js')));
});

test('importer handles generic files with fallback and warning', () => {
  const { project, warnings } = importProject('some random custom file content', 'unknown.ext');
  assert.strictEqual(project.scenes.length, 1);
  assert.ok(warnings.length > 0);
});
