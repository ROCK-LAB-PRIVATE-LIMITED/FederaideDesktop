const { contextBridge, ipcRenderer, webUtils } = require('electron');

let DOMPurify = null;
let marked = null;
let hljs = null;
let markedKatex = null;

function getHljs() {
    if (!hljs) {
        hljs = require('highlight.js');
    }
    return hljs;
}

function getMarked() {
    if (!marked) {
        marked = require('marked');
        if (marked.marked) {
            marked = marked.marked;
        }
        
        try {
            markedKatex = require('marked-katex-extension');
            const katexExt = markedKatex.default || markedKatex;
            if (typeof katexExt === 'function') {
                marked.use(katexExt({ throwOnError: false, nonStandard: true }));
            }
        } catch (e) {
            console.error("KaTeX extension init error:", e);
        }

        const hl = getHljs();
        const renderer = new marked.Renderer();

        renderer.link = (href, title, text) => {
            if (typeof href === 'object' && href.href) {
                text = href.text;
                title = href.title;
                href = href.href;
            }
            const titleAttr = title ? ` title="${title}"` : '';
            return `<a href="${href}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
        };

        renderer.table = (header, body) => {
            if (typeof header === 'object' && header.header) {
                const h = header.header;
                const b = header.rows ? header.rows.join('') : '';
                return `<div class="table-container"><table><thead>${h}</thead><tbody>${b}</tbody></table></div>`;
            }
            return `<div class="table-container"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
        };

        renderer.code = (code, language) => {
            if (typeof code === 'object' && code.text) {
                language = code.lang;
                code = code.text;
            }
            const lang = (language || '').trim();
            const validLang = Boolean(lang && hl.getLanguage(lang));
            let highlighted = code;
            try {
                highlighted = validLang
                    ? hl.highlight(code, { language: lang, ignoreIllegals: true }).value
                    : hl.highlightAuto(code).value;
            } catch (e) {
                highlighted = code;
            }
            const langClass = validLang ? ` language-${lang}` : '';
            const displayLang = lang || 'code';

            return `<div class="code-block-wrapper">` +
                `<div class="code-header-bar">` +
                `<span>${displayLang}</span>` +
                `<button class="code-copy-btn" onclick="copyCodeBlock(this)">` +
                `<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>` +
                `<span>Copy</span>` +
                `</button>` +
                `</div>` +
                `<pre><code class="hljs${langClass}">${highlighted}</code></pre>` +
                `</div>`;
        };

        marked.setOptions({ breaks: true, gfm: true, renderer });
    }
    return marked;
}

function getDOMPurify() {
    if (!DOMPurify) {
        const createDOMPurify = require('dompurify');
        DOMPurify = createDOMPurify(window);
    }
    return DOMPurify;
}

contextBridge.exposeInMainWorld('electronAPI', {
    getPathForFile: (file) => {
        try {
            if (webUtils && webUtils.getPathForFile) {
                return webUtils.getPathForFile(file);
            }
        } catch (e) {}
        return file.path || file.name || '';
    },
    sendToPython: (payload) => {
        ipcRenderer.send('send-to-python', payload);
    },
    onPythonMessage: (callback) => {
        const handler = (event, msg) => callback(msg);
        ipcRenderer.on('python-message', handler);
        return () => ipcRenderer.removeListener('python-message', handler);
    },
    openDirectoryDialog: () => {
        ipcRenderer.send('open-directory-dialog');
    },
    openExternal: (url) => {
        ipcRenderer.send('open-external', url);
    },
    openNoVnc: (url) => {
        ipcRenderer.send('open-novnc', url);
    },
    renderMarkdown: (text) => {
        if (!text) return '';
        try {
            const m = getMarked();
            const purify = getDOMPurify();
            const rawHtml = m.parse(text);
            return purify.sanitize(rawHtml, {
                ADD_ATTR: ['target', 'aria-hidden', 'aria-label', 'role', 'mathvariant', 'xmlns', 'viewBox', 'onclick', 'data-tool'],
                ADD_TAGS: ['math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd', 'annotation', 'svg', 'path', 'g', 'rect', 'circle', 'line', 'polygon', 'text', 'button'],
                FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'],
                FORBID_ATTR: ['onerror', 'onload', 'onmouseover', 'onfocus', 'onblur']
            });
        } catch (e) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    },
    escapeHtml: (text) => {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
});