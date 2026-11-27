/* GENERATED portable AppUI shim — authored in src/portable-shim/*.js.
 *
 * ⚠️ Vendored into each AppForge target's web/ (as appui-shim.js) via that
 * target's mirror.json. DO NOT edit the per-page copies under
 * pages/documents/<app>/appui-shim.js — edit the framework source parts, run
 * dev/framework/appui/build_artifacts.py, then let the mirror re-vendor it.
 * (Historically each page carried its own copy; they diverged — remote_ws grew
 * the status-log/toast facility the others lacked. This is the superset.)
 *
 * Minimal self-contained AppUI shim.
 *
 * The SysDoc viewer was written against the ai-pylon "AppUI" shell
 * (AppUI.createApp({...})). That shell is a platform asset served from
 * /appui/* by the ai-pylon web server on port 9090 — which does not exist in
 * the single-container AppForge deployment.
 *
 * This shim reimplements ONLY the surface app.js actually uses:
 *   AppUI.createApp({ id, title, leftSidebar:{width,tabs[]}, rightSidebar:{...},
 *                     content:{render(el)}, statusBar:{}, menu:{...}, onAction,
 *                     onReady }) -> { setStatus, toggleLeftSidebar,
 *                                     toggleRightSidebar }
 *
 * It mounts into the region elements the page provides (#app-menubar,
 * #app-left, #app-content, #app-right, #app-statusbar) and keeps the ai-app-*
 * class names the viewer's CSS and menu toggles reference.
 */
(function () {
  'use strict';

