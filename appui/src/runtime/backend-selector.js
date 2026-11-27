/**
 * Backend selector with priority-based fallback.
 *
 * Usage:
 *   const bs = new AppUIBackendSelector();
 *   await bs.init();  // fetches /llm/backends
 *   const backend = bs.preferred();  // returns best available
 *   bs.render(container);  // renders dropdown
 */
class AppUIBackendSelector {
    constructor(opts = {}) {
        this.priority = opts.priority || ['kiro', 'ericai', 'playground', 'copilot'];
        this.backends = [];
        this.selected = null;
        this.llmUrl = opts.llmUrl || '/api/llm';
        this._onChange = opts.onChange || null;
    }

    async init() {
        try {
            const r = await fetch(this.llmUrl + '/backends');
            const data = await r.json();
            this.backends = data.backends || [];
        } catch (e) {
            this.backends = this.priority.map(id => ({ id, name: id, available: false }));
        }
        this.selected = this.preferred();
        return this;
    }

    preferred() {
        for (const id of this.priority) {
            const b = this.backends.find(x => x.id === id);
            if (b && b.available) return id;
        }
        return this.priority[0];
    }

    render(container) {
        const select = document.createElement('select');
        select.className = 'backend-selector';
        select.style.cssText = 'padding:4px 8px;border-radius:var(--radius,4px);' +
            'border:1px solid var(--border);background:var(--bg-surface);' +
            'color:var(--text);font-size:13px;cursor:pointer;';
        this.backends.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = (b.available ? '\u25CF ' : '\u25CB ') + (b.name || b.id);
            opt.selected = b.id === this.selected;
            opt.disabled = !b.available;
            select.appendChild(opt);
        });
        select.addEventListener('change', () => {
            this.selected = select.value;
            if (this._onChange) this._onChange(this.selected);
        });
        container.innerHTML = '';
        container.appendChild(select);
        return select;
    }

    chatUrl() {
        return this.llmUrl + '/' + this.selected + '/chat';
    }

    streamUrl() {
        return this.llmUrl + '/' + this.selected + '/chat/stream';
    }

    isAvailable(id) {
        const b = this.backends.find(x => x.id === (id || this.selected));
        return b ? b.available : false;
    }
}

window.AppUIBackendSelector = AppUIBackendSelector;
