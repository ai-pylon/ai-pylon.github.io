

var API = "/v1/apps/platform/appui_guide/";
function api(op, args) {
  return window.AppUIApi.requestResponse(API + op, args || {}, {
    method: "POST", timeout: null, decode: function (response) { return response.json(); }
  }).then(function (result) { return result.data; });
}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function el(tag, attrs, html){var e=document.createElement(tag);if(attrs)Object.keys(attrs).forEach(function(k){e.setAttribute(k,attrs[k]);});if(html!=null)e.innerHTML=html;return e;}
function load(bundle){ return (window.AppUIAssets && AppUIAssets.load) ? AppUIAssets.load(bundle) : Promise.resolve(); }

var app = null;
function setApp(value) { app = value; }
var BUNDLES = {};   // filled ONCE from the bundles op (#22)
var _bundlesP = null;
function bundlesReady() {
  if (!_bundlesP) _bundlesP = api("bundles", {}).then(function (r) {
    if (r && r.ok) BUNDLES = r.bundles || {}; else _bundlesP = null;
    return BUNDLES;
  }, function () { _bundlesP = null; return BUNDLES; });
  return _bundlesP;
}
function btn(label, fn) {
  var b = el("button", { class: "btn sm" }, esc(label));
  b.onclick = function (ev) { try { fn(ev); } catch (e) { if (window.AppUIToast) AppUIToast.error(String(e)); } };
  return b;
}

export { api, esc, el, load, setApp, bundlesReady, btn, app, BUNDLES };
