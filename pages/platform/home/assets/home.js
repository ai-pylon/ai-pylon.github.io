// Private controllers share explicit imports; the shell mounts from main.js.
import('./home/main.js').catch(function (error) {
  var host = document.getElementById('app-content-body');
  if (host) host.textContent = 'Home failed to load: ' + error.message;
});
