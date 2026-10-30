globalThis.ITDPanel = (() => {
  const HOST_ID = 'itdplus-panel-host';
  const DEFAULT_SETTINGS = { notify: true, badge: true, analytics: true, profilePosts: true, cringe: true };
  const TABS = [
    { id: 'settings', label: 'Настройки' },
    { id: 'analytics', label: 'Аналитика' },
    { id: 'missed', label: 'Пропущено' },
    { id: 'follows', label: 'Подписки' },
  ];
  const TYPE_ICONS = { like: '❤️', comment: '💬', follow: '👤', repost: '🔁', mention: '📣' };
  const TYPE_WORDS = { like: 'лайк', comment: 'комментарий', follow: 'подписка', repost: 'репост', mention: 'упоминание' };

  let host = null;
  let shadow = null;
  let activeTab = 'settings';
  let escHandler = null;

  function h(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.append(child);
    return node;
  }

  function palette() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (dark) {
      return { backdrop: 'rgba(0,0,0,.65)', card: '#1b1b1d', text: '#f4f4f5', sub: '#8e8e93', line: '#2b2b2e', chip: '#26262a', accent: '#f4f4f5', thumb: '#1b1b1d', danger: '#ff6b60' };
    }
    return { backdrop: 'rgba(20,20,20,.45)', card: '#ffffff', text: '#141414', sub: '#8a8a8e', line: '#ececf0', chip: '#f4f4f6', accent: '#141414', thumb: '#ffffff', danger: '#d92d20' };
  }

  function panelCss(c) {
    return `
      .overlay { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; background: ${c.backdrop}; font-family: Inter, -apple-system, 'Segoe UI', sans-serif; padding: 24px; box-sizing: border-box; }
      .card { width: min(640px, 96vw); max-height: min(80vh, 720px); background: ${c.card}; color: ${c.text}; border-radius: 20px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.35); }
      .head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 8px; }
      .title { display: flex; align-items: baseline; gap: 8px; }
      .logo { font-weight: 700; font-size: 18px; }
      .ver { color: ${c.sub}; font-size: 12px; }
      .close { border: none; background: transparent; color: ${c.sub}; font-size: 15px; cursor: pointer; padding: 6px 9px; border-radius: 8px; font-family: inherit; }
      .close:hover { background: ${c.chip}; color: ${c.text}; }
      .tabs { display: flex; gap: 4px; padding: 0 14px 10px; border-bottom: 1px solid ${c.line}; }
      .tab { border: none; background: transparent; color: ${c.sub}; padding: 8px 14px; border-radius: 10px; font-size: 14px; cursor: pointer; font-family: inherit; }
      .tab:hover { color: ${c.text}; }
      .tab.active { background: ${c.chip}; color: ${c.text}; font-weight: 600; }
      .body { padding: 14px 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
      .foot { padding: 10px 18px; border-top: 1px solid ${c.line}; color: ${c.sub}; font-size: 12px; }
      .row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 10px 2px; }
      .row-title { font-size: 14px; font-weight: 500; }
      .row-hint { font-size: 12px; color: ${c.sub}; margin-top: 2px; }
      .switch { position: relative; display: inline-flex; flex-shrink: 0; cursor: pointer; }
      .switch input { position: absolute; opacity: 0; pointer-events: none; }
      .track { width: 46px; height: 26px; border-radius: 999px; background: ${c.chip}; display: inline-flex; align-items: center; padding: 3px; transition: background .15s ease; box-sizing: border-box; }
      input:checked + .track { background: ${c.accent}; }
      .thumb { width: 20px; height: 20px; border-radius: 50%; background: ${c.thumb}; box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: transform .15s ease; }
      input:checked + .track .thumb { transform: translateX(20px); }
      .chips { display: flex; gap: 8px; }
      .chip { background: ${c.chip}; border-radius: 14px; padding: 10px 14px; display: flex; flex-direction: column; min-width: 92px; box-sizing: border-box; }
      .chip-value { font-size: 20px; font-weight: 700; }
      .chip-label { font-size: 11px; color: ${c.sub}; margin-top: 2px; }
      .line { font-size: 13px; }
      .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: ${c.sub}; margin-top: 8px; }
      .chart { display: flex; align-items: flex-end; gap: 4px; height: 120px; padding: 8px 2px 0; }
      .col { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; height: 100%; gap: 6px; }
      .bar { width: 100%; border-radius: 4px 4px 2px 2px; background: ${c.accent}; min-height: 2px; }
      .col-label { font-size: 9px; color: ${c.sub}; }
      .actions { display: flex; gap: 8px; margin-top: 6px; }
      .btn { border: 1px solid ${c.line}; background: transparent; color: ${c.text}; border-radius: 12px; padding: 10px 14px; font-size: 13px; cursor: pointer; font-family: inherit; }
      .btn:hover { background: ${c.chip}; }
      .btn.danger { color: ${c.danger}; }
      .item { display: flex; gap: 10px; align-items: flex-start; padding: 10px; border-radius: 12px; cursor: pointer; }
      .item:hover { background: ${c.chip}; }
      .item-icon { font-size: 18px; line-height: 1.3; }
      .item-main { flex: 1; min-width: 0; }
      .item-title { font-size: 13px; }
      .item.unread .item-title { font-weight: 600; }
      .item-preview { font-size: 12px; color: ${c.sub}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .item-time { font-size: 11px; color: ${c.sub}; white-space: nowrap; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #ff3b30; margin-top: 5px; flex-shrink: 0; }
      .dot.hidden { opacity: 0; }
      .empty { color: ${c.sub}; font-size: 13px; padding: 16px 4px; text-align: center; }
      .diff { border: 1px solid ${c.line}; border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
      .diff-date { font-size: 12px; color: ${c.sub}; }
      .diff-row { display: flex; flex-direction: column; gap: 6px; }
      .diff-title { font-size: 12px; color: #2f9e44; }
      .diff-title.remove { color: ${c.danger}; }
      .name-chips { display: flex; flex-wrap: wrap; gap: 4px; }
      .name-chip { font-size: 12px; background: ${c.chip}; border-radius: 999px; padding: 3px 9px; color: ${c.text}; text-decoration: none; }
      .name-chip:hover { text-decoration: underline; }
    `;
  }

  function dateKeyOf(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function last14Days() {
    const days = [];
    for (let i = 13; i >= 0; i -= 1) {
      const date = new Date(Date.now() - i * 86400000);
      days.push({ key: dateKeyOf(date), label: String(date.getDate()) });
    }
    return days;
  }

  function totalOf(day) {
    if (!day || !day.byType) return 0;
    return Object.values(day.byType).reduce((sum, count) => sum + count, 0);
  }

  function describeByType(byType) {
    return Object.entries(byType || {}).map(([type, count]) => `${count} ${TYPE_ICONS[type] || type}`).join(' · ');
  }

  function timeAgo(iso) {
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return 'только что';
    if (minutes < 60) return `${minutes} мин`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ч`;
    return `${Math.floor(hours / 24)} дн`;
  }

  function formatDay(key) {
    const parts = key.split('-');
    return `${parts[2]}.${parts[1]}`;
  }

  function formatDateTime(iso) {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  }

  function makeSwitch(checked, onChange) {
    const input = h('input', { type: 'checkbox' });
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'switch' }, [input, h('span', { class: 'track' }, [h('span', { class: 'thumb' })])]);
  }

  async function exportData() {
    const keys = ['settings', 'notifIndex', 'daily', 'snapshots', 'followLists', 'followDiff', 'me'];
    const data = await chrome.storage.local.get(keys);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `itd-plus-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function clearData() {
    if (!window.confirm('Удалить все собранные данные ITD EXTENDED? Настройки останутся.')) return;
    await chrome.runtime.sendMessage({ kind: 'clearData' }).catch(() => {});
    render();
  }

  async function renderSettings(body) {
    const stored = await chrome.storage.local.get(['settings', 'notifIndex', 'daily', 'snapshots']);
    const settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
    const rows = [
      ['notify', 'Системные уведомления', 'Всплывающие уведомления Windows о новых событиях'],
      ['badge', 'Бейдж на иконке', 'Счётчик непрочитанных в панели Chrome'],
      ['analytics', 'Аналитика', 'Считать лайки, комментарии и подписки по дням'],
      ['profilePosts', 'Счётчик постов на профиле', 'Показывать «N постов» рядом с подписчиками'],
      ['cringe', 'Кринж-сканер постов', 'Живая оценка текста в композере: капс, знаки, эмодзи — совет, а не блокировка'],
    ];
    for (const [key, title, hint] of rows) {
      body.append(h('div', { class: 'row' }, [
        h('div', { class: 'row-main' }, [h('div', { class: 'row-title', text: title }), h('div', { class: 'row-hint', text: hint })]),
        makeSwitch(settings[key], async checked => {
          const current = (await chrome.storage.local.get('settings')).settings || {};
          await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...current, [key]: checked } });
          chrome.runtime.sendMessage({ kind: 'settingsChanged' }).catch(() => {});
        }),
      ]));
    }
    body.append(h('div', { class: 'row-hint', text: `Собрано: ${Object.keys(stored.notifIndex || {}).length} уведомлений · ${Object.keys(stored.daily || {}).length} дней аналитики · ${Object.keys(stored.snapshots || {}).length} снапшотов` }));
    body.append(h('div', { class: 'actions' }, [
      h('button', { class: 'btn', text: 'Экспорт данных', onclick: () => exportData() }),
      h('button', { class: 'btn danger', text: 'Очистить данные', onclick: () => clearData() }),
    ]));
  }

  async function renderAnalytics(body) {
    const stored = await chrome.storage.local.get(['daily', 'snapshots', 'me']);
    const daily = stored.daily || {};
    const today = daily[dateKeyOf(new Date())] || { byType: {} };
    body.append(h('div', { class: 'chips' }, [
      h('div', { class: 'chip' }, [h('div', { class: 'chip-value', text: String(today.byType.like || 0) }), h('div', { class: 'chip-label', text: '❤️ лайков' })]),
      h('div', { class: 'chip' }, [h('div', { class: 'chip-value', text: String(today.byType.comment || 0) }), h('div', { class: 'chip-label', text: '💬 комментов' })]),
      h('div', { class: 'chip' }, [h('div', { class: 'chip-value', text: `+${today.byType.follow || 0}` }), h('div', { class: 'chip-label', text: '👤 подписчиков' })]),
    ]));

    const me = stored.me;
    const snapshots = stored.snapshots || {};
    if (me) {
      const keys = Object.keys(snapshots).sort();
      const last = keys[keys.length - 1];
      const prev = keys[keys.length - 2];
      let delta = '';
      if (last && prev) {
        const change = (snapshots[last].followers || 0) - (snapshots[prev].followers || 0);
        delta = ` (${change >= 0 ? '+' : ''}${change} с ${formatDay(prev)})`;
      }
      body.append(h('div', { class: 'line', text: `Подписчики: ${me.followersCount ?? '—'}${delta} · подписок: ${me.followingCount ?? '—'} · постов: ${me.postsCount ?? '—'}` }));
    }

    const days = last14Days();
    const max = Math.max(1, ...days.map(day => totalOf(daily[day.key])));
    const chart = h('div', { class: 'chart' });
    for (const day of days) {
      const stats = daily[day.key];
      const total = totalOf(stats);
      chart.append(h('div', { class: 'col', title: `${formatDay(day.key)}: ${stats ? describeByType(stats.byType) || '0' : '0'}` }, [
        h('div', { class: 'bar', style: `height:${total === 0 ? 2 : Math.max(6, Math.round((total / max) * 100))}%` }),
        h('div', { class: 'col-label', text: day.label }),
      ]));
    }
    body.append(h('div', { class: 'section-title', text: 'Последние 14 дней' }), chart);
    body.append(h('div', { class: 'row-hint', text: 'Счётчики растут, пока открыта вкладка итд.com' }));
  }

  async function renderMissed(body) {
    const stored = await chrome.storage.local.get(['notifIndex', 'me']);
    const entries = Object.values(stored.notifIndex || {})
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 80);
    if (!entries.length) {
      body.append(h('div', { class: 'empty', text: 'Пока пусто. Уведомления появятся, когда вы будете на сайте.' }));
      return;
    }
    const myUsername = stored.me && stored.me.username;
    for (const entry of entries) {
      const icon = TYPE_ICONS[entry.type] || '🔔';
      const who = entry.actor && entry.actor.displayName ? entry.actor.displayName : 'ИТД';
      const word = TYPE_WORDS[entry.type] || entry.type;
      const item = h('div', { class: `item${entry.read ? '' : ' unread'}` }, [
        h('div', { class: 'item-icon', text: icon }),
        h('div', { class: 'item-main' }, [
          h('div', { class: 'item-title', text: `${who} — ${word}` }),
          entry.preview ? h('div', { class: 'item-preview', text: entry.preview }) : null,
        ]),
        h('div', { class: 'item-time', text: timeAgo(entry.createdAt) }),
        h('div', { class: `dot${entry.read ? ' hidden' : ''}` }),
      ]);
      item.addEventListener('click', () => {
        const url = entry.targetType === 'post' && entry.targetId && myUsername
          ? `${location.origin}/@${myUsername}/post/${entry.targetId}`
          : `${location.origin}/notifications`;
        window.open(url, '_blank');
      });
      body.append(item);
    }
  }

  function diffRow(title, names, remove) {
    if (!names || !names.length) return null;
    const row = h('div', { class: 'diff-row' });
    row.append(h('div', { class: `diff-title${remove ? ' remove' : ''}`, text: `${title}: ${names.length}` }));
    const chips = h('div', { class: 'name-chips' });
    for (const name of names.slice(0, 40)) {
      chips.append(h('a', { class: 'name-chip', href: `${location.origin}/@${name}`, target: '_blank', text: name }));
    }
    row.append(chips);
    return row;
  }

  async function renderFollows(body) {
    const stored = await chrome.storage.local.get(['followDiff', 'followLists', 'me']);
    const me = stored.me;
    if (me) {
      body.append(h('div', { class: 'line', text: `Сейчас: ${me.followersCount ?? '—'} подписчиков · ${me.followingCount ?? '—'} подписок · ${me.postsCount ?? '—'} постов` }));
    }
    const history = stored.followDiff || [];
    if (!history.length) {
      body.append(h('div', { class: 'empty', text: 'Пока нет изменений. Раз в день сохраняются списки, и здесь появится, кто пришёл или ушёл.' }));
      return;
    }
    for (const diff of history.slice(0, 14)) {
      const block = h('div', { class: 'diff' });
      block.append(h('div', { class: 'diff-date', text: formatDateTime(diff.date) }));
      for (const row of [
        diffRow('Новые подписчики', diff.addedFollowers, false),
        diffRow('Отписались', diff.removedFollowers, true),
        diffRow('Новые подписки', diff.addedFollowing, false),
        diffRow('Отписки', diff.removedFollowing, true),
      ]) if (row) block.append(row);
      body.append(block);
    }
  }

  async function renderBody(body) {
    if (activeTab === 'settings') await renderSettings(body);
    else if (activeTab === 'analytics') await renderAnalytics(body);
    else if (activeTab === 'missed') await renderMissed(body);
    else if (activeTab === 'follows') await renderFollows(body);
  }

  async function render() {
    if (!host || !document.documentElement.contains(host)) {
      host = document.createElement('div');
      host.id = HOST_ID;
      shadow = host.attachShadow({ mode: 'open' });
      document.body.append(host);
    }
    const colors = palette();
    shadow.innerHTML = '';
    const overlay = h('div', { class: 'overlay' });
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    const card = h('div', { class: 'card' });
    const head = h('div', { class: 'head' }, [
      h('div', { class: 'title' }, [h('span', { class: 'logo', text: 'ITD EXTENDED' }), h('span', { class: 'ver', text: 'v' + chrome.runtime.getManifest().version })]),
      h('button', { class: 'close', text: '✕', onclick: () => close() }),
    ]);
    const tabs = h('div', { class: 'tabs' });
    for (const tab of TABS) {
      const button = h('button', { class: `tab${tab.id === activeTab ? ' active' : ''}`, text: tab.label });
      button.addEventListener('click', () => {
        activeTab = tab.id;
        render();
      });
      tabs.append(button);
    }
    const body = h('div', { class: 'body' });
    card.append(head, tabs, body);
    overlay.append(card);
    shadow.append(h('style', { text: panelCss(colors) }), overlay);
    await renderBody(body);
  }

  function open(tab) {
    if (tab) activeTab = tab;
    if (!escHandler) {
      escHandler = event => { if (event.key === 'Escape') close(); };
      document.addEventListener('keydown', escHandler, true);
    }
    render().catch(() => {});
  }

  function close() {
    if (escHandler) {
      document.removeEventListener('keydown', escHandler, true);
      escHandler = null;
    }
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    shadow = null;
  }

  return { open, close };
})();
