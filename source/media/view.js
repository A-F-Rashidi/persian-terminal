/* global acquireVsCodeApi, PersianAnsi */
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const output = $('output'), input = $('command');
  const runs = new Map();
  let history = [];
  const tabMemory = new Map();
  let activeTab, alignment = 'right', searchHits = [], searchIndex = 0;
  let busy = false, historyIndex = 0, draft = '', maxLines = 2000;
  let pending = false, renderTimer, following = true, noticeTimer;
  const send = (type, rest = {}) => vscode.postMessage({ type, tabId: activeTab, ...rest });
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  let noticeHideTimer;
  function dismissNotice() {
    clearTimeout(noticeTimer);
    clearTimeout(noticeHideTimer);
    $('notice').classList.add('leaving');
    noticeHideTimer = setTimeout(() => { $('notice').hidden = true; }, 220);
  }
  function armNotice() {
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(dismissNotice, 5000);
  }
  function positionNotice() {
    const rect = document.querySelector('.input-row').getBoundingClientRect();
    const box = $('notice');
    box.style.right = Math.max(0, window.innerWidth - rect.right) + 'px';
    box.style.maxWidth = Math.max(0, Math.min(360, rect.width)) + 'px';
    box.style.bottom = Math.max(10, window.innerHeight - rect.top + 10) + 'px';
  }
  window.addEventListener('resize', positionNotice);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(positionNotice).observe($('composer'));
  function notice(text) {
    clearTimeout(noticeTimer);
    clearTimeout(noticeHideTimer);
    $('notice-text').textContent = text;
    $('notice').classList.remove('leaving');
    $('notice').hidden = !text;
    if (text) { positionNotice(); armNotice(); }
  }
  $('notice-close').addEventListener('click', dismissNotice);
  function makeRun(id, event) {
    if (runs.has(id)) return runs.get(id);
    $('welcome').hidden = true;
    const section = el('section', 'run');
    section.dataset.run = String(id);
    const header = el('div', 'run-header');
    header.append(el('span', 'run-prompt', '❯'));
    const command = el('pre', 'run-command', event?.title || event?.command || '[بخشی از خروجی قبلی]');
    command.dir = 'ltr';
    header.append(command);
    if (event) header.title = `${event.shell} · ${event.cwd}`;
    const details = el('details', 'run-details');
    details.hidden = !event?.title;
    const summary = el('summary', '', 'جزئیات اجرا');
    const fullCommand = el('pre', 'full-command', event?.command || '');
    fullCommand.dir = 'ltr';
    details.append(summary, fullCommand);
    const lines = el('div', 'run-lines');

    const warning = el('div', 'output-warning'); warning.hidden = true;
    const errors = el('div', 'output-error');
    const footer = el('div', 'run-footer', 'در حال اجرا…');
    const actions = el('div', 'run-actions');
    const copy = el('button', '', 'کپی'), save = el('button', '', 'ذخیره');
    copy.title = 'کپی خروجی این اجرا'; save.title = 'ذخیره خروجی این اجرا در فایل';
    copy.addEventListener('click', () => send('copy', { text: runText(runs.get(id)), runId: id }));
    save.addEventListener('click', () => send('save', { text: runText(runs.get(id)), runId: id }));
    actions.append(copy, save); header.append(actions, footer);
    section.append(header, details, lines, warning, errors);
    output.append(section);
    const run = { section, lines, warning, errors, footer, command: event?.command || '', model: new PersianAnsi.OutputModel(maxLines), done: false };
    run.parts = [{ model: new PersianAnsi.OutputModel(maxLines), lines, done: false }];
    run.inputCount = 0;
    runs.set(id, run);
    return run;
  }
  function receiveEvent(event) {
    const run = makeRun(event.id, event.type === 'start' ? event : undefined);
    if (event.type === 'data') {
      run.model.write(event.data, event.stream);
      run.parts[run.parts.length - 1].model.write(event.data, event.stream);
    } else if (event.type === 'input') {
      const last = run.parts[run.parts.length - 1];
      last.done = true; last.model.dirtyFrom = 0;
      const card = el('div', 'input-echo');
      card.append(el('span', 'input-echo-label', 'ورودی:'));
      const value = el('div', 'input-echo-value', event.text.replace(/\r?\n$/, '') || '⏎');
      value.dir = 'auto'; card.append(value);
      run.section.insertBefore(card, run.warning);
      const next = el('div', 'run-lines');

      run.section.insertBefore(next, run.warning);
      run.parts.push({ model: new PersianAnsi.OutputModel(maxLines), lines: next, done: false, card });
      // Bound retained interactions as well as plain output.
      while (run.parts.length > 20) {
        const old = run.parts.shift(); old.lines.remove(); old.card?.remove();
      }
    }
    else if (event.type === 'error') {
      run.errors.append(document.createTextNode(event.message + '\n'));
    } else if (event.type === 'exit') {
      run.done = true;
      const last = run.parts[run.parts.length - 1]; last.done = true; last.model.dirtyFrom = 0;
      if (last.model.text().trim()) last.lines.setAttribute('data-label', 'خروجی');
      run.model.dirtyFrom = Math.min(run.model.dirtyFrom, Math.max(0, run.model.lines.length - 1));
      const result = event.stopped ? 'متوقف شد' : event.code === null ? `پایان با سیگنال ${event.signal || 'نامشخص'}` : event.code === 0 ? 'با موفقیت اجرا شد' : `کد خروج: ${event.code}`;
      run.footer.textContent = result;
      if (!event.stopped && event.code !== null && event.code !== 0) {
        run.footer.textContent = 'کد خروج: ';
        const code = el('bdi', '', String(event.code)); code.dir = 'ltr'; run.footer.append(code);
      }
      run.footer.append(document.createTextNode(` · ${(event.duration / 1000).toFixed(2)} ثانیه`));
      run.footer.classList.toggle('failed', !event.stopped && event.code !== 0);
    }
  }
  function renderRun(run) {
    let total = 0;
    for (const part of run.parts) total += part.model.cells;
    while (run.parts.length > 1 && total > 200000) {
      const old = run.parts.shift(); total -= old.model.cells; old.lines.remove(); old.card?.remove();
    }
    for (const part of run.parts) renderPart({ ...part, warning: run.warning });
    const warnings = [];
    if (run.model.truncated) warnings.push('خروجی طولانی بود؛ بخشی از ابتدای آن حذف شد.');
    if (run.model.unsupported) warnings.push('این برنامه از نمایش پیشرفته استفاده می‌کند؛ ممکن است بخشی از خروجی درست دیده نشود.');
    run.warning.textContent = warnings.join(' ');
    run.warning.hidden = !warnings.length;
  }
  function renderPart(run) {
    const start = run.model.dirtyFrom;
    if (!Number.isFinite(start)) return;
    while (run.lines.children.length > start) run.lines.lastChild.remove();
    const fragment = document.createDocumentFragment();
    const rows = run.model.rows(start);
    // The last empty row is the cursor after a trailing newline, not another output line.
    if (run.done && rows.length && rows[rows.length - 1].length === 0) rows.pop();
    for (const row of rows) {
      const line = el('div', 'line');
      const hasPersian = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u.test(row.map(s => s.text).join(''));
      line.dir = hasPersian && alignment !== 'auto' ? 'rtl' : 'auto';
      line.classList.toggle('has-persian', hasPersian);
      for (const segment of row) {
        const span = el('span', '', segment.text);
        const style = segment.style;
        let fg = PersianAnsi.color(style.fg) || (segment.stream === 'stderr' ? 'var(--vscode-terminal-ansiRed, #ef6b73)' : '');
        let bg = PersianAnsi.color(style.bg);
        if (style.inverse) [fg, bg] = [bg || 'var(--vscode-terminal-background, #161b22)', fg || 'var(--vscode-terminal-foreground, #d7dde7)'];
        if (fg) span.style.color = fg;
        if (bg) span.style.backgroundColor = bg;
        if (style.bold) span.style.fontWeight = '700';
        if (style.italic) span.style.fontStyle = 'italic';
        if (style.underline) span.style.textDecoration = 'underline';
        line.append(span);
      }
      fragment.append(line);
    }
    run.lines.append(fragment);
    const warnings = [];
    if (run.model.truncated) warnings.push('خروجی طولانی بود؛ بخش ابتدایی یا ادامه خط‌های خیلی بلند حذف شد.');
    if (run.model.unsupported) warnings.push('این برنامه از نمایش پیشرفته استفاده می‌کند؛ ممکن است بخشی از خروجی درست دیده نشود.');
    run.warning.textContent = warnings.join(' ');
    run.warning.hidden = !warnings.length;
    run.model.dirtyFrom = Infinity;
  }
  function render() {
    pending = false;
    // Bound the combined DOM/model size across commands, not only each command.
    let lines = 0, cells = 0;
    for (const run of runs.values()) { lines += run.model.lines.length; cells += run.model.cells; }
    while (runs.size > 1 && (runs.size > 40 || lines > maxLines || cells > 200000)) {
      const [id, run] = runs.entries().next().value;
      lines -= run.model.lines.length; cells -= run.model.cells;
      run.section.remove(); runs.delete(id);
    }
    for (const run of runs.values()) renderRun(run);
    updateSearch(false);
    if (following) output.scrollTop = output.scrollHeight;
    $('latest').hidden = following;
  }
  function scheduleRender() {
    if (!pending) { pending = true; renderTimer = setTimeout(render, 16); }
  }
  function reset() {
    for (const run of runs.values()) run.section.remove();
    runs.clear(); $('welcome').hidden = false;
    following = true;
  }
  function resizeInput() {
    input.style.height = 'auto';
    input.style.height = Math.min(120, input.scrollHeight) + 'px';
  }
  function submit() {
    const text = input.value;
    if (text.length > (busy ? 65535 : 65536)) { notice('این متن خیلی طولانی است؛ کوتاه‌ترش کن.'); return; }
    if (busy) {
      send('stdin', { text: text + '\n' });
    } else {
      if (!text.trim()) return;
      if (history[history.length - 1] !== text) history.push(text);
      if (history.length > 100) history.shift();
      historyIndex = history.length; draft = '';
      busy = true; updateBusy();
      send('run', { command: text });
    }
    input.value = ''; resizeInput(); following = true;
  }
  function updateBusy() {
    $('stop').disabled = !busy;
    $('folder').disabled = busy;
    $('shell').disabled = busy;
    $('dot').classList.toggle('busy', busy);
    $('status').textContent = busy ? 'در حال اجرا' : '';
    $('status').hidden = !busy;
    $('dot').hidden = !busy;
    $('input-label').textContent = busy ? 'پاسخ به برنامه' : 'دستور';
    $('run').textContent = busy ? 'ارسال ↵' : 'اجرا ↵';
    $('eof').hidden = !busy;
    input.placeholder = busy ? 'پاسخت را بنویس…' : 'دستورت را بنویس…';
  }
  window.addEventListener('message', ({ data: message }) => {
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'state') {
      if (message.tabId !== undefined && message.tabId !== activeTab) {
        if (activeTab !== undefined) tabMemory.set(activeTab, { history, value: input.value, historyIndex, draft });
        activeTab = message.tabId;
        const memory = tabMemory.get(activeTab);
        history = memory?.history || []; input.value = memory?.value || '';
        historyIndex = memory?.historyIndex ?? history.length; draft = memory?.draft || '';
        reset(); resizeInput();
      }
      if (Array.isArray(message.tabs)) renderTabs(message.tabs);
      document.documentElement.dataset.density = message.density || 'compact';
      const nextAlignment = message.persianAlignment || 'right';
      if (alignment !== nextAlignment) { alignment = nextAlignment; for (const run of runs.values()) { run.model.dirtyFrom = 0; for (const part of run.parts) part.model.dirtyFrom = 0; } scheduleRender(); }
      document.documentElement.dataset.alignment = alignment;
      if (document.activeElement !== $('density')) $('density').value = message.density || 'compact';
      if (document.activeElement !== $('alignment')) $('alignment').value = alignment;
      if (Number.isFinite(message.fontSize) && document.activeElement !== $('font-size')) $('font-size').value = message.fontSize;
      busy = !!message.busy; updateBusy();
      $('shell').textContent = message.shell;
      $('cwd').textContent = message.cwd;
      $('cwd').title = message.cwd;
      $('active-file').textContent = message.fileName || '';
      $('active-file').hidden = !message.fileName;
      $('active-file').parentElement.hidden = !message.fileName;
      if (typeof message.persianFontFamily === 'string') document.documentElement.style.setProperty('--persian-font', message.persianFontFamily);
      if (typeof message.fontFamily === 'string') document.documentElement.style.setProperty('--output-font', message.fontFamily);
      if (Number.isFinite(message.fontSize)) document.documentElement.style.setProperty('--output-size', Math.max(10, Math.min(32, message.fontSize)) + 'px');
      if (Number.isInteger(message.maxLines) && message.maxLines !== maxLines) {
        maxLines = Math.max(100, Math.min(10000, message.maxLines));
        for (const run of runs.values()) { run.model.maxLines = maxLines; run.model.trim(); for (const part of run.parts) { part.model.maxLines = maxLines; part.model.trim(); } }
        scheduleRender();
      }
    } else if (message.type === 'events' && Array.isArray(message.entries)) {
      if (message.tabId !== undefined && message.tabId !== activeTab) return;
      if (message.reset) reset();
      for (const entry of message.entries) receiveEvent(entry.event);
      scheduleRender();
    } else if (message.type === 'notice') notice(message.text);
  });
  function runText(run) {
    if (!run) return '';
    return run.model.text() + (run.errors.textContent ? '\n' + run.errors.textContent : '');
  }
  function renderTabs(tabs) {
    const signature = JSON.stringify([activeTab, tabs]);
    if ($('tabs').dataset.signature === signature) return;
    $('tabs').dataset.signature = signature; $('tabs').replaceChildren();
    const live = new Set(tabs.map(t => t.id));
    for (const key of tabMemory.keys()) if (!live.has(key)) tabMemory.delete(key);
    for (const tab of tabs) {
      const group = el('div', 'tab-item'); group.classList.toggle('active', tab.id === activeTab);
      const button = el('button', 'tab-select', `${tab.busy ? '● ' : ''}${tab.name}`);
      button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(tab.id === activeTab));
      button.title = `${tab.shell} — دوبار کلیک برای تغییر نام`;
      button.addEventListener('click', () => send('switchTab', { target: tab.id }));
      button.addEventListener('dblclick', () => send('renameTab', { tabId: tab.id }));
      const close = el('button', 'tab-close', '×'); close.title = 'بستن تب و توقف برنامه‌های آن'; close.setAttribute('aria-label', `بستن ${tab.name}`);
      close.addEventListener('click', () => send('closeTab', { tabId: tab.id }));
      group.append(button, close); $('tabs').append(group);
    }
  }
  function removeMarks() {
    for (const mark of output.querySelectorAll('mark.search-hit')) { const parent = mark.parentNode; mark.replaceWith(document.createTextNode(mark.textContent)); parent.normalize(); }
  }
  function updateSearch(scroll = false) {
    removeMarks(); searchHits = [];
    const query = $('search-bar').hidden ? '' : $('search-query').value.toLocaleLowerCase();
    if (query) {
      for (const line of output.querySelectorAll('.line, .output-error')) {
        if (searchHits.length >= 500) break;
        const text = line.textContent.toLocaleLowerCase(), nodes = [];
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let node, offset = 0;
        while ((node = walker.nextNode())) { nodes.push({ node, start: offset }); offset += node.textContent.length; }
        const matches = [];
        for (let at = text.indexOf(query); at >= 0 && searchHits.length < 500; at = text.indexOf(query, at + query.length)) {
          const hit = []; matches.push({ start: at, end: at + query.length, hit }); searchHits.push(hit);
        }
        for (const entry of nodes) {
          const value = entry.node.textContent, fragment = document.createDocumentFragment(); let from = 0;
          for (const match of matches) {
            const a = Math.max(0, match.start - entry.start), b = Math.min(value.length, match.end - entry.start);
            if (a >= b) continue;
            fragment.append(document.createTextNode(value.slice(from, a)));
            const mark = el('mark', 'search-hit', value.slice(a, b)); match.hit.push(mark); fragment.append(mark); from = b;
          }
          if (from) { fragment.append(document.createTextNode(value.slice(from))); entry.node.replaceWith(fragment); }
        }
      }
    }
    searchIndex = Math.max(0, Math.min(searchIndex, searchHits.length - 1));
    for (const mark of searchHits[searchIndex] || []) mark.classList.add('current');
    $('search-status').textContent = query ? `${searchHits.length ? searchIndex + 1 : 0} / ${searchHits.length}${searchHits.length === 500 ? '+' : ''}` : '';
    if (scroll && searchHits.length) { following = false; searchHits[searchIndex][0]?.scrollIntoView?.({ block: 'center' }); }
  }
  function toggleSearch(open) { $('search-bar').hidden = !open; if (open) $('search-query').focus(); updateSearch(false); }
  $('new-tab').addEventListener('click', () => send('newTab'));
  $('search-toggle').addEventListener('click', () => toggleSearch($('search-bar').hidden));
  $('search-close').addEventListener('click', () => { toggleSearch(false); input.focus(); });
  $('search-query').addEventListener('input', () => { searchIndex = 0; updateSearch(true); });
  for (const [id, delta] of [['search-prev', -1], ['search-next', 1]]) $(id).addEventListener('click', () => {
    if (searchHits.length) searchIndex = (searchIndex + delta + searchHits.length) % searchHits.length; updateSearch(true);
  });
  $('search-query').addEventListener('keydown', event => {
    if (event.key === 'Escape') { toggleSearch(false); input.focus(); }
    if (event.key === 'Enter') { event.preventDefault(); $(event.shiftKey ? 'search-prev' : 'search-next').click(); }
  });
  $('settings-toggle').addEventListener('click', () => { const open = $('display-settings').hidden; $('display-settings').hidden = !open; $('settings-toggle').setAttribute('aria-expanded', String(open)); });
  for (const [id, key] of [['font-size', 'fontSize'], ['density', 'density'], ['alignment', 'persianAlignment']]) $(id).addEventListener('change', () => {
    const value = key === 'fontSize' ? Number($(id).value) : $(id).value; send('display', { key, value });
  });
  $('composer').addEventListener('submit', event => { event.preventDefault(); submit(); });
  $('clear').addEventListener('click', () => send('clear'));
  $('native-terminal').addEventListener('click', () => send('native-terminal'));
  $('stop').addEventListener('click', () => send('stop'));
  $('folder').addEventListener('click', () => send('folder'));
  $('shell').addEventListener('click', () => send('shell'));
  $('eof').addEventListener('click', () => send('eof'));
  $('copy').addEventListener('click', () => {
    if (pending) { clearTimeout(renderTimer); render(); }
    // Copy logical characters from the model, never visually reversed DOM order.
    const text = [...runs.values()].map(run => (run.command ? '$ ' + run.command + '\n' : '') + run.model.text() + (run.errors.textContent ? '\n' + run.errors.textContent : '')).join('\n\n');
    send('copy', { text });
  });
  $('latest').addEventListener('click', () => { following = true; output.scrollTop = output.scrollHeight; $('latest').hidden = true; });
  output.addEventListener('scroll', () => {
    following = output.scrollHeight - output.scrollTop - output.clientHeight < 32;
    $('latest').hidden = following;
  });
  input.addEventListener('input', resizeInput);
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
    else if (!busy && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey && !event.ctrlKey && !event.metaKey && !input.value.includes('\n')) {
      if (!history.length) return;
      event.preventDefault();
      if (historyIndex === history.length) draft = input.value;
      historyIndex = Math.max(0, Math.min(history.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
      input.value = historyIndex === history.length ? draft : history[historyIndex];
      input.setSelectionRange(input.value.length, input.value.length); resizeInput();
    }
  });
  document.addEventListener('keydown', event => {
    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return;
    const key = event.key.toLowerCase();
    const selected = window.getSelection()?.toString() || (document.activeElement === input && input.selectionStart !== input.selectionEnd);
    if (key === 'f') { event.preventDefault(); toggleSearch(true); }
    else if (key === 'c' && busy && !selected && !event.shiftKey) { event.preventDefault(); send('stop'); }
    else if (key === 'l') { event.preventDefault(); send('clear'); }
    else if (key === 'd' && busy) { event.preventDefault(); send('eof'); }
  });
  send('ready'); input.focus();
})();
