/* GENERATED AppUI account distribution. Edit src/account/ and rebuild portable artifacts. */
(function () {
  'use strict';
  if (window.AppUIAccount) return;

  var STORE_KEY = 'appui.account.user';
  // The fleet apps. `slug` is the AppForge deploy slug (hyphenated, served at
  // /{owner}/{slug}/); `local` is the LOCAL ai-pylon page path (served at
  // /pages/documents/<app>/). Links are built per-environment (see appHref) so
  // the dialog works on BOTH the local platform and an AppForge deployment —
  // previously it always used the AppForge owner-segment layout, so on the local
  // platform (/pages/documents/<app>/) every link pointed at a non-existent
  // /pages/<slug>/ address.
  var FLEET = [
    { slug: 'sysdoc-editor', local: 'documents/sysdoc_editor', label: 'SysDoc Editor' },
    { slug: 'plantuml-python', local: 'documents/plantuml_python', label: 'PlantUML' },
    { slug: 'issue-report', local: 'documents/issue_report', label: 'Issue tracker' },
    { slug: 'file-storage', local: 'file/file_storage', label: 'File storage' },
    { slug: 'apps-manager', local: 'documents/apps_manager', label: 'Apps manager' }
  ];

  function qsUser() {
    try { return new URLSearchParams(window.location.search).get('user'); } catch (e) { return null; }
  }
  function stored() {
    try { return window.localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }
  // Legacy per-app keys that existing apps already read/write. We bridge them to
  // the canonical key so the account is genuinely SHARED across apps (same
  // origin → shared localStorage) instead of each app diverging to its own id.
  var LEGACY_KEYS = ['sysdoc_fs_user'];
  function legacyStored() {
    for (var i = 0; i < LEGACY_KEYS.length; i++) {
      try { var v = window.localStorage.getItem(LEGACY_KEYS[i]); if (v) return v; } catch (e) { /* ignore */ }
    }
    return null;
  }
