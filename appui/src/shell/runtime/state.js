/* Shell state helpers: cleanup registry, public-state accessors, dirty-state tracking, history stacks. */

/* Idempotent cleanup registry for shell-owned plugin resources. */
window.AppUIShellCleanup = {
  create() {
    let scope = AppUILifecycle.createScope();
    return {
      track: resource => scope.add(resource),
      runAll() {
        const previous = scope;
        scope = AppUILifecycle.createScope();
        previous.destroy();
      },
    };
  },
};

/* Read-only public shell state accessors. */
window.AppUIShellPublicState = {
  create({elements, regions, pipeline, statusBar, content}) {
    return {
      setTitle(title) { document.title = title; },
      getElement: slot => elements()[slot] || null,
      getRegion: name => regions()[name] || null,
      getPipeline: () => pipeline(),
      getStatusBar: () => statusBar(),
      getContent: () => content(),
    };
  },
};

/* Page dirty-state tracking is independent from layout and lifecycle. */
window.AppUIShellDirtyState = {
  create(getTitle) {
    let dirty = false;
    return {
      set(value = true) {
        dirty = value;
        document.querySelector('.ai-app-save-indicator')?.classList.toggle('ai-app-dirty', dirty);
        const title = getTitle() || document.title.replace(/^\u25cf /, '');
        document.title = dirty ? `\u25cf ${title}` : title;
      },
      get: () => dirty,
    };
  },
};

/* Undo/redo state is independent from shell layout and page lifecycle. */
window.AppUIShellHistory = {
  create(limit = 50) {
    let undoStacks = {}, redoStacks = {};
    return {
      pushUndo(scope, state) { (undoStacks[scope] ||= []).push(state); if (undoStacks[scope].length > limit) undoStacks[scope].shift(); redoStacks[scope] = []; },
      undo(scope) { const stack = undoStacks[scope]; if (!stack?.length) return null; redoStacks[scope] ||= []; return stack.pop(); },
      redo(scope) { const stack = redoStacks[scope]; if (!stack?.length) return null; return stack.pop(); },
      pushRedo(scope, state) { (redoStacks[scope] ||= []).push(state); },
      clear(scope) { if (scope) { delete undoStacks[scope]; delete redoStacks[scope]; } else { undoStacks = {}; redoStacks = {}; } },
    };
  },
};
