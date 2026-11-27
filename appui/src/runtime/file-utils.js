/** Shared browser file reading and dropped-directory traversal. */
var AppUIFileUtils = (() => {
  // Partition a flat listing under an already-normalized directory prefix.
  // File entries retain their original identity; explicit folders can be empty.
  function flatChildren(entries, prefix = '', {folders = [], normalize = String, skipEmpty = true} = {}) {
    const base = prefix ? prefix + '/' : '';
    const directories = Object.create(null), files = [];
    function relative(value) {
      const path = normalize(value);
      return base && !path.startsWith(base) ? null : path.slice(base.length);
    }
    entries.forEach(entry => {
      const rest = relative(entry.name);
      if (rest === null || (skipEmpty && !rest)) return;
      const slash = rest.indexOf('/');
      if (slash < 0) files.push({name: rest, entry});
      else directories[rest.slice(0, slash)] = true;
    });
    folders.forEach(folder => {
      const rest = relative(folder);
      if (!rest) return;
      const slash = rest.indexOf('/');
      directories[slash < 0 ? rest : rest.slice(0, slash)] = true;
    });
    return {directories: Object.keys(directories), files};
  }

  function bytesFromBase64(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function blobFromBase64(base64, mime = 'application/octet-stream') {
    return new Blob([bytesFromBase64(base64)], { type: mime });
  }

  // Strict UTF-8 conversion preserves malformed-input errors for caller fallbacks.
  function textToBase64(text, {urlSafe = false} = {}) {
    const encoded = btoa(unescape(encodeURIComponent(String(text))));
    return urlSafe ? encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : encoded;
  }

  function textFromBase64(value, {urlSafe = false} = {}) {
    let encoded = String(value);
    if (urlSafe) {
      encoded = encoded.replace(/-/g, '+').replace(/_/g, '/');
      while (encoded.length % 4) encoded += '=';
    }
    return decodeURIComponent(escape(atob(encoded)));
  }

  function readBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
      reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
      reader.readAsDataURL(file);
    });
  }

  // Call during the drop handler: DataTransfer can become unreadable afterward.
  function captureDrop(dataTransfer) {
    const entries = [];
    for (const item of Array.from(dataTransfer?.items || [])) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    return { entries, files: Array.from(dataTransfer?.files || []) };
  }

  async function readEntries(entries, { mapFile = (file, path) => ({ file, path }) } = {}) {
    const result = [];
    async function walk(entry, prefix) {
      try {
        if (entry.isFile) {
          const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
          result.push(await mapFile(file, prefix + entry.name));
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          const pending = [];
          try {
            while (true) {
              const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
              if (!batch.length) break;
              for (const child of batch) pending.push(walk(child, prefix + entry.name + '/'));
            }
          } finally {
            await Promise.all(pending);
          }
        }
      } catch (_) { /* Skip unreadable files/directories, retaining successful reads. */ }
    }
    await Promise.all(Array.from(entries || [], entry => walk(entry, '')));
    return result;
  }

  function readDrop(dataTransfer, options) {
    const captured = captureDrop(dataTransfer);
    const entries = captured.entries.length ? captured.entries : captured.files.map(file => ({
      isFile: true, name: file.name, file: resolve => resolve(file),
    }));
    return readEntries(entries, options);
  }

  return { flatChildren, bytesFromBase64, blobFromBase64, textToBase64, textFromBase64, readBase64, captureDrop, readEntries, readDrop };
})();
if (typeof window !== 'undefined') window.AppUIFileUtils = AppUIFileUtils;
