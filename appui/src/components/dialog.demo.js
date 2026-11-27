/* Gallery demo for dialog.js - shown by the AppUI Guide (platform/appui_guide) Components gallery.
 * Kept next to the component; the AppUI catalog (framework/appui_catalog.py) finds it by the .demo.js suffix.
 * demo(host, kit) mounts into host and may return a cleanup (function or {destroy}); kit = {el, btn, esc}. */
(function () {
  var kit = window.AppUIDemos.kit, el = kit.el, btn = kit.btn, esc = kit.esc;
  AppUIDemos.register({
    name: "Dialog",
    global: "AppUIDialog",
    what: "Modal dialog, async confirm and job progress via job({submit,getJob,onComplete}); closing progress keeps completion synchronization running.",
    code: "AppUIDialog.show({ title:'Hello', body:'<p>Some content</p>', width:'420px',\n  buttons:[{text:'Close'}] });\nvar ok = await AppUIDialog.confirmAsync('Delete this?', { danger:true });",
    demo: function (host) {
      host.appendChild(btn("show()", function () {
        AppUIDialog.show({ title: "Gallery dialog", body: "<p style='font-size:13px'>This is an AppUIDialog.</p>", width: "420px", buttons: [{ text: "Close" }] });
      }));
      host.appendChild(btn("job()", function () { let ticks=0;AppUIDialog.job({title:'Demo background job',submit:async()=> 'demo',getJob:async()=>({status:++ticks<3?'running':'done',progress:{fraction:ticks/3,detail:'Working step '+ticks},op_result:{ok:true}}),pollInterval:300}); }));
      host.appendChild(btn("confirmAsync()", function () {
        AppUIDialog.confirmAsync("Pretend-delete this item?", { danger: true, confirmText: "Delete" })
          .then(function (ok) { AppUIToast.info("you chose: " + (ok ? "Delete" : "Cancel")); });
      }));
    },
  });
})();
