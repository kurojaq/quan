/* ==========================================================================
   Desk Wiki — the Qu'an Brain One knowledge base, rendered in-app.

   Desk-tier-only tab (see js/subscription-gate.js ENTITLEMENTS.desk and
   js/entitlement-gate.js, which gate it generically like every other tab —
   no bespoke gating code lives here). Serves the static markdown bundle at
   /wiki-content/ (mirrored from "Quan Brain One/wiki/") via a small
   dependency-free markdown renderer: no build step, matching the rest of
   the terminal.

   Boots lazily on first tab activation (window.__wikiBoot, called from
   tabs.js), the same pattern as every other tab's __xBoot.
   ========================================================================== */
(function () {
  'use strict';

  var ROOT = '/wiki-content/';
  var booted = false;
  var manifest = null;
  var currentPath = 'index.md';
  var cache = {};

  function $(id) { return document.getElementById(id); }

  // ---- tiny markdown → HTML renderer -------------------------------------
  // Deliberately not a full CommonMark implementation — just enough for the
  // OKF bundle's actual feature set: headers, bold/italic, inline code,
  // links, pipe tables, bullet/numbered lists, fenced code blocks, hr.
  function escHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
  }

  // Resolve a markdown href against the bundle. Two conventions coexist in
  // the source: index.md files use plain relative links ("terminal/x.md",
  // "terminal/" for a directory index); concept files use absolute
  // bundle-root links ("/analytics/x.md"). baseDir is the directory of the
  // file currently being rendered ('' for bundle root).
  function resolveWikiPath(baseDir, href) {
    var raw = href.charAt(0) === '/' ? href.slice(1) : (baseDir ? baseDir + '/' + href : href);
    var isDir = raw === '' || /\/$/.test(raw);
    var parts = raw.split('/'), stack = [];
    parts.forEach(function (p) {
      if (p === '' || p === '.') return;
      if (p === '..') { stack.pop(); return; }
      stack.push(p);
    });
    var path = stack.join('/');
    if (isDir) path += (path ? '/' : '') + 'index.md';
    else if (!/\.md$/i.test(path)) path += '.md';
    return path;
  }

  function isInternalHref(href) {
    return href.charAt(0) !== '#' && !/^https?:\/\//.test(href) && !/^mailto:/.test(href);
  }

  function renderInline(s, baseDir) {
    // code spans first (so their contents don't get further mangled)
    s = s.replace(/`([^`]+)`/g, function (_, code) { return '<code>' + escHtml(code) + '</code>'; });
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, text, href) {
      var frag = '';
      var hm = /^([^#]*)(#.*)?$/.exec(href);
      var base = hm[1], fragPart = hm[2] || '';
      if (isInternalHref(href)) {
        var resolved = resolveWikiPath(baseDir, base);
        return '<a href="#" class="wk-link" data-wiki-link="' + escHtml(resolved + fragPart) + '">' + text + '</a>';
      }
      if (/^https?:\/\//.test(href)) {
        return '<a href="' + escHtml(href) + '" target="_blank" rel="noopener">' + text + '</a>';
      }
      return '<a href="' + escHtml(href) + '">' + text + '</a>';
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    return s;
  }

  function renderTable(lines, baseDir) {
    var rows = lines.map(function (l) {
      return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
    });
    var head = rows[0], body = rows.slice(2); // rows[1] is the --- separator
    var html = '<div class="wk-tablewrap"><table class="wk-table"><thead><tr>';
    head.forEach(function (c) { html += '<th>' + renderInline(escHtml(c), baseDir) + '</th>'; });
    html += '</tr></thead><tbody>';
    body.forEach(function (r) {
      html += '<tr>';
      r.forEach(function (c) { html += '<td>' + renderInline(escHtml(c), baseDir) + '</td>'; });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function stripFrontmatter(text) {
    return text.replace(/^---\n[\s\S]*?\n---\n/, '');
  }

  function toHtml(md, baseDir) {
    md = stripFrontmatter(md).replace(/\r\n/g, '\n');
    var lines = md.split('\n');
    var out = [];
    var i = 0;
    var n = lines.length;

    while (i < n) {
      var line = lines[i];

      // fenced code block
      if (/^```/.test(line)) {
        var lang = line.replace(/^```/, '').trim();
        var code = [];
        i++;
        while (i < n && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
        i++; // skip closing fence
        out.push('<pre class="wk-code"><code' + (lang ? ' class="lang-' + escHtml(lang) + '"' : '') + '>' +
          escHtml(code.join('\n')) + '</code></pre>');
        continue;
      }

      // table: a line containing | followed by a --- separator line
      if (/\|/.test(line) && i + 1 < n && /^\s*\|?[\s:-]+\|[\s:|-]+\s*$/.test(lines[i + 1])) {
        var tbl = [line, lines[i + 1]];
        i += 2;
        while (i < n && /\|/.test(lines[i]) && lines[i].trim() !== '') { tbl.push(lines[i]); i++; }
        out.push(renderTable(tbl, baseDir));
        continue;
      }

      // headings
      var hm = /^(#{1,6})\s+(.*)$/.exec(line);
      if (hm) {
        var level = hm[1].length;
        out.push('<h' + level + ' class="wk-h' + level + '">' + renderInline(escHtml(hm[2]), baseDir) + '</h' + level + '>');
        i++;
        continue;
      }

      // horizontal rule
      if (/^-{3,}\s*$/.test(line)) { out.push('<hr class="wk-hr">'); i++; continue; }

      // bullet list
      if (/^\s*[-*]\s+/.test(line)) {
        var items = [];
        while (i < n && /^\s*[-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
          i++;
        }
        out.push('<ul class="wk-ul">' + items.map(function (it) { return '<li>' + renderInline(escHtml(it), baseDir) + '</li>'; }).join('') + '</ul>');
        continue;
      }

      // numbered list
      if (/^\s*\d+\.\s+/.test(line)) {
        var nitems = [];
        while (i < n && /^\s*\d+\.\s+/.test(lines[i])) {
          nitems.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
          i++;
        }
        out.push('<ol class="wk-ol">' + nitems.map(function (it) { return '<li>' + renderInline(escHtml(it), baseDir) + '</li>'; }).join('') + '</ol>');
        continue;
      }

      // blank line
      if (line.trim() === '') { i++; continue; }

      // paragraph: accumulate until blank line or a line that starts a new block
      var para = [line];
      i++;
      while (i < n && lines[i].trim() !== '' &&
             !/^#{1,6}\s/.test(lines[i]) && !/^```/.test(lines[i]) &&
             !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]) &&
             !/^-{3,}\s*$/.test(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      out.push('<p>' + renderInline(escHtml(para.join(' ')), baseDir) + '</p>');
    }

    return out.join('\n');
  }

  // ---- sidebar / navigation ------------------------------------------------
  function buildTree(entries) {
    var groups = {};
    entries.forEach(function (e) {
      var parts = e.path.split('/');
      var dir = parts.length > 1 ? parts[0] : '(root)';
      (groups[dir] = groups[dir] || []).push(e);
    });
    return groups;
  }

  function renderSidebar() {
    var host = $('wikiNav');
    if (!host || !manifest) return;
    var groups = buildTree(manifest.entries);
    var order = Object.keys(groups).sort(function (a, b) {
      if (a === '(root)') return -1;
      if (b === '(root)') return 1;
      return a.localeCompare(b);
    });
    var html = '';
    order.forEach(function (dir) {
      html += '<div class="wk-navgroup">';
      html += '<div class="wk-navdir">' + (dir === '(root)' ? 'Home' : escHtml(dir)) + '</div>';
      groups[dir]
        .filter(function (e) { return !/\/index\.md$/.test(e.path) || dir === '(root)'; })
        .forEach(function (e) {
          var active = e.path === currentPath ? ' active' : '';
          html += '<a href="#" class="wk-navitem' + active + '" data-wiki-link="' + escHtml(e.path) + '">' +
            escHtml(e.title.replace(/\s*\(.*\)\s*$/, '')) + '</a>';
        });
      html += '</div>';
    });
    host.innerHTML = html;
  }

  // ---- rendering -----------------------------------------------------------
  function setBreadcrumb(entry) {
    var bc = $('wikiBreadcrumb');
    if (!bc) return;
    bc.textContent = entry ? (entry.type ? entry.type + ' · ' : '') + entry.path : currentPath;
  }

  function findEntry(path) {
    if (!manifest) return null;
    for (var i = 0; i < manifest.entries.length; i++) {
      if (manifest.entries[i].path === path) return manifest.entries[i];
    }
    return null;
  }

  function load(path) {
    currentPath = path;
    var content = $('wikiContent');
    if (!content) return;
    renderSidebar();
    setBreadcrumb(findEntry(path));
    if (cache[path]) { content.innerHTML = cache[path]; content.scrollTop = 0; return; }
    content.innerHTML = '<div class="wk-loading">Loading&hellip;</div>';
    fetch(ROOT + path)
      .then(function (r) { if (!r.ok) throw new Error('404'); return r.text(); })
      .then(function (text) {
        var slash = path.lastIndexOf('/');
        var baseDir = slash === -1 ? '' : path.slice(0, slash);
        var html = toHtml(text, baseDir);
        cache[path] = html;
        if (currentPath === path) { content.innerHTML = html; content.scrollTop = 0; }
      })
      .catch(function () {
        if (currentPath === path) content.innerHTML = '<div class="wk-loading">Could not load ' + escHtml(path) + '.</div>';
      });
  }

  function onNavClick(e) {
    var a = e.target.closest ? e.target.closest('[data-wiki-link]') : null;
    if (!a) return;
    e.preventDefault();
    var path = a.getAttribute('data-wiki-link').replace(/#.*$/, '');
    load(path);
  }

  // ---- boot -----------------------------------------------------------------
  function ensureShell() {
    var sec = $('tabWiki');
    if (!sec || $('wikiShell')) return;
    var body = sec.querySelector('.wk-body');
    if (!body) return;
    body.innerHTML =
      '<nav class="wk-sidebar" id="wikiNav"></nav>' +
      '<div class="wk-main">' +
        '<div class="wk-crumb" id="wikiBreadcrumb"></div>' +
        '<div class="wk-content" id="wikiContent"><div class="wk-loading">Loading&hellip;</div></div>' +
      '</div>';
    body.id = 'wikiShell';
    body.addEventListener('click', onNavClick);
  }

  window.__wikiBoot = function () {
    if (booted) return;
    booted = true;
    ensureShell();
    fetch(ROOT + 'manifest.json')
      .then(function (r) { return r.json(); })
      .then(function (m) {
        manifest = m;
        load('index.md');
      })
      .catch(function () {
        var content = $('wikiContent');
        if (content) content.innerHTML = '<div class="wk-loading">Could not load the wiki manifest.</div>';
      });
  };
})();
