// Section controllers are private native modules (gallery demos live next to each AppUI component).
import('./guide/main.js').catch(function (error) {
  var host = document.getElementById('app-content-body');
  if (host) host.textContent = 'AppUI Guide failed to load: ' + error.message;
});
