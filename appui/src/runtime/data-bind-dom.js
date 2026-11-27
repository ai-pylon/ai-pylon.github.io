/* Declarative binding DOM adapter; sources, fetching and retries belong to DataBind. */
window._AppUIDataBindDOM=(function(){
  function create({sourceFor,fetchIfNeeded}){
    const {resolvePath:_resolvePath,formatValue:_formatValue,renderValue:_renderValue}=window._AppUIDataBindValues;
    var _elements = [];
    var _scanTimer = null;

    function _getDisplayedSources() {
      var displayed = Object.create(null);
      for (var i = 0; i < _elements.length; i++) {
        displayed[_elements[i].source] = true;
      }
      return displayed;
    }

    // ── Skeleton helpers ──

    function _showSkeleton(el, entry) {
      // Store original content for restoration on error
      if (!entry._originalContent) {
        entry._originalContent = el.textContent;
      }
      el.textContent = '';
      el.classList.add('data-bind-loading');
      var skeleton = document.createElement('span');
      skeleton.className = 'data-bind-skeleton';
      skeleton.textContent = '\u00A0'; // non-breaking space for height
      el.appendChild(skeleton);
    }

    function _removeSkeleton(el) {
      el.classList.remove('data-bind-loading');
      // Remove skeleton span(s) if present
      var skeletons = el.querySelectorAll('.data-bind-skeleton');
      for (var i = 0; i < skeletons.length; i++) {
        skeletons[i].parentNode.removeChild(skeletons[i]);
      }
    }

    // ── DOM scanning ──

    function scan(container) {
      var root = container || document;
      var els = root.querySelectorAll('[data-bind]');
      els.forEach(function(el) {
        // Skip already registered
        if (el._dataBind) return;

        var bindValue = el.getAttribute('data-bind');
        var dotIdx = bindValue.indexOf('.');
        var sourceName = dotIdx > 0 ? bindValue.substring(0, dotIdx) : bindValue;
        var keyPath = dotIdx > 0 ? bindValue.substring(dotIdx + 1) : '';

        var entry = {
          el: el,
          source: sourceName,
          keyPath: keyPath,
          format: el.getAttribute('data-format') || '',
          render: el.getAttribute('data-render') || '',
          transform: el.getAttribute('data-transform') || '',
          defaultVal: el.getAttribute('data-default') || '--',
          loadingText: el.getAttribute('data-loading') || el.textContent || 'Loading...',
          _originalContent: el.textContent || '',
        };

        el._dataBind = entry;
        _elements.push(entry);

        // Show skeleton loading state
        _showSkeleton(el, entry);

        // If source already has data, distribute immediately
        var src = sourceFor(sourceName);
        if (src && src.data != null) {
          _applyToElement(entry, src.data);
        } else {
          fetchIfNeeded(sourceName);
        }
      });
    }

    // ── Distribute data to elements ──

    function _distribute(name, data) {
      _elements.forEach(function(entry) {
        if (entry.source !== name) return;
        _applyToElement(entry, data);
      });
    }

    function _applyToElement(entry, data) {
      // Remove skeleton and loading/error classes
      _removeSkeleton(entry.el);
      entry.el.classList.remove('data-bind-loading', 'data-bind-error');

      var value = _resolvePath(data, entry.keyPath);

      // Custom transform
      if (entry.transform && window[entry.transform]) {
        try { value = window[entry.transform](value, data); } catch(e) {}
      }

      // Null/undefined
      if (value === null || value === undefined) {
        entry.el.textContent = entry.defaultVal;
        return;
      }

      // Render mode for complex objects
      if (entry.render) {
        entry.el.innerHTML = _renderValue(value, entry.render);
        return;
      }

      // Format
      entry.el.textContent = _formatValue(value, entry.format);
    }

    function loading(name,src){
      // Skeleton is already showing from scan() — only add for elements without skeleton
      _elements.forEach(function(entry) {
        if (entry.source === name) {
          if (!(src.staleWhileRevalidate && src.data != null)) {
            // Ensure skeleton is visible if not already
            if (!entry.el.querySelector('.data-bind-skeleton')) {
              _showSkeleton(entry.el, entry);
            }
          }
          entry.el.classList.remove('data-bind-error');
        }
      });

    }

    function retrying(name){
      _elements.forEach(function(entry){
        if(entry.source===name){
          _removeSkeleton(entry.el);
          entry.el.classList.add('data-bind-loading');
          entry.el.textContent='Retrying...';
        }
      });
    }

    function error(name){
      _elements.forEach(function(entry){
        if(entry.source===name){
          _removeSkeleton(entry.el);
          entry.el.classList.remove('data-bind-loading');
          entry.el.classList.add('data-bind-error');
          entry.el.textContent='Error';
        }
      });
    }

    // ── Auto-scan on DOMContentLoaded and MutationObserver ──

    function _autoScan() {
      scan();
      // Watch for dynamically added elements
      if (typeof MutationObserver !== 'undefined') {
        var observer = new MutationObserver(function(mutations) {
          var needsScan = mutations.some(function(m) {
            return m.addedNodes.length > 0;
          });
          if (needsScan) {
            clearTimeout(_scanTimer);
            _scanTimer = setTimeout(scan, 50);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }
    }

    // Auto-scan when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _autoScan);
    } else {
      setTimeout(_autoScan, 0);
    }

    // ── CSS for loading/error/skeleton states ──
    var style = document.createElement('style');
    style.textContent = [
      '.data-bind-loading{opacity:1}',
      '.data-bind-error{color:var(--color-error)}',
      '.data-bind-skeleton{display:inline-block;min-width:60px;height:1em;background:linear-gradient(90deg,var(--bg-secondary) 25%,var(--bg-tertiary, #3a3a3a) 50%,var(--bg-secondary) 75%);background-size:200% 100%;animation:data-bind-pulse 1.5s ease-in-out infinite;border-radius:4px;vertical-align:middle}',
      '@keyframes data-bind-pulse{0%{background-position:200% 0}100%{background-position:-200% 0}}'
    ].join('');
    document.head.appendChild(style);

    return {scan,distribute:_distribute,displayedSources:_getDisplayedSources,loading,retrying,error};
  }
  return {create};
})();
