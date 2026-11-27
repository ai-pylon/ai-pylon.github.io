/* Processor result formatting and clipboard controls. */
window._AppUIPylonProcessorResults = (() => {
  function create(PT) {
    const views=new WeakMap();
    function _copyToClipboard(text,btn,owner) {
      const current=()=>btn.isConnected!==false&&(!owner||owner.current());
      if(!current()||!navigator.clipboard?.writeText)return;
      AppUICore.copyText(text).then(()=>{
        if(!current())return;
        const original=btn.textContent;btn.textContent=String.fromCharCode(0x2714);
        let timer=setTimeout(()=>{timer=null;if(current())btn.textContent=original;},1200);
        owner?.add(()=>{if(timer!==null)clearTimeout(timer);});
      }).catch(()=>{});
    }

    function _renderResult(el, actionName, result, parent) {
      views.get(el)?.destroy();
      if (!result) {
        el.innerHTML = '<div style="font-size:11px;color:#888">No result</div>';
        return;
      }

      var html = '';
      var innerHtml = '';
      var copyableText = null;

      innerHtml += '<div style="color:#888;margin-bottom:4px;font-weight:600">' + PT.util.esc(actionName) + '</div>';

      if (result.error) {
        innerHtml += '<div style="color:#ff5370">' + PT.util.esc(result.error) + '</div>';
      } else if (result.ok === false) {
        innerHtml += '<div style="color:#ff5370">' + PT.util.esc(result.error || 'Action failed') + '</div>';
      } else {
        var data = result.result || result;
        // Render common result shapes
        if (data.excerpt) {
          copyableText = data.excerpt;
          innerHtml += '<pre style="font-size:10px;max-height:120px;overflow:auto;background:var(--bg-primary,#0d1117);padding:4px;border-radius:3px;margin:4px 0">'
            + PT.util.esc(data.excerpt) + '</pre>';
          if (data.file) innerHtml += '<div style="color:#888">File: ' + PT.util.esc(data.file) + '</div>';
          if (data.line) innerHtml += '<div style="color:#888">Lines ' + data.line + '\u2013' + (data.end_line || '?') + '</div>';
        } else if (data.symbols || data.methods || data.callers || data.children || data.results) {
          var items = data.symbols || data.methods || data.callers || data.children || data.results || [];
          innerHtml += '<div style="color:#c3e88d">' + items.length + ' items</div>';
          items.slice(0, 10).forEach(function (item) {
            innerHtml += '<div style="padding:1px 0">';
            if (item.line) innerHtml += '<span style="color:#888;font-size:10px">L' + item.line + '</span> ';
            innerHtml += '<code style="font-size:10px">' + PT.util.esc(item.name || item.key || '') + '</code>';
            if (item.preview) innerHtml += ' <span style="opacity:0.5;font-size:10px">' + PT.util.esc(item.preview) + '</span>';
            innerHtml += '</div>';
          });
          if (items.length > 10) innerHtml += '<div style="color:#666;font-size:10px">\u2026and ' + (items.length - 10) + ' more</div>';
        } else if (data.edges) {
          innerHtml += '<div style="color:#c3e88d">' + data.edges.length + ' edges</div>';
          data.edges.slice(0, 5).forEach(function (e) {
            innerHtml += '<div style="padding:1px 0;font-size:10px">'
              + PT.util.esc(e.source_db || '') + ':' + (e.source_node_id || '') + ' \u2192 '
              + PT.util.esc(e.target_db || '') + ':' + (e.target_node_id || '')
              + '</div>';
          });
        } else if (data.csv) {
          copyableText = data.csv;
          innerHtml += '<pre style="font-size:10px;max-height:100px;overflow:auto">' + PT.util.esc(data.csv) + '</pre>';
        } else if (data.content) {
          copyableText = data.content.substring(0, 2000);
          innerHtml += '<pre style="font-size:10px;max-height:120px;overflow:auto;background:var(--bg-primary,#0d1117);padding:4px;border-radius:3px">'
            + PT.util.esc(data.content.substring(0, 2000)) + '</pre>';
        } else {
          // Generic JSON dump
          var jsonStr = JSON.stringify(data, null, 2).substring(0, 1000);
          copyableText = jsonStr;
          innerHtml += '<pre style="font-size:10px;max-height:100px;overflow:auto">'
            + PT.util.esc(jsonStr) + '</pre>';
        }
      }

      // Build the wrapper with optional copy button
      var wrapperStart = '<div style="font-size:11px;border:1px solid var(--border,#333);border-radius:4px;padding:6px;margin-top:4px;max-height:200px;overflow:auto;position:relative">';
      var copyBtnHtml = '';
      if (copyableText) {
        copyBtnHtml = '<button class="pylon-copy-btn" style="position:absolute;top:4px;right:4px;padding:2px 6px;font-size:9px;'
          + 'background:var(--bg-secondary,#1e1e2e);border:1px solid var(--border,#333);border-radius:3px;'
          + 'color:#888;cursor:pointer;z-index:1">\uD83D\uDCCB Copy</button>';
      }

      // Collapsible metadata for long results (>200 chars)
      var fullContent = innerHtml;
      if (innerHtml.length > 200) {
        html = wrapperStart + copyBtnHtml
          + '<details open><summary style="cursor:pointer;color:#888;font-size:10px;margin-bottom:4px;user-select:none">Result (click to collapse)</summary>'
          + fullContent
          + '</details></div>';
      } else {
        html = wrapperStart + copyBtnHtml + fullContent + '</div>';
      }

      // Replace previous result content (inline results)
      el.innerHTML = html;
      const marker=el.firstElementChild;
      const owner=parent?AppUILifecycle.createViewScope({host:el,parent,pagehide:false,isCurrent:()=>el.firstElementChild===marker}):null;
      if(owner){views.set(el,owner);owner.add(()=>{if(views.get(el)===owner)views.delete(el);});}

      // Bind copy button
      if (copyableText) {
        var copyBtn = el.querySelector('.pylon-copy-btn');
        if (copyBtn) {
          const copy=()=>_copyToClipboard(copyableText,copyBtn,owner);
          if(owner)owner.listen(copyBtn,'click',copy);
          else copyBtn.addEventListener('click',copy);
        }
      }
    }

    return {render:_renderResult};
  }
  return {create};
})();
