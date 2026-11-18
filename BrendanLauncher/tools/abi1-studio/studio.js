'use strict';

class Abi1StudioApp {
  constructor() {
    this.model = window.Abi1SceneModel;
    this.builder = new window.Abi1Build.Abi1PackageBuilder({ model: this.model });
    this.project = this.model.createProject();
    this.mount();
  }

  mount() {
    const model = this.model;
    const builder = this.builder;
    const scriptGenerator = window.Abi1ScriptGenerator;
    const projectGenerator = window.Abi1ProjectGenerator;
    const $ = selector => document.querySelector(selector);
    const canvas = $('#sceneCanvas');
    const context = canvas.getContext('2d');
    const status = $('#status');
    const previewDialog = $('#previewDialog');
    const scriptDialog = $('#scriptDialog');
    const classDialog = $('#classDialog');
    const preview = new window.Abi1Preview.Abi1PreviewRuntime({
      model, builder, canvas: $('#previewCanvas'),
      onExit: () => {
        setStatus('App requested exit in PC Preview');
        if (previewDialog.open) previewDialog.close();
      }
    });
    const projectKey = 'abi1-studio-project-v1';
    const prefabsKey = 'abi1-studio-prefabs-v1';
    const thisApp = this;
    let pendingDownload = null;
    let project = this.project;
    let activeSceneId = project.startupSceneId;
    let selectedId = null;
    let editingScriptId = null;
    let editingClassId = null;
    let camera = project.scenes[0].camera;
    let pointerAction = null;
    let renderQueued = false;
    const imageCache = new Map();

    function activeScene() {
      return project.scenes.find(scene => scene.id === activeSceneId) || project.scenes[0];
    }

    function activeObjects() {
      return activeScene().objects;
    }

    function allObjects() {
      return model.flattenObjects(project).map(item => item.object);
    }

    function message(text) {
      pendingDownload = null;
      $('#downloadBuild').hidden = true;
      $('#messageText').textContent = text;
      $('#messageDialog').showModal();
    }

    function setStatus(text) {
      status.textContent = text;
    }

    function selectedObject() {
      return activeObjects().find(object => object.id === selectedId) || null;
    }

    function assetId() {
      return model.createObject('sprite').id;
    }

    function scheduleRender() {
      if (renderQueued) return;
      renderQueued = true;
      requestAnimationFrame(() => {
        renderQueued = false;
        renderScene();
      });
    }

    function setProject(value) {
      project = model.normalizeProject(value);
      musicProject = project.music ? music.validateProject(project.music) : music.createSeededMusic(project.app.id || 'studio-starter');
      project.music = musicProject;
      selectedMelodyId = musicProject.melodies[0]?.id || '';
      selectedPatternId = musicProject.patterns[0]?.id || '';
      selectedMusicTrackId = musicProject.tracks[0]?.id || '';
      thisApp.project = project;
      activeSceneId = project.startupSceneId;
      camera = activeScene().camera;
      selectedId = activeObjects()[0]?.id || null;
      syncAppFields();
      renderScenes();
      renderHierarchy();
      renderInspector();
      renderScriptLibrary();
      renderClassLibrary();
      scheduleRender();
    }

    function renderScenes() {
      const current = $('#sceneSelect');
      const startup = $('#startupScene');
      current.replaceChildren();
      startup.replaceChildren();
      for (const scene of project.scenes) {
        current.add(new Option(`${scene.name} (${scene.id})`, String(scene.id)));
        startup.add(new Option(scene.name, String(scene.id)));
      }
      current.value = String(activeSceneId);
      startup.value = String(project.startupSceneId);
      $('#deleteScene').disabled = project.scenes.length === 1;
      const transform = activeScene().camera.transform;
      for (const input of document.querySelectorAll('[data-camera-transform]'))
        input.value = Number(transform[input.dataset.cameraTransform].toFixed(3));
    }

    function selectScene(id) {
      const scene = project.scenes.find(item => item.id === id);
      if (!scene) throw new Error(`Unknown scene ID: ${id}`);
      activeSceneId = id;
      camera = scene.camera;
      selectedId = scene.objects[0]?.id || null;
      renderScenes();
      renderHierarchy();
      renderInspector();
      scheduleRender();
    }

    function syncAppFields() {
      $('#appName').value = project.app.name;
      $('#appId').value = project.app.id;
      $('#appDescription').value = project.app.description;
      $('#appVersion').value = project.app.version;
    }

    function syncProjectFields() {
      project.app.name = $('#appName').value.trim() || 'My GPU App';
      project.app.id = $('#appId').value.trim().toLowerCase();
      project.app.description = $('#appDescription').value.trim() || 'Created with ABI-1 Studio';
      project.app.version = $('#appVersion').value.trim() || '1.0.0';
    }

    function addObject(kind, parentId = null, name) {
      if (allObjects().length >= 48) {
        message('A project can contain at most 48 objects across all scenes.');
        return null;
      }
      const object = model.createObject(kind, name);
      object.parentId = parentId;
      const objects = activeObjects();
      const index = objects.length;
      if (kind === 'audio') {
        const used = new Set(allObjects().filter(item => item.kind === 'audio').map(item => item.audioEventId));
        object.audioEventId = Array.from({ length: 31 }, (_, i) => i + 1).find(id => !used.has(id)) || 1;
      }
      object.transform.x = (index % 4) * 1.4 - 2.1;
      object.transform.z = -Math.floor(index / 4) * 1.4;
      objects.push(object);
      selectedId = object.id;
      renderHierarchy();
      renderInspector();
      scheduleRender();
      setStatus(`Created ${object.name}`);
      return object;
    }

    function descendantsOf(id) {
      const result = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const object of activeObjects()) {
          if (object.parentId && result.has(object.parentId) && !result.has(object.id)) {
            result.add(object.id);
            changed = true;
          }
        }
      }
      return result;
    }

    function renderHierarchy() {
      const host = $('#hierarchy');
      host.replaceChildren();
      const children = new Map();
      for (const object of activeObjects()) {
        const parent = activeObjects().some(item => item.id === object.parentId) ? object.parentId : null;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(object);
      }
      const addBranch = (parentId, depth) => {
        for (const object of children.get(parentId) || []) {
          const wrapper = document.createElement('div');
          wrapper.className = 'tree-node';
          const row = document.createElement('div');
          row.className = `tree-row${object.id === selectedId ? ' selected' : ''}`;
          row.draggable = true;
          row.dataset.id = object.id;
          for (let i = 0; i < depth; i++) {
            const indent = document.createElement('span');
            indent.className = 'tree-indent';
            row.append(indent);
          }
          const icon = document.createElement('span');
          icon.className = `tree-icon ${object.kind}`;
          const label = document.createElement('span');
          label.className = 'tree-label';
          label.textContent = object.name;
          row.append(icon, label);
          row.addEventListener('click', () => selectObject(object.id));
          row.addEventListener('dragstart', event => {
            event.dataTransfer.setData('application/x-abi1-object', object.id);
            event.dataTransfer.effectAllowed = 'move';
          });
          row.addEventListener('dragover', event => {
            if (event.dataTransfer.types.includes('application/x-abi1-object')) {
              event.preventDefault();
              row.classList.add('drag-over');
            }
          });
          row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
          row.addEventListener('drop', event => {
            event.preventDefault();
            row.classList.remove('drag-over');
            const movingId = event.dataTransfer.getData('application/x-abi1-object');
            if (movingId) reparent(movingId, object.id);
          });
          wrapper.append(row);
          host.append(wrapper);
          addBranch(object.id, depth + 1);
        }
      };
      addBranch(null, 0);
      host.ondragover = event => {
        if (event.dataTransfer.types.includes('application/x-abi1-object')) event.preventDefault();
      };
      host.ondrop = event => {
        const movingId = event.dataTransfer.getData('application/x-abi1-object');
        if (movingId) {
          event.preventDefault();
          reparent(movingId, null);
        }
      };
      $('#sceneCount').textContent = `${activeObjects().length} object${activeObjects().length === 1 ? '' : 's'}`;
      $('#emptyState').classList.toggle('hidden', activeObjects().length > 0);
    }

    function reparent(childId, parentId) {
      const child = activeObjects().find(object => object.id === childId);
      if (!child || childId === parentId || (parentId && descendantsOf(childId).has(parentId))) return;
      const previousParent = child.parentId;
      child.parentId = parentId;
      try {
        model.validateProject(project);
      } catch (error) {
        child.parentId = previousParent;
        message(error.message);
        return;
      }
      renderHierarchy();
      renderInspector();
      scheduleRender();
      setStatus(parentId ? `Parented ${child.name}` : `Moved ${child.name} to scene root`);
    }

    function selectObject(id) {
      selectedId = id;
      renderHierarchy();
      renderInspector();
      scheduleRender();
    }

    function renderInspector() {
      const object = selectedObject();
      $('#inspectorEmpty').hidden = !!object;
      $('#inspector').hidden = !object;
      $('#selectedKind').textContent = object ? object.kind : 'No selection';
      if (!object) return;
      const form = $('#inspector');
      for (const key of ['name', 'primitive', 'color', 'audioEventId'])
        if (form.elements[key]) form.elements[key].value = object[key] ?? '';
      for (const [key, value] of Object.entries(object.transform))
        form.elements[key].value = Number(value.toFixed(3));
      form.elements.primitive.disabled = object.kind !== 'mesh' && object.kind !== 'sprite';
      form.elements.color.disabled = object.kind === 'audio';
      form.elements.audioEventId.closest('label').hidden = object.kind !== 'audio';
      const audioAsset = object.kind === 'audio'
        ? project.assets.find(asset => asset.id === object.assetId && asset.kind === 'audio')
        : null;
      $('#audioAssetLabel').hidden = object.kind !== 'audio';
      $('#audioAssetName').textContent = audioAsset ? audioAsset.name : 'No asset assigned';
      $('#audioAssetName').title = audioAsset ? audioAsset.name : '';
      const parentSelect = form.elements.namedItem('parent');
      parentSelect.replaceChildren(new Option('Scene Root', ''));
      const excluded = descendantsOf(object.id);
      for (const candidate of activeObjects()) {
        if (excluded.has(candidate.id)) continue;
        const option = new Option(candidate.name, candidate.id);
        option.selected = candidate.id === object.parentId;
        parentSelect.append(option);
      }
      parentSelect.value = object.parentId || '';
      renderAttachedScripts(object);
    }

    function renderAttachedScripts(object) {
      const host = $('#attachedScripts');
      const select = $('#scriptAttachSelect');
      const attach = $('#attachScript');
      host.replaceChildren();
      select.replaceChildren();
      if (!object) {
        attach.disabled = true;
        select.disabled = true;
        return;
      }

      for (const scriptId of object.scriptIds) {
        const script = project.scripts.find(item => item.id === scriptId);
        if (!script) continue;
        const row = document.createElement('div');
        row.className = 'attached-script';
        const name = document.createElement('span');
        name.className = 'attached-script-name';
        name.textContent = script.name;
        name.title = script.name;
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = 'Edit';
        edit.addEventListener('click', () => openScriptEditor(script.id));
        const detach = document.createElement('button');
        detach.type = 'button';
        detach.textContent = '×';
        detach.title = `Detach ${script.name}`;
        detach.setAttribute('aria-label', `Detach ${script.name}`);
        detach.addEventListener('click', () => {
          object.scriptIds = object.scriptIds.filter(id => id !== script.id);
          renderInspector();
        });
        row.append(name, edit, detach);
        host.append(row);
      }

      const available = project.scripts.filter(script => !object.scriptIds.includes(script.id));
      if (!available.length) {
        const option = new Option(project.scripts.length ? 'All scripts attached' : 'No scripts available', '');
        option.disabled = true;
        option.selected = true;
        select.append(option);
      } else {
        for (const script of available) select.append(new Option(script.name, script.id));
      }
      select.disabled = available.length === 0;
      attach.disabled = available.length === 0;
    }

    function renderScriptLibrary() {
      const host = $('#scriptLibrary');
      host.replaceChildren();
      if (!project.scripts.length) {
        const empty = document.createElement('div');
        empty.className = 'script-empty';
        empty.textContent = 'Create reusable scripts to attach them to objects.';
        host.append(empty);
        return;
      }
      for (const script of project.scripts) {
        const row = document.createElement('div');
        row.className = 'script-entry';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = script.name;
        edit.title = 'Edit reusable script';
        edit.addEventListener('click', () => openScriptEditor(script.id));
        row.append(edit);
        host.append(row);
      }
    }

    function openScriptEditor(scriptId) {
      const script = project.scripts.find(item => item.id === scriptId);
      if (!script) return;
      editingScriptId = script.id;
      $('#scriptName').value = script.name;
      $('#scriptSource').value = script.source;
      $('#scriptError').textContent = '';
      $('#scriptPrompt').value = '';
      $('#generatorMessage').textContent = '';
      $('#generatorMessage').className = '';
      if (!scriptDialog.open) scriptDialog.showModal();
      $('#scriptName').focus();
    }

    function renderClassLibrary() {
      const host = $('#classLibrary');
      host.replaceChildren();
      if (!project.classes.length) {
        const empty = document.createElement('div');
        empty.className = 'script-empty';
        empty.textContent = 'GLSL class files are available to scripts in every scene.';
        host.append(empty);
        return;
      }
      for (const item of project.classes) {
        const row = document.createElement('div');
        row.className = 'script-entry';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = item.name;
        edit.title = 'Edit GLSL class file';
        edit.addEventListener('click', () => openClassEditor(item.id));
        row.append(edit);
        host.append(row);
      }
    }

    function openClassEditor(classId) {
      const item = project.classes.find(entry => entry.id === classId);
      if (!item) return;
      editingClassId = item.id;
      $('#className').value = item.name;
      $('#classSource').value = item.source;
      $('#classError').textContent = '';
      $('#deleteClass').hidden = false;
      $('#downloadClass').hidden = false;
      if (!classDialog.open) classDialog.showModal();
      $('#className').focus();
    }

    $('#newClass').addEventListener('click', () => {
      if (project.classes.length >= 32) return message('A project can contain at most 32 GLSL class files.');
      const item = model.createScript('New Class');
      editingClassId = item.id;
      $('#className').value = item.name;
      $('#classSource').value = '';
      $('#classError').textContent = '';
      $('#deleteClass').hidden = true;
      $('#downloadClass').hidden = true;
      classDialog.showModal();
      $('#className').focus();
    });
    $('#saveClass').addEventListener('click', () => {
      const name = $('#className').value.trim();
      const source = $('#classSource').value;
      if (!name || name.length > 64 || source.length > 16384) {
        $('#classError').textContent = 'Enter a name and keep the GLSL source under 16 KiB.';
        return;
      }
      let item = project.classes.find(entry => entry.id === editingClassId);
      if (!item) {
        item = { id: editingClassId, name, source };
        project.classes.push(item);
      } else {
        item.name = name;
        item.source = source;
      }
      try { model.validateProject(project); }
      catch (error) {
        $('#classError').textContent = error.message;
        return;
      }
      classDialog.close();
      renderClassLibrary();
      setStatus(`Saved GLSL class file ${name}`);
    });
    $('#deleteClass').addEventListener('click', () => {
      project.classes = project.classes.filter(item => item.id !== editingClassId);
      classDialog.close();
      renderClassLibrary();
      setStatus('Deleted GLSL class file');
    });
    $('#downloadClass').addEventListener('click', () => {
      const safe = ($('#className').value || 'class').replace(/[^a-z0-9_-]/gi, '-');
      download(`${safe}.glsl`, $('#classSource').value, 'text/plain');
    });
    $('#importClass').addEventListener('click', () => $('#classFile').click());
    $('#classFile').addEventListener('change', async event => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        if (project.classes.length >= 32) throw new Error('A project can contain at most 32 GLSL class files');
        if (file.size > 16384) throw new Error('GLSL class file exceeds 16 KiB');
        const source = await file.text();
        const name = file.name.replace(/\.glsl$/i, '').slice(0, 64) || 'Imported Class';
        const item = { id: model.createScript().id, name, source };
        project.classes.push(item);
        model.validateProject(project);
        renderClassLibrary();
        openClassEditor(item.id);
        setStatus(`Imported ${file.name}`);
      } catch (error) { message(`Could not import class file: ${error.message}`); }
      event.target.value = '';
    });

    $('#inspector').addEventListener('input', event => {
      const object = selectedObject();
      if (!object) return;
      const field = event.target.name;
      if (field === 'name') object.name = event.target.value || 'Object';
      else if (field === 'color' || field === 'primitive')
        object[field] = event.target.value;
      else if (field === 'audioEventId') object.audioEventId = Number(event.target.value);
      else if (Object.hasOwn(object.transform, field)) {
        const value = Number(event.target.value);
        if (Number.isFinite(value)) object.transform[field] = value;
      }
      renderHierarchy();
      scheduleRender();
    });
    $('#inspector').elements.namedItem('parent').addEventListener('change', event => {
      const object = selectedObject();
      if (object) reparent(object.id, event.target.value || null);
    });
    $('#deleteObject').addEventListener('click', () => {
      const object = selectedObject();
      if (!object) return;
      const removed = descendantsOf(object.id);
      activeScene().objects = activeObjects().filter(item => !removed.has(item.id));
      selectedId = activeObjects()[0]?.id || null;
      renderHierarchy();
      renderInspector();
      scheduleRender();
    });
    $('#attachScript').addEventListener('click', () => {
      const object = selectedObject();
      const scriptId = $('#scriptAttachSelect').value;
      if (!object || !scriptId || object.scriptIds.includes(scriptId)) return;
      object.scriptIds.push(scriptId);
      try { model.validateProject(project); }
      catch (error) {
        object.scriptIds.pop();
        message(error.message);
        return;
      }
      renderInspector();
    });
    $('#newScript').addEventListener('click', () => {
      let name = 'New Script';
      let suffix = 2;
      while (project.scripts.some(script => script.name === name))
        name = `New Script ${suffix++}`;
      const script = model.createScript(name);
      project.scripts.push(script);
      const object = selectedObject();
      if (object) object.scriptIds.push(script.id);
      renderScriptLibrary();
      renderInspector();
      openScriptEditor(script.id);
    });
    $('#saveScript').addEventListener('click', () => {
      const script = project.scripts.find(item => item.id === editingScriptId);
      if (!script) return;
      const previous = { name: script.name, source: script.source };
      script.name = $('#scriptName').value.trim();
      script.source = $('#scriptSource').value;
      try { model.validateProject(project); }
      catch (error) {
        script.name = previous.name;
        script.source = previous.source;
        $('#scriptError').textContent = error.message;
        return;
      }
      renderScriptLibrary();
      renderInspector();
      scriptDialog.close();
      setStatus(`Saved reusable script ${script.name}`);
    });
    $('#deleteScript').addEventListener('click', () => {
      const script = project.scripts.find(item => item.id === editingScriptId);
      if (!script || !confirm(`Delete "${script.name}" and detach it from every object?`)) return;
      project.scripts = project.scripts.filter(item => item.id !== script.id);
      for (const object of allObjects())
        object.scriptIds = object.scriptIds.filter(id => id !== script.id);
      editingScriptId = null;
      scriptDialog.close();
      renderScriptLibrary();
      renderInspector();
      setStatus(`Deleted reusable script ${script.name}`);
    });
    scriptDialog.addEventListener('close', () => { editingScriptId = null; });
    $('#generateScript').addEventListener('click', () => {
      try {
        if (!scriptGenerator) throw new Error('The offline script generator did not load.');
        const result = scriptGenerator.generateScript($('#scriptPrompt').value, project, activeSceneId);
        if ($('#scriptSource').value.trim() &&
            !confirm('Replace the current script source with generated GLSL?')) return;
        if (/^New Script(?: \d+)?$/.test($('#scriptName').value.trim()))
          $('#scriptName').value = result.name;
        $('#scriptSource').value = result.source;
        $('#generatorMessage').className = 'success';
        $('#generatorMessage').textContent =
          `Generated "${result.name}". Review the GLSL, then save the script.`;
      } catch (error) {
        $('#generatorMessage').className = '';
        $('#generatorMessage').textContent = error.message;
      }
    });

    let reviewedProjectPlan = null;
    let promptContextProject = null;
    let promptSceneId = null;
    let promptSelectedId = null;
    let draggingPlanIndex = null;

    function promptMode() { return $('#projectPromptMode').value; }

    function refreshPlanAnalysis() {
      if (!reviewedProjectPlan) return;
      const analysis = projectGenerator.analyzePieces(reviewedProjectPlan, scriptGenerator, model,
        promptContextProject, promptSceneId, promptSelectedId);
      analysis.forEach((step, index) => {
        const current = reviewedProjectPlan[index];
        for (const key of Object.keys(current)) delete current[key];
        Object.assign(current, step);
      });
    }

    function updatePlanControls() {
      const hasSteps = Boolean(reviewedProjectPlan?.length);
      $('#addProjectStep').disabled = !hasSteps;
      $('#acceptProjectPlan').disabled = !hasSteps || reviewedProjectPlan.some(step => !step.text.trim());
      $('#acceptProjectPlan').textContent = promptMode() === 'new'
        ? 'Create new project from reviewed steps' : 'Apply reviewed changes to current project';
    }

    function renderProjectPlan(focusIndex = -1) {
      const list = $('#projectPlan');
      list.replaceChildren();
      if (!reviewedProjectPlan) { updatePlanControls(); return; }
      reviewedProjectPlan.forEach((step, index) => {
        const item = document.createElement('li');
        item.className = 'project-plan-item';
        item.draggable = true;
        item.dataset.index = String(index);
        const row = document.createElement('div');
        row.className = 'project-plan-heading';
        const heading = document.createElement('strong');
        heading.className = `plan-${step.type}`;
        const splitLabel = step.delimiter === 'prompt' ? 'prompt' :
          `${step.delimiter} ${step.part}/${step.partCount}`;
        heading.textContent = `${step.order}. [${splitLabel}] ${step.summary}`;
        const actions = document.createElement('div');
        actions.className = 'project-plan-actions';
        const button = (label, action, title, disabled = false) => {
          const control = document.createElement('button');
          control.type = 'button';
          control.textContent = label;
          control.title = title;
          control.setAttribute('aria-label', `${title}, step ${index + 1}`);
          control.dataset.planAction = action;
          control.disabled = disabled;
          return control;
        };
        actions.append(button('↑', 'up', 'Move step up', index === 0),
          button('↓', 'down', 'Move step down', index === reviewedProjectPlan.length - 1),
          button('×', 'remove', 'Remove step'));
        row.append(heading, actions);
        const editor = document.createElement('textarea');
        editor.rows = 2;
        editor.maxLength = 6000;
        editor.value = step.text;
        editor.setAttribute('aria-label', `Edit instruction ${index + 1}`);
        editor.title = 'Edit only this instruction; it will not be split again';
        editor.addEventListener('input', () => {
          step.text = editor.value;
          refreshPlanAnalysis();
          heading.textContent = `${step.order}. [${splitLabel}] ${step.summary}`;
          heading.className = `plan-${step.type}`;
          updatePlanControls();
        });
        item.append(row, editor);
        item.addEventListener('dragstart', event => {
          if (event.target.closest('textarea,button')) { event.preventDefault(); return; }
          draggingPlanIndex = index;
          item.classList.add('dragging');
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', String(index));
        });
        item.addEventListener('dragend', () => {
          draggingPlanIndex = null;
          item.classList.remove('dragging');
          list.querySelectorAll('.drag-target').forEach(node => node.classList.remove('drag-target'));
        });
        item.addEventListener('dragover', event => { event.preventDefault(); item.classList.add('drag-target'); });
        item.addEventListener('dragleave', () => item.classList.remove('drag-target'));
        item.addEventListener('drop', event => {
          event.preventDefault();
          item.classList.remove('drag-target');
          const from = draggingPlanIndex ?? Number(event.dataTransfer.getData('text/plain'));
          movePlanStep(from, index);
        });
        list.append(item);
      });
      updatePlanControls();
      if (focusIndex >= 0) list.querySelector(`li[data-index="${focusIndex}"] textarea`)?.focus();
    }

    function movePlanStep(from, to) {
      if (!reviewedProjectPlan || !Number.isInteger(from) || !Number.isInteger(to) ||
          from < 0 || to < 0 || from >= reviewedProjectPlan.length || to >= reviewedProjectPlan.length || from === to) return;
      const [step] = reviewedProjectPlan.splice(from, 1);
      reviewedProjectPlan.splice(to, 0, step);
      refreshPlanAnalysis();
      renderProjectPlan(to);
    }

    $('#projectPlan').addEventListener('click', event => {
      const control = event.target.closest('button[data-plan-action]');
      if (!control || !reviewedProjectPlan) return;
      const item = control.closest('.project-plan-item');
      const index = Number(item.dataset.index);
      const action = control.dataset.planAction;
      if (action === 'up') movePlanStep(index, index - 1);
      else if (action === 'down') movePlanStep(index, index + 1);
      else if (action === 'remove') {
        reviewedProjectPlan.splice(index, 1);
        refreshPlanAnalysis();
        renderProjectPlan(Math.min(index, reviewedProjectPlan.length - 1));
      }
    });

    $('#projectPrompt').addEventListener('input', () => {
      reviewedProjectPlan = null;
      $('#projectPlan').replaceChildren();
      updatePlanControls();
    });
    $('#projectPromptMode').addEventListener('change', () => {
      reviewedProjectPlan = null;
      $('#projectPlan').replaceChildren();
      updatePlanControls();
    });
    $('#reviewProjectPrompt').addEventListener('click', () => {
      try {
        if (!projectGenerator) throw new Error('The offline project generator did not load.');
        const isNew = promptMode() === 'new';
        promptContextProject = isNew ? model.createProject() : project;
        promptSceneId = isNew ? promptContextProject.startupSceneId : activeSceneId;
        promptSelectedId = isNew ? null : selectedId;
        reviewedProjectPlan = projectGenerator.createPlan($('#projectPrompt').value, scriptGenerator,
          model, promptContextProject, promptSceneId, promptSelectedId);
        if (!reviewedProjectPlan.length) throw new Error('Enter a prompt with at least one instruction.');
        renderProjectPlan();
        setStatus(`Reviewed ${reviewedProjectPlan.length} editable prompt steps`);
      } catch (error) {
        reviewedProjectPlan = null;
        $('#projectPlan').replaceChildren();
        const item = document.createElement('li');
        item.className = 'project-plan-empty';
        item.textContent = error.message;
        $('#projectPlan').append(item);
        updatePlanControls();
      }
    });
    $('#addProjectStep').addEventListener('click', () => {
      if (!reviewedProjectPlan) return;
      reviewedProjectPlan.push({ text: '', delimiter: 'manual', part: 1, partCount: 1, path: [] });
      refreshPlanAnalysis();
      renderProjectPlan(reviewedProjectPlan.length - 1);
    });
    $('#acceptProjectPlan').addEventListener('click', () => {
      if (!reviewedProjectPlan || reviewedProjectPlan.some(step => !step.text.trim())) return;
      const isNew = promptMode() === 'new';
      const summary = reviewedProjectPlan.map(step => `${step.order}. ${step.summary}`).join('\n');
      const confirmation = isNew
        ? `Create a new project from these reviewed steps? The current project will be replaced.\n\n${summary}`
        : `Apply these reviewed refinements to the current project? Existing content will be preserved unless a step explicitly changes or deletes it.\n\n${summary}`;
      if (!confirm(confirmation)) return;
      try {
        if (isNew) {
          const generatedProject = projectGenerator.generateProject(reviewedProjectPlan, model, scriptGenerator, 'Generated Project');
          setProject(generatedProject);
          setStatus(`Created new project: ${allObjects().length} object(s), ${project.scripts.length} script(s)`);
        } else {
          const result = projectGenerator.applyPlan(reviewedProjectPlan, project, model, scriptGenerator,
            { sceneId: promptSceneId, selectedId: promptSelectedId });
          const oldSceneId = activeSceneId;
          const nextSceneId = result.project.scenes.some(scene => scene.id === oldSceneId) ? oldSceneId : result.project.startupSceneId;
          setProject(result.project);
          activeSceneId = nextSceneId;
          camera = activeScene().camera;
          selectedId = result.selectedId && activeObjects().some(object => object.id === result.selectedId)
            ? result.selectedId : (activeObjects()[0]?.id || null);
          renderScenes(); renderHierarchy(); renderInspector(); scheduleRender();
          const counts = result.counts;
          setStatus(`Refined project · ${counts.created} added · ${counts.modified} edited · ${counts.removed} removed · ${counts.attached} script(s) attached · ${counts.skipped} note(s) skipped`);
        }
        $('#projectPrompt').value = '';
        reviewedProjectPlan = null;
        promptContextProject = null;
        $('#projectPlan').replaceChildren();
        updatePlanControls();
      } catch (error) { message(`Could not apply prompt plan; no partial project changes were kept: ${error.message}`); }
    });

    function projectPoint(point, width, height) {
      const target = camera.target || [0, 0, 0];
      point = point.map((value, index) => value - target[index]);
      const yaw = camera.yaw, pitch = camera.pitch;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const x = cy * point[0] - sy * point[2];
      const z = sy * point[0] + cy * point[2];
      const y = cp * point[1] - sp * z;
      const depth = camera.distance - (sp * point[1] + cp * z);
      const scale = Math.min(width, height) * .44 / Math.max(1.5, depth);
      return { x: width / 2 + x * scale, y: height / 2 - y * scale, depth, scale };
    }

    function rotateByQuaternion(q, point) {
      const [x, y, z, w] = q;
      const uv = [y * point[2] - z * point[1], z * point[0] - x * point[2], x * point[1] - y * point[0]];
      const uuv = [y * uv[2] - z * uv[1], z * uv[0] - x * uv[2], x * uv[1] - y * uv[0]];
      return point.map((value, i) => value + 2 * (w * uv[i] + uuv[i]));
    }

    function renderScene() {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * ratio));
      const height = Math.max(1, Math.floor(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const w = rect.width, h = rect.height;
      context.clearRect(0, 0, w, h);
      context.lineWidth = 1;

      for (let i = -10; i <= 10; i++) {
        const xLine = [projectPoint([i, 0, -10], w, h), projectPoint([i, 0, 10], w, h)];
        const zLine = [projectPoint([-10, 0, i], w, h), projectPoint([10, 0, i], w, h)];
        context.strokeStyle = i === 0 ? '#bd5d64' : '#263647';
        context.beginPath(); context.moveTo(xLine[0].x, xLine[0].y); context.lineTo(xLine[1].x, xLine[1].y); context.stroke();
        context.strokeStyle = i === 0 ? '#548ad1' : '#263647';
        context.beginPath(); context.moveTo(zLine[0].x, zLine[0].y); context.lineTo(zLine[1].x, zLine[1].y); context.stroke();
      }
      const worlds = model.worldTransforms(activeScene());
      const drawables = activeObjects().map(object => ({ object, world: worlds.get(object.id) }))
        .sort((a, b) => projectPoint(a.world.position, w, h).depth - projectPoint(b.world.position, w, h).depth);
      for (const { object, world } of drawables) drawObject(object, world, w, h);
      drawAxes(w, h);
    }

    function drawObject(object, world, width, height) {
      const center = projectPoint(world.position, width, height);
      const selected = object.id === selectedId;
      if (object.kind === 'audio') {
        const radius = Math.max(5, center.scale * .32);
        context.strokeStyle = selected ? '#f5dc8c' : '#d1a342';
        context.fillStyle = '#d1a34222';
        context.beginPath(); context.arc(center.x, center.y, radius, 0, Math.PI * 2); context.fill(); context.stroke();
        context.beginPath(); context.arc(center.x, center.y, radius * .55, -.9, .9); context.stroke();
      } else if (object.kind === 'mesh' && object.primitive === 'sphere') {
        const projectLocal = point => {
          const scaled = point.map((value, i) => value * world.scale[i]);
          const rotated = rotateByQuaternion(world.rotation, scaled);
          return projectPoint(world.position.map((value, i) => value + rotated[i]), width, height);
        };
        context.strokeStyle = object.color;
        context.lineWidth = selected ? 2 : 1;
        for (let ring = -3; ring <= 3; ring++) {
          const latitude = ring * Math.PI / 8;
          context.beginPath();
          for (let segment = 0; segment <= 24; segment++) {
            const angle = segment / 24 * Math.PI * 2;
            const point = projectLocal([Math.cos(latitude) * Math.cos(angle),
              Math.sin(latitude), Math.cos(latitude) * Math.sin(angle)]);
            if (segment) context.lineTo(point.x, point.y); else context.moveTo(point.x, point.y);
          }
          context.stroke();
        }
        for (let meridian = 0; meridian < 6; meridian++) {
          const angle = meridian / 6 * Math.PI;
          context.beginPath();
          for (let segment = 0; segment <= 16; segment++) {
            const latitude = (segment / 16 - .5) * Math.PI;
            const point = projectLocal([Math.cos(latitude) * Math.cos(angle),
              Math.sin(latitude), Math.cos(latitude) * Math.sin(angle)]);
            if (segment) context.lineTo(point.x, point.y); else context.moveTo(point.x, point.y);
          }
          context.stroke();
        }
      } else {
        const half = object.kind === 'sprite' || object.primitive === 'plane'
          ? [[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]]
          : [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
        const points = half.map(point => {
          const scaled = point.map((value, i) => value * world.scale[i]);
          const rotated = rotateByQuaternion(world.rotation, scaled);
          return projectPoint(world.position.map((value, i) => value + rotated[i]), width, height);
        });
        const faces = object.kind === 'sprite' || object.primitive === 'plane'
          ? [[0,1,2,3]] : [[0,1,2,3],[4,7,6,5],[0,4,5,1],[3,2,6,7],[1,5,6,2],[0,3,7,4]];
        context.lineWidth = selected ? 2 : 1;
        for (const face of faces) {
          context.beginPath();
          face.forEach((index, i) => i ? context.lineTo(points[index].x, points[index].y) :
            context.moveTo(points[index].x, points[index].y));
          context.closePath();
          context.fillStyle = `${object.color}${selected ? '26' : '12'}`;
          context.strokeStyle = object.color;
          context.fill(); context.stroke();
        }
        if (object.kind === 'sprite' && object.assetId) {
          const asset = project.assets.find(item => item.id === object.assetId && item.preview);
          if (asset) {
            let image = imageCache.get(asset.id);
            if (!image) {
              image = new Image();
              image.onload = scheduleRender;
              image.src = asset.preview;
              imageCache.set(asset.id, image);
            }
            if (image.complete) context.drawImage(image, points[0].x, points[0].y,
              points[2].x - points[0].x, points[2].y - points[0].y);
          }
        }
      }
      context.fillStyle = selected ? '#ffffff' : object.color;
      context.font = '11px Segoe UI, sans-serif';
      context.fillText(object.name, center.x + 8, center.y - 7);
      if (selected) {
        context.strokeStyle = '#ffffff88';
        context.beginPath(); context.arc(center.x, center.y, 13, 0, Math.PI * 2); context.stroke();
      }
    }

    function drawAxes(width, height) {
      const origin = projectPoint([0, 0, 0], width, height);
      for (const [point, color] of [[[1.5,0,0],'#ff7777'],[[0,1.5,0],'#7bdd8b'],[[0,0,1.5],'#7caaff']]) {
        const end = projectPoint(point, width, height);
        context.strokeStyle = color; context.lineWidth = 2;
        context.beginPath(); context.moveTo(origin.x, origin.y); context.lineTo(end.x, end.y); context.stroke();
      }
    }

    function addDraggedType(kind, x, y) {
      const object = addObject(kind, null);
      if (!object) return;
      const width = canvas.clientWidth, height = canvas.clientHeight;
      const center = projectPoint([0, 0, 0], width, height);
      const position = model.cameraPlaneDelta(camera, x - center.x, y - center.y,
        center.depth, width, height);
      [object.transform.x, object.transform.y, object.transform.z] = position;
      renderInspector();
      scheduleRender();
    }

    function panCamera(dx, dy, width, height) {
      const delta = model.cameraPlaneDelta(camera, dx, dy, camera.distance, width, height);
      camera.target = camera.target || [0, 0, 0];
      camera.target = camera.target.map((value, index) => value - delta[index]);
      activeScene().camera = camera;
      scheduleRender();
    }

    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('pointerdown', event => {
      canvas.focus();
      canvas.setPointerCapture(event.pointerId);
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      if (event.button === 2) {
        pointerAction = { mode: 'pan', x, y };
        event.preventDefault();
        return;
      }
      const worlds = model.worldTransforms(project);
      let hit = null, nearest = 24;
      for (const object of activeObjects()) {
        const point = projectPoint(worlds.get(object.id).position, rect.width, rect.height);
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance < nearest) { hit = object; nearest = distance; }
      }
      if (hit) {
        selectObject(hit.id);
        pointerAction = { mode: 'move', id: hit.id, x, y };
      } else pointerAction = { mode: 'orbit', x, y };
    });
    canvas.addEventListener('pointermove', event => {
      if (!pointerAction) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      const dx = x - pointerAction.x, dy = y - pointerAction.y;
      if (pointerAction.mode === 'pan') {
        panCamera(dx, dy, rect.width, rect.height);
      } else if (pointerAction.mode === 'orbit') {
        camera.yaw += dx * .008;
        camera.pitch = Math.max(-1.25, Math.min(1.25, camera.pitch + dy * .006));
      } else {
        const object = activeObjects().find(item => item.id === pointerAction.id);
        if (object) {
          const worlds = model.worldTransforms(project);
          const center = projectPoint(worlds.get(object.id).position, rect.width, rect.height);
          const worldDelta = model.cameraPlaneDelta(camera, dx, dy, center.depth, rect.width, rect.height);
          const parentWorld = object.parentId ? worlds.get(object.parentId) : null;
          const localDelta = model.worldDeltaToParentLocal(parentWorld, worldDelta);
          object.transform.x += localDelta[0];
          object.transform.y += localDelta[1];
          object.transform.z += localDelta[2];
          renderInspector();
        }
      }
      pointerAction.x = x; pointerAction.y = y;
      activeScene().camera = camera;
      scheduleRender();
    });
    canvas.addEventListener('pointerup', () => { pointerAction = null; });
    canvas.addEventListener('pointercancel', () => { pointerAction = null; });
    canvas.addEventListener('keydown', event => {
      const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      panCamera(-direction[0] * 28, -direction[1] * 28, rect.width, rect.height);
    });
    canvas.addEventListener('wheel', event => {
      camera.distance = Math.max(3, Math.min(30, camera.distance + Math.sign(event.deltaY) * .7));
      activeScene().camera = camera;
      scheduleRender();
      event.preventDefault();
    }, { passive: false });

    for (const button of document.querySelectorAll('[data-create]')) {
      button.addEventListener('click', () => addObject(button.dataset.create));
      button.addEventListener('dragstart', event => event.dataTransfer.setData('application/x-abi1-kind', button.dataset.create));
    }
    $('#addRoot').addEventListener('click', () => {
      addObject('mesh');
    });
    $('#viewport').addEventListener('dragover', event => event.preventDefault());
    $('#viewport').addEventListener('drop', async event => {
      event.preventDefault();
      const kind = event.dataTransfer.getData('application/x-abi1-kind');
      const rect = canvas.getBoundingClientRect();
      if (kind) addDraggedType(kind, event.clientX - rect.left, event.clientY - rect.top);
      const files = Array.from(event.dataTransfer.files);
      if (!files.length) {
        for (const item of event.dataTransfer.items || []) {
          if (item.kind !== 'file') continue;
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      await importFiles(files);
    });
    $('#importAudio').addEventListener('click', () => $('#audioFiles').click());
    $('#audioFiles').addEventListener('change', async event => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      await importFiles(files);
    });

    function bytesToBase64(bytes) {
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk)
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      return btoa(binary);
    }

    async function imageAsset(file) {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 1_000_000) throw new Error('Image exceeds 1 megapixel');
      const surface = document.createElement('canvas');
      surface.width = bitmap.width; surface.height = bitmap.height;
      const ctx = surface.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      return { id: assetId(), kind: 'image', name: file.name, width: bitmap.width,
        height: bitmap.height, rgbaBytes: rgba.byteLength, data: bytesToBase64(rgba),
        preview: surface.toDataURL('image/png') };
    }

    async function audioAsset(file) {
      if (!window.Abi1AudioDecoder)
        throw new Error('The offline audio decoder did not load');
      const pcm = await window.Abi1AudioDecoder.decodeAudioFile(file);
      return { id: assetId(), kind: 'audio', name: file.name, data: bytesToBase64(pcm) };
    }

    async function importAsset(file) {
      if (project.assets.length >= 48) throw new Error('A project can contain at most 48 assets');
      if (allObjects().length >= 48) throw new Error('A project can contain at most 48 objects across all scenes');
      let object, asset;
      if (file.type.startsWith('image/') || /\.(png|jpe?g)$/i.test(file.name)) {
        asset = await imageAsset(file);
        project.assets.push(asset);
        object = addObject('sprite', null, file.name.replace(/\.[^.]+$/, ''));
      } else if (file.type.startsWith('audio/') || /\.(wav|mp3|flac|ogg|m4a|aac|opus)$/i.test(file.name)) {
        asset = await audioAsset(file);
        project.assets.push(asset);
        object = addObject('audio', null, file.name.slice(0, 64));
        asset.eventId = object.audioEventId;
      } else if (file.type === 'model/obj' || /\.obj$/i.test(file.name)) {
        if (file.size > 8 * 1024 * 1024) throw new Error('OBJ file exceeds 8 MiB');
        asset = { id: assetId(), kind: 'mesh', name: file.name, data: bytesToBase64(new Uint8Array(await file.arrayBuffer())) };
        project.assets.push(asset);
        object = addObject('mesh', null, file.name.replace(/\.[^.]+$/, ''));
        object.assetId = asset.id;
        object.primitive = 'box';
        setStatus('OBJ imported. Triangular geometry is rendered in the editor preview and exported ABI-1 apps.');
      } else throw new Error('Supported drops are PNG/JPG, OBJ, and audio files');
      object.assetId = asset.id;
      renderInspector();
      renderHierarchy();
      scheduleRender();
      setStatus(`Imported ${file.name}`);
    }

    async function importFiles(files) {
      const errors = [];
      for (const file of files) {
        try { await importAsset(file); }
        catch (error) { errors.push(`${file.name}: ${error.message}`); }
      }
      if (errors.length) message(errors.join('; '));
    }

    function download(filename, contents, type = 'application/json') {
      const url = URL.createObjectURL(new Blob([contents], { type }));
      const link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    const musicDialog = $('#musicDialog');
    const music = window.Abi1Music;
    let musicProject = music.createSeededMusic('studio-starter');
    let selectedMelodyId = musicProject.melodies[0].id;
    let selectedPatternId = musicProject.patterns[0].id;
    let selectedMusicTrackId = musicProject.tracks[0].id;
    let musicPlayback = null, musicIdCounter = 0;
    const musicStatus = text => { $('#musicStatus').textContent = text; };
    const selectedMelody = () => musicProject.melodies.find(item => item.id === selectedMelodyId);
    const selectedPattern = () => musicProject.patterns.find(item => item.id === selectedPatternId);
    const selectedMusicTrack = () => musicProject.tracks.find(item => item.id === selectedMusicTrackId);
    function musicId(prefix) {
      let id;
      do { id = `${prefix}-${Date.now().toString(36)}-${(++musicIdCounter).toString(36)}`; }
      while ([...musicProject.melodies, ...musicProject.patterns, ...musicProject.tracks].some(item => item.id === id));
      return id;
    }
    function commitMusicFields() {
      musicProject.title = $('#musicTitle').value.trim() || 'Untitled Music';
      musicProject.bpm = Math.max(20, Math.min(300, Number($('#musicTempo').value) || 120));
      const melody = selectedMelody();
      if (melody) { melody.name = $('#melodyName').value.trim() || 'Melody'; melody.source = $('#musicMml').value; }
      const pattern = selectedPattern(); if (pattern) pattern.name = $('#patternName').value.trim() || 'Pattern';
    }
    function renderMusicEditor() {
      $('#musicTitle').value = musicProject.title; $('#musicTempo').value = musicProject.bpm;
      if (!musicProject.melodies.some(m => m.id === selectedMelodyId)) selectedMelodyId = musicProject.melodies[0]?.id || '';
      if (!musicProject.patterns.some(p => p.id === selectedPatternId)) selectedPatternId = musicProject.patterns[0]?.id || '';
      if (!musicProject.tracks.some(t => t.id === selectedMusicTrackId)) selectedMusicTrackId = musicProject.tracks[0]?.id || '';
      const fill = (select, items, selected, label) => { select.replaceChildren(); items.forEach(item => select.add(new Option(label(item), item.id))); select.value = selected; };
      fill($('#melodySelect'), musicProject.melodies, selectedMelodyId, m => `${m.name} (${m.id})`);
      fill($('#patternMelodyChoice'), musicProject.melodies, musicProject.melodies[0]?.id || '', m => m.name);
      fill($('#patternSelect'), musicProject.patterns, selectedPatternId, p => `${p.name} (${p.id})`);
      fill($('#musicTrack'), musicProject.tracks, selectedMusicTrackId, t => `${t.name}${t.type === 'audio' ? ' [audio]' : ''}`);
      const melody = selectedMelody(); $('#melodyName').value = melody?.name || ''; $('#musicMml').value = melody?.source || '';
      $('#removeMelody').disabled = !melody || musicProject.melodies.length <= 1;
      const melodyChoice = $('#patternMelodyChoice');
      melodyChoice.replaceChildren();
      musicProject.melodies.forEach(item => melodyChoice.add(new Option(item.name, item.id)));
      const pattern = selectedPattern(); $('#patternName').value = pattern?.name || '';
      $('#removePattern').disabled = !pattern || musicProject.patterns.length <= 1;
      const steps = $('#patternSteps'); steps.replaceChildren();
      for (let index = 0; index < (pattern?.steps.length || 0); index++) {
        const step = pattern.steps[index], item = document.createElement('li'); item.className = 'music-list-item';
        const title = document.createElement('strong'); title.textContent = `${index + 1}. ${musicProject.melodies.find(m => m.id === step.melodyId)?.name || step.melodyId}`;
        const delta = document.createElement('label'); delta.textContent = 'Δ semitones';
        const input = document.createElement('input'); input.type = 'number'; input.min = '-48'; input.max = '48'; input.value = step.delta; input.setAttribute('aria-label', `Step ${index + 1} pitch delta`);
        input.addEventListener('change', () => { step.delta = Number(input.value) || 0; }); delta.append(input);
        const repeat = document.createElement('label'); repeat.textContent = 'Repeat';
        const repeatInput = document.createElement('input'); repeatInput.type = 'number'; repeatInput.min = '1'; repeatInput.max = '64'; repeatInput.value = step.repeat; repeatInput.setAttribute('aria-label', `Step ${index + 1} repeat`);
        repeatInput.addEventListener('change', () => { step.repeat = Math.max(1, Math.min(64, Number(repeatInput.value) || 1)); }); repeat.append(repeatInput);
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.addEventListener('click', () => { pattern.steps.splice(index, 1); renderMusicEditor(); });
        item.append(title, delta, repeat, remove); steps.append(item);
      }
      const track = selectedMusicTrack(), calls = $('#trackCalls'); calls.replaceChildren();
      if (track?.type === 'audio') {
        const note = document.createElement('p'); note.className = 'music-help'; note.textContent = `Imported audio clip: ${track.name} (${track.mime}). This source is stored once and retained in ABIM.`; calls.append(note);
        const label = document.createElement('label'); label.className = 'audio-start'; label.textContent = 'Audio start beat'; const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.step = '0.25'; input.value = track.startBeat; input.addEventListener('change', () => { track.startBeat = Math.max(0, Number(input.value) || 0); }); label.append(input); calls.append(label);
      } else if (track) {
        track.clips.forEach((clip, index) => {
          const row = document.createElement('div'); row.className = 'music-list-item';
          const ref = clip.kind === 'melody' ? musicProject.melodies.find(m => m.id === clip.ref) : musicProject.patterns.find(p => p.id === clip.ref);
          const title = document.createElement('strong'); title.textContent = `${clip.kind}: ${ref?.name || clip.ref}`;
          const meta = document.createElement('span'); meta.textContent = `beat ${clip.startBeat} · Δ ${clip.delta} · ×${clip.repeat}`;
          const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.addEventListener('click', () => { track.clips.splice(index, 1); renderMusicEditor(); });
          row.append(title, meta, remove); calls.append(row);
        });
        if (!track.clips.length) calls.textContent = 'No calls yet. Add a melody or pattern call below.';
      }
      updateClipReferences();
    }
    function updateClipReferences() {
      const kind = $('#clipKind').value, select = $('#clipReference'); select.replaceChildren();
      const items = kind === 'melody' ? musicProject.melodies : musicProject.patterns;
      items.forEach(item => select.add(new Option(item.name, item.id)));
    }
    function replaceMusicProject(value) {
      musicProject = music.validateProject(value);
      project.music = musicProject;
      thisApp.project = project;
      selectedMelodyId = musicProject.melodies[0]?.id || '';
      selectedPatternId = musicProject.patterns[0]?.id || '';
      selectedMusicTrackId = musicProject.tracks[0]?.id || '';
      renderMusicEditor();
    }
    document.querySelectorAll('[data-music-tab]').forEach(button => button.addEventListener('click', () => {
      commitMusicFields();
      document.querySelectorAll('[data-music-tab]').forEach(item => item.setAttribute('aria-selected', String(item === button)));
      for (const panel of ['melodies', 'patterns', 'tracks']) $(`#${panel}Pane`).hidden = panel !== button.dataset.musicTab;
      renderMusicEditor();
    }));
    $('#openMusicEditor').addEventListener('click', () => { renderMusicEditor(); musicDialog.showModal(); });
    $('#closeMusicEditor').addEventListener('click', () => musicDialog.close());
    $('#melodySelect').addEventListener('change', () => { commitMusicFields(); selectedMelodyId = $('#melodySelect').value; renderMusicEditor(); });
    $('#patternSelect').addEventListener('change', () => { commitMusicFields(); selectedPatternId = $('#patternSelect').value; renderMusicEditor(); });
    $('#musicTrack').addEventListener('change', () => { commitMusicFields(); selectedMusicTrackId = $('#musicTrack').value; renderMusicEditor(); });
    $('#musicMml').addEventListener('input', () => { if (selectedMelody()) selectedMelody().source = $('#musicMml').value; });
    $('#melodyName').addEventListener('input', () => { if (selectedMelody()) selectedMelody().name = $('#melodyName').value; });
    $('#patternName').addEventListener('input', () => { if (selectedPattern()) selectedPattern().name = $('#patternName').value; });
    $('#musicTitle').addEventListener('input', () => { musicProject.title = $('#musicTitle').value; });
    $('#musicTempo').addEventListener('change', () => { musicProject.bpm = Math.max(20, Math.min(300, Number($('#musicTempo').value) || 120)); });
    $('#addMelody').addEventListener('click', () => {
      commitMusicFields(); const melody = { id: musicId('melody'), name: `Melody ${musicProject.melodies.length + 1}`, source: `t${musicProject.bpm} o4 l8 c e g c5` };
      musicProject.melodies.push(melody); selectedMelodyId = melody.id; renderMusicEditor(); musicStatus('Added reusable melody.');
    });
    $('#removeMelody').addEventListener('click', () => {
      commitMusicFields(); const melody = selectedMelody(); if (!melody || musicProject.melodies.length <= 1) return;
      if (musicProject.patterns.some(p => p.steps.some(s => s.melodyId === melody.id)) || musicProject.tracks.some(t => t.type === 'sequence' && t.clips.some(c => c.kind === 'melody' && c.ref === melody.id))) return musicStatus('This melody is still called by a pattern or track. Remove those references first.');
      musicProject.melodies = musicProject.melodies.filter(m => m.id !== melody.id); selectedMelodyId = musicProject.melodies[0].id; renderMusicEditor();
    });
    $('#addPattern').addEventListener('click', () => {
      commitMusicFields(); const pattern = { id: musicId('pattern'), name: `Pattern ${musicProject.patterns.length + 1}`, steps: [] };
      musicProject.patterns.push(pattern); selectedPatternId = pattern.id; renderMusicEditor(); musicStatus('Added pattern. Use Add melody step to reference shared melodies with transposition deltas.');
    });
    $('#removePattern').addEventListener('click', () => {
      commitMusicFields(); const pattern = selectedPattern(); if (!pattern || musicProject.patterns.length <= 1) return;
      if (musicProject.tracks.some(t => t.type === 'sequence' && t.clips.some(c => c.kind === 'pattern' && c.ref === pattern.id))) return musicStatus('This pattern is called by a track. Remove those calls first.');
      musicProject.patterns = musicProject.patterns.filter(p => p.id !== pattern.id); selectedPatternId = musicProject.patterns[0].id; renderMusicEditor();
    });
    $('#addPatternStep').addEventListener('click', () => {
      const pattern = selectedPattern(), melodyId = $('#patternMelodyChoice').value; if (!pattern || !melodyId) return musicStatus('Add a melody before adding pattern steps.');
      pattern.steps.push({ melodyId, delta: Math.max(-48, Math.min(48, Number($('#patternDelta').value) || 0)), repeat: 1 }); renderMusicEditor();
    });
    $('#clipKind').addEventListener('change', updateClipReferences);
    $('#addMusicTrack').addEventListener('click', () => {
      commitMusicFields(); if (musicProject.tracks.length >= 64) return musicStatus('A music file can contain at most 64 tracks.');
      const track = { type: 'sequence', id: musicId('track'), name: `Track ${musicProject.tracks.length + 1}`, clips: [] };
      musicProject.tracks.push(track); selectedMusicTrackId = track.id; renderMusicEditor();
    });
    $('#removeMusicTrack').addEventListener('click', () => {
      if (musicProject.tracks.length <= 1) return;
      musicProject.tracks = musicProject.tracks.filter(track => track.id !== selectedMusicTrackId); selectedMusicTrackId = musicProject.tracks[0].id; renderMusicEditor();
    });
    $('#addTrackCall').addEventListener('click', () => {
      const track = selectedMusicTrack(), ref = $('#clipReference').value;
      if (!track || track.type !== 'sequence' || !ref) return musicStatus('Select a sequence track and a melody or pattern to call.');
      track.clips.push({ kind: $('#clipKind').value, ref, startBeat: Math.max(0, Number($('#clipStart').value) || 0), delta: Math.max(-48, Math.min(48, Number($('#clipDelta').value) || 0)), repeat: Math.max(1, Math.min(64, Number($('#clipRepeat').value) || 1)) });
      renderMusicEditor(); musicStatus('Added a reference call. Melody/pattern source remains stored once.');
    });
    $('#saveAbim').addEventListener('click', () => {
      try { commitMusicFields(); const text = music.encodeAbim(musicProject); download(`${musicProject.title.replace(/[^a-z0-9_-]+/gi, '-') || 'music'}.abim`, text, 'application/x-abim+json'); musicStatus(`Saved ${musicProject.melodies.length} melody(s), ${musicProject.patterns.length} pattern(s), and ${musicProject.tracks.length} track(s) as ABIM.`); }
      catch (error) { musicStatus(error.message); }
    });
    $('#loadMusicFile').addEventListener('click', () => $('#musicFile').click());
    $('#musicFile').addEventListener('change', async event => {
      const file = event.target.files[0]; event.target.value = ''; if (!file) return;
      try {
        commitMusicFields();
        if (/\.abim$/i.test(file.name)) {
          replaceMusicProject(music.decodeAbim(await file.text())); musicStatus(`Loaded ${musicProject.title} from ABIM: ${musicProject.melodies.length} melody(s), ${musicProject.patterns.length} pattern(s).`);
        } else if (/\.(mid|midi)$/i.test(file.name) || /midi/i.test(file.type)) {
          if (file.size > 16 * 1024 * 1024) throw new Error('MIDI file exceeds the 16 MiB import limit.');
          const imported = music.importMidi(new Uint8Array(await file.arrayBuffer()));
          imported.title = file.name.replace(/\.[^.]+$/, '').slice(0, 128) || 'Imported MIDI'; replaceMusicProject(imported); musicStatus(`Imported MIDI as ${musicProject.melodies.length} reusable melody(s) on ${musicProject.tracks.length} track(s).`);
        } else {
          const audioTrack = await music.decodeAudioFile(file);
          if (musicProject.tracks.length >= 64) throw new Error('A music file can contain at most 64 tracks.');
          audioTrack.id = musicId('audio'); audioTrack.startBeat = Math.max(0, Number($('#clipStart').value) || 0);
          musicProject.tracks.push(audioTrack); selectedMusicTrackId = audioTrack.id; renderMusicEditor();
          musicStatus(`Imported ${file.name} as an audio clip. It is retained in ABIM and mixed into MP3 exports; audio is not transcribed to notes.`);
        }
      } catch (error) { musicStatus(`Import failed: ${error.message}`); }
    });
    $('#exportMidi').addEventListener('click', () => {
      try { commitMusicFields(); const bytes = music.exportMidi(musicProject); download(`${musicProject.title.replace(/[^a-z0-9_-]+/gi, '-') || 'music'}.mid`, bytes, 'audio/midi'); musicStatus('Exported Standard MIDI (.mid). Imported audio clips are not represented in MIDI.'); }
      catch (error) { musicStatus(`MIDI export failed: ${error.message}`); }
    });
    $('#exportMp3').addEventListener('click', async () => {
      const button = $('#exportMp3'); button.disabled = true;
      try { commitMusicFields(); musicStatus('Rendering and encoding MP3…'); const blob = await music.exportMp3(musicProject); download(`${musicProject.title.replace(/[^a-z0-9_-]+/gi, '-') || 'music'}.mp3`, blob, 'audio/mpeg'); musicStatus('Exported MP3 audio.'); }
      catch (error) { musicStatus(`MP3 export failed: ${error.message}`); }
      finally { button.disabled = false; }
    });
    $('#playMusic').addEventListener('click', async () => {
      try { commitMusicFields(); music.validateProject(musicProject); $('#playMusic').disabled = true; $('#stopMusic').disabled = false; musicPlayback = await music.play(musicProject, musicStatus); musicPlayback.done.finally(() => { musicPlayback = null; $('#playMusic').disabled = false; $('#stopMusic').disabled = true; }); }
      catch (error) { $('#playMusic').disabled = false; $('#stopMusic').disabled = true; musicStatus(`Playback failed: ${error.message}`); }
    });
    $('#stopMusic').addEventListener('click', () => { if (musicPlayback) musicPlayback.stop(); musicPlayback = null; $('#playMusic').disabled = false; $('#stopMusic').disabled = true; });
    musicDialog.addEventListener('close', () => { if (musicPlayback) { musicPlayback.stop(); musicPlayback = null; $('#playMusic').disabled = false; $('#stopMusic').disabled = true; } });
    $('#downloadBuild').addEventListener('click', () => {
      if (!pendingDownload) return;
      download(pendingDownload.filename, pendingDownload.bytes, 'application/zip');
      setStatus(`Downloaded ${pendingDownload.filename}`);
      pendingDownload = null;
      $('#downloadBuild').hidden = true;
    });

    function projectFilename() {
      const safe = (project.app.id || 'my-gpu-app').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
      return `${safe || 'my-gpu-app'}.hblproj`;
    }

    $('#sceneSelect').addEventListener('change', event => {
      selectScene(Number(event.target.value));
      setStatus(`Editing ${activeScene().name}`);
    });
    for (const input of document.querySelectorAll('[data-camera-transform]'))
      input.addEventListener('input', () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        activeScene().camera.transform[input.dataset.cameraTransform] = value;
        setStatus(`Runtime camera ${input.dataset.cameraTransform} updated`);
      });
    $('#addScene').addEventListener('click', () => {
      if (project.scenes.length >= 48) return message('A project can contain at most 48 scenes.');
      const id = project.nextSceneId;
      if (id > 65535) return message('The project has reached its scene ID limit.');
      project.nextSceneId++;
      const scene = model.createScene(id, `Scene ${id}`);
      project.scenes.push(scene);
      selectScene(scene.id);
      setStatus(`Created ${scene.name}`);
    });
    $('#renameScene').addEventListener('click', () => {
      const scene = activeScene();
      const name = window.prompt('Scene name', scene.name);
      if (name === null) return;
      const previousName = scene.name;
      scene.name = name.trim();
      try { model.validateProject(project); }
      catch (error) {
        scene.name = previousName;
        return message(error.message);
      }
      renderScenes();
      setStatus(`Renamed scene to ${scene.name}`);
    });
    $('#deleteScene').addEventListener('click', () => {
      if (project.scenes.length === 1) return message('A project must contain at least one scene.');
      const removed = activeScene();
      const removedIndex = project.scenes.indexOf(removed);
      project.scenes = project.scenes.filter(scene => scene.id !== removed.id);
      if (project.startupSceneId === removed.id) project.startupSceneId = project.scenes[0].id;
      const next = project.scenes[Math.min(project.scenes.length - 1, removedIndex)];
      selectScene(next.id);
      setStatus(`Deleted ${removed.name}`);
    });
    $('#startupScene').addEventListener('change', event => {
      const scene = project.scenes.find(item => item.id === Number(event.target.value));
      project.startupSceneId = scene.id;
      setStatus(`Startup scene set to ${scene.name}`);
    });

    $('#newProject').addEventListener('click', () => setProject(model.createProject()));
    $('#saveProject').addEventListener('click', () => {
      syncProjectFields();
      download(projectFilename(), JSON.stringify(project, null, 2));
      try {
        localStorage.setItem(projectKey, JSON.stringify(project));
        setStatus('Project saved');
      } catch (error) {
        setStatus(`Project downloaded; browser storage unavailable: ${error.message}`);
      }
    });
    $('#updateCacheButton').addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      setStatus('Saving your project and refreshing Studio files…');
      try {
        syncProjectFields();
        commitMusicFields();
        project.music = music.validateProject(musicProject);
        localStorage.setItem(projectKey, JSON.stringify(project));
      } catch (error) {
        button.disabled = false;
        message(`Update cancelled so your current work is not lost. Save or export the project first. Details: ${error.message}`);
        return;
      }

      const updateToken = Date.now().toString(36);
      const appBase = new URL('.', window.location.href);
      const withUpdateToken = value => {
        const url = new URL(value, window.location.href);
        url.searchParams.set('i', updateToken);
        return url.href;
      };
      const belongsToStudio = value => {
        try {
          const url = new URL(value, window.location.href);
          return url.origin === appBase.origin && url.pathname.startsWith(appBase.pathname);
        } catch { return false; }
      };
      try {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.filter(registration => belongsToStudio(registration.scope))
            .map(registration => registration.unregister()));
        }
        if ('caches' in window) {
          for (const name of await caches.keys()) {
            const cache = await caches.open(name);
            const requests = await cache.keys();
            await Promise.all(requests.filter(request => belongsToStudio(request.url))
              .map(request => cache.delete(request)));
          }
        }
        const freshFiles = new Set([withUpdateToken(new URL(window.location.pathname, window.location.origin).href)]);
        document.querySelectorAll('script[src], link[rel~="stylesheet"][href]').forEach(element => {
          const url = element.src || element.href;
          if (belongsToStudio(url)) freshFiles.add(withUpdateToken(url));
        });
        await Promise.all([...freshFiles].map(async url => {
          try {
            const response = await fetch(url, {
              cache: 'no-store', credentials: 'same-origin',
              headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
            });
            if (!response.ok) console.warn(`Could not refresh ${url}: HTTP ${response.status}`);
            else await response.arrayBuffer();
          } catch (error) {
            console.warn(`Could not pre-refresh ${url}; reloading with a fresh URL instead:`, error.message);
          }
        }));
      } catch (error) {
        console.warn('App cache cleanup was partially unavailable; continuing with a cache-busted reload:', error.message);
      }

      const reloadUrl = new URL(window.location.href);
      reloadUrl.searchParams.set('i', updateToken);
      window.history.replaceState(null, '', reloadUrl.href);
      window.location.reload();
    });
    const seedInput = $('#projectSeedInput');
    const seedStatus = $('#projectSeedStatus');
    const seedTools = window.Abi1ProjectSeeds;
    $('#generateSeedProject').addEventListener('click', () => {
      try {
        const text = seedInput.value.trim();
        if (!text) throw new Error('Enter a short seed or a project prompt first.');
        const isEncoded = seedTools.isProjectSeed(text);
        let nextProject;
        let reportedSeed = text;
        if (isEncoded) {
          throw new Error('This looks like a full project seed; use Import Seed to restore it exactly.');
        } else if (seedTools.isShortSeed(text)) {
          reportedSeed = text.toLowerCase();
          nextProject = seedTools.generateProject(reportedSeed, model, scriptGenerator);
        } else {
          reportedSeed = seedTools.deriveSeedFromPrompt(text);
          nextProject = seedTools.createFromPrompt(text, reportedSeed, model,
            window.Abi1ProjectGenerator, scriptGenerator);
          seedInput.value = reportedSeed;
        }
        if (!confirm(`Replace the open project with a deterministic project generated from seed ${reportedSeed}?`)) return;
        setProject(nextProject);
        seedStatus.textContent = `Generated project from seed ${reportedSeed}. Enter the same seed again to reproduce it.`;
        setStatus(`Generated project from seed ${reportedSeed}`);
      } catch (error) {
        seedStatus.textContent = error.message;
        message(`Could not generate project: ${error.message}`);
      }
    });
    $('#importSeedProject').addEventListener('click', async () => {
      try {
        const text = seedInput.value.trim();
        if (!text) throw new Error('Paste a full encoded project seed first.');
        const restored = await seedTools.decodeProject(text, model);
        if (!confirm(`Import “${restored.app.name}” from this project seed and replace the open project?`)) return;
        setProject(restored);
        seedStatus.textContent = `Imported ${restored.app.name} from project seed (${text.length.toLocaleString()} characters).`;
        setStatus(`Imported project seed: ${restored.app.name}`);
      } catch (error) {
        seedStatus.textContent = error.message;
        message(`Could not import project seed: ${error.message}`);
      }
    });
    $('#exportProjectSeed').addEventListener('click', async () => {
      const button = $('#exportProjectSeed');
      button.disabled = true;
      seedStatus.textContent = 'Compressing and encoding the current project…';
      try {
        syncProjectFields();
        model.validateProject(project);
        const seed = await seedTools.encodeProject(project);
        seedInput.value = seed;
        $('#copyProjectSeed').disabled = false;
        download(`${project.app.id || 'project'}.hblseed`, seed, 'text/plain');
        seedStatus.textContent = `Exported exact project seed: ${seed.length.toLocaleString()} characters. Copy/share the seed or keep the downloaded .hblseed file.`;
        setStatus(`Exported project seed (${seed.length.toLocaleString()} characters)`);
      } catch (error) {
        seedStatus.textContent = error.message;
        message(`Could not export project seed: ${error.message}`);
      } finally { button.disabled = false; }
    });
    $('#copyProjectSeed').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(seedInput.value);
        seedStatus.textContent = 'Full project seed copied to clipboard.';
      } catch (_) {
        seedInput.focus(); seedInput.select();
        seedStatus.textContent = 'Clipboard access unavailable; the seed is selected so you can copy it manually.';
      }
    });
    $('#openSeedFile').addEventListener('click', () => $('#projectSeedFile').click());
    $('#projectSeedFile').addEventListener('change', async event => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      try {
        const text = (await file.text()).trim();
        seedInput.value = text;
        const restored = await seedTools.decodeProject(text, model);
        if (!confirm(`Import “${restored.app.name}” from ${file.name} and replace the open project?`)) return;
        setProject(restored);
        seedStatus.textContent = `Imported ${restored.app.name} from ${file.name}.`;
        setStatus(`Imported project seed from ${file.name}`);
      } catch (error) {
        seedStatus.textContent = error.message;
        message(`Could not read project seed: ${error.message}`);
      }
    });

    $('#openProject').addEventListener('click', () => $('#projectFile').click());
    $('#projectFile').addEventListener('change', async event => {
      const file = event.target.files[0];
      if (!file) return;
      try { setProject(JSON.parse(await file.text())); setStatus(`Opened ${file.name}`); }
      catch (error) { message(`Could not open project: ${error.message}`); }
      event.target.value = '';
    });

    function logImportWarning(text) {
      const container = $('#importLogContent');
      if (!container) return;
      if (container.textContent.includes('No imports or warnings yet')) {
        container.replaceChildren();
      }
      const entry = document.createElement('div');
      entry.className = 'import-log-entry';
      entry.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
      container.prepend(entry);
    }

    $('#importProjectBtn').addEventListener('click', () => $('#importProjectFile').click());
    $('#importProjectFile').addEventListener('change', async event => {
      const file = event.target.files[0];
      if (!file) return;
      event.target.value = '';
      try {
        const text = await file.text();
        const { project: imported, warnings } = window.Abi1ProjectImporter.importProject(text, file.name);
        setProject(imported);
        if (warnings && warnings.length) {
          for (const w of warnings) logImportWarning(w);
          message(`Imported ${file.name} with ${warnings.length} warning(s). Check the Import Log & Warnings panel.`);
        } else {
          setStatus(`Successfully imported ${file.name}`);
        }
      } catch (err) {
        message(`Could not import project: ${err.message}`);
        logImportWarning(`Import failed for ${file.name}: ${err.message}`);
      }
    });

    $('#clearImportLog')?.addEventListener('click', () => {
      const container = $('#importLogContent');
      if (container) container.textContent = 'No imports or warnings yet.';
    });
    for (const field of ['appName', 'appId', 'appDescription', 'appVersion'])
      $(`#${field}`).addEventListener('input', () => {
        syncProjectFields();
        if (field === 'appName' || field === 'appId') setStatus('Project settings changed');
      });

    function prefabValue(objectId) {
      const nodes = model.cloneSubtree(activeScene(), objectId, { preserveIds: true });
      const referencedAssets = new Set(nodes.map(object => object.assetId).filter(Boolean));
      const referencedScripts = new Set(nodes.flatMap(object => object.scriptIds));
      return {
        format: 'brendan-abi1-prefab', version: 1, name: nodes[0].name, objects: nodes,
        assets: project.assets.filter(asset => referencedAssets.has(asset.id)),
        scripts: project.scripts.filter(script => referencedScripts.has(script.id)),
        classes: project.classes
      };
    }

    function importPrefab(prefab, name) {
      if (!prefab || prefab.format !== 'brendan-abi1-prefab' || prefab.version !== 1 ||
          !Array.isArray(prefab.objects) || !Array.isArray(prefab.assets))
        throw new Error('Invalid ABI-1 Studio prefab');
      const prefabProject = model.createProject();
      prefabProject.assets = prefab.assets;
      prefabProject.scripts = Array.isArray(prefab.scripts) ? prefab.scripts : [];
      prefabProject.classes = Array.isArray(prefab.classes) ? prefab.classes : [];
      prefabProject.objects = prefab.objects;
      const normalized = model.normalizeProject(prefabProject);
      const idMap = new Map(normalized.objects.map(object => [object.id, model.createObject(object.kind).id]));
      const assetMap = new Map(prefab.assets.map(asset => [asset.id, assetId()]));
      const scriptMap = new Map();
      const newScripts = [];
      for (const script of normalized.scripts) {
        const existing = project.scripts.find(item => item.id === script.id);
        if (existing && existing.name === script.name && existing.source === script.source) {
          scriptMap.set(script.id, existing.id);
          continue;
        }
        const id = existing ? model.createScript().id : script.id;
        scriptMap.set(script.id, id);
        newScripts.push({ ...script, id });
      }
      const classMap = new Map();
      const newClasses = [];
      for (const item of normalized.classes) {
        const existing = project.classes.find(entry =>
          entry.id === item.id && entry.name === item.name && entry.source === item.source);
        if (existing) classMap.set(item.id, existing.id);
        else {
          const id = project.classes.some(entry => entry.id === item.id)
            ? model.createScript().id : item.id;
          classMap.set(item.id, id);
          newClasses.push({ ...item, id });
        }
      }
      const usedEvents = new Set(project.assets.filter(asset => asset.kind === 'audio').map(asset => asset.eventId));
      const eventMap = new Map();
      for (const asset of normalized.assets.filter(item => item.kind === 'audio')) {
        const eventId = Array.from({ length: 31 }, (_, i) => i + 1).find(id => !usedEvents.has(id));
        if (!eventId) throw new Error('No unused audio event IDs remain for this prefab');
        usedEvents.add(eventId);
        eventMap.set(asset.id, eventId);
      }
      const newAssets = normalized.assets.map(asset => ({
        ...asset,
        id: assetMap.get(asset.id),
        ...(asset.kind === 'audio' ? { eventId: eventMap.get(asset.id) } : {})
      }));
      const newObjects = normalized.objects.map(object => ({
        ...JSON.parse(JSON.stringify(object)),
        id: idMap.get(object.id),
        parentId: object.parentId ? idMap.get(object.parentId) || null : null,
        assetId: object.assetId ? assetMap.get(object.assetId) || null : null,
        scriptIds: object.scriptIds.map(scriptId => scriptMap.get(scriptId)),
        ...(object.kind === 'audio' && object.assetId && eventMap.has(object.assetId)
          ? { audioEventId: eventMap.get(object.assetId) } : {})
      }));
      if (name) newObjects[0].name = name;
      model.validateProject({
        ...project,
        assets: [...project.assets, ...newAssets],
        scenes: project.scenes.map(scene => scene.id === activeSceneId
          ? { ...scene, objects: [...scene.objects, ...newObjects] } : scene),
        scripts: [...project.scripts, ...newScripts],
        classes: [...project.classes, ...newClasses]
      });
      project.assets.push(...newAssets);
      activeScene().objects.push(...newObjects);
      project.scripts.push(...newScripts);
      project.classes.push(...newClasses);
      selectedId = newObjects[0].id;
      renderHierarchy(); renderInspector(); renderScriptLibrary(); renderClassLibrary(); scheduleRender();
    }

    function prefabs() {
      try { return JSON.parse(localStorage.getItem(prefabsKey) || '[]'); }
      catch { return []; }
    }

    function renderPrefabs() {
      const host = $('#prefabList');
      host.replaceChildren();
      for (const prefab of prefabs()) {
        const row = document.createElement('div'); row.className = 'prefab-entry';
        const add = document.createElement('button'); add.textContent = prefab.name;
        add.addEventListener('click', () => {
          try { importPrefab(prefab); setStatus(`Instantiated ${prefab.name}`); }
          catch (error) { message(error.message); }
        });
        const remove = document.createElement('button'); remove.textContent = '×'; remove.title = 'Remove prefab';
        remove.addEventListener('click', () => {
          try { localStorage.setItem(prefabsKey, JSON.stringify(prefabs().filter(item => item.id !== prefab.id))); }
          catch (error) { message(`Could not remove saved prefab: ${error.message}`); }
          renderPrefabs();
        });
        row.append(add, remove); host.append(row);
      }
    }

    $('#savePrefab').addEventListener('click', () => {
      if (!selectedId) return message('Select an object to save as a prefab.');
      const prefab = prefabValue(selectedId);
      const stored = prefabs();
      prefab.id = assetId();
      stored.push(prefab);
      let storedLocally = true;
      try { localStorage.setItem(prefabsKey, JSON.stringify(stored)); }
      catch (error) { storedLocally = false; setStatus(`Prefab will be downloaded only: ${error.message}`); }
      renderPrefabs();
      download(`${prefab.name.replace(/[^a-z0-9-]/gi, '-')}.hblprefab`, JSON.stringify(prefab, null, 2));
      if (storedLocally) setStatus(`Saved prefab ${prefab.name}`);
    });
    $('#loadPrefab').addEventListener('click', () => $('#prefabFile').click());
    $('#prefabFile').addEventListener('change', async event => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        const prefab = JSON.parse(await file.text());
        importPrefab(prefab);
        setStatus(`Imported prefab ${prefab.name}`);
      } catch (error) { message(`Could not import prefab: ${error.message}`); }
      event.target.value = '';
    });

    $('#exportApp').addEventListener('click', async () => {
      syncProjectFields();
      try {
        model.validateProject(project);
        setStatus('Compiling GLSL shaders and assembling ABI-1 package…');
        $('#exportApp').disabled = true;
        const result = await builder.build(project);
        setStatus(`Built ${result.id} · ${result.sceneCount} scenes · ${result.sceneObjects} objects · ${result.bytes.byteLength} bytes`);
        message(`ABI-1 app is ready as ${result.id}.zip.\n\nDownload it, then extract the contents into a new folder under BrendanLauncher/apps.`);
        pendingDownload = { filename: `${result.id}.zip`, bytes: result.bytes };
        $('#downloadBuild').hidden = false;
      } catch (error) {
        setStatus('Build failed');
        message(error.message);
      } finally { $('#exportApp').disabled = false; }
    });

    $('#previewApp').addEventListener('click', async () => {
      syncProjectFields();
      try {
        model.validateProject(project);
        $('#previewApp').disabled = true;
        setStatus('Starting PC Preview…');
        previewDialog.showModal();
        await preview.start(project);
        $('#previewCanvas').focus();
        setStatus('PC Preview running · close the preview to return to editing');
      } catch (error) {
        preview.stop();
        if (previewDialog.open) previewDialog.close();
        message(`PC Preview failed: ${error.message}`);
      } finally { $('#previewApp').disabled = false; }
    });
    previewDialog.addEventListener('close', () => {
      preview.stop();
      setStatus('PC Preview stopped');
    });

    function resize() { scheduleRender(); }
    new ResizeObserver(resize).observe($('#viewport'));
    renderPrefabs();
    try {
      const saved = localStorage.getItem(projectKey);
      if (saved) setProject(JSON.parse(saved));
      else setProject(project);
    } catch (error) {
      console.warn('Saved ABI-1 Studio project could not be restored:', error.message);
      setProject(project);
    }
  }
}

new Abi1StudioApp();
