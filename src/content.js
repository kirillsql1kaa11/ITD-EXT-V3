(() => {
  if (window.top !== window.self) return;

  const GEAR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>';

  const UPLOAD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>';

  const state = { token: null, userCache: new Map(), retry: { username: null, left: 0 } };

  function getSettings() {
    return chrome.storage.local.get('settings').then(data => ({ notify: true, badge: true, analytics: true, profilePosts: true, cringe: true, ...(data.settings || {}) }));
  }

  function jwtExpiry(token) {
    try {
      const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(part));
      return payload.exp ? payload.exp * 1000 : 0;
    } catch {
      return 0;
    }
  }

  function tokenUsable(token) {
    return Boolean(token) && jwtExpiry(token) > Date.now() + 30000;
  }

  async function getToken() {
    if (tokenUsable(state.token)) return state.token;
    state.token = null;
    const response = await chrome.runtime.sendMessage({ kind: 'ping' }).catch(() => null);
    if (response && response.token && tokenUsable(response.token)) state.token = response.token;
    return state.token;
  }

  async function fetchJson(path, token) {
    try {
      const response = await fetch(path, {
        credentials: 'include',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-requested-with': 'XMLHttpRequest',
        },
      });
      if (response.status === 401) {
        state.token = null;
        return null;
      }
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  function compactNotification(item) {
    if (!item || !item.id) return null;
    const actor = item.actor || item.user || null;
    return {
      id: String(item.id),
      type: item.type || 'other',
      actor: actor ? { id: actor.id, username: actor.username, displayName: actor.displayName || actor.name || null, avatar: actor.avatar || null } : null,
      preview: item.preview || item.text || item.body || '',
      targetType: item.targetType || (item.post ? 'post' : null),
      targetId: item.targetId || (item.post && item.post.id) || null,
      createdAt: item.createdAt || item.created_at || new Date().toISOString(),
      read: Boolean(item.read ?? item.isRead),
    };
  }

  async function fetchAllPages(path, token) {
    const names = [];
    let page = 1;
    let hasMore = true;
    while (hasMore && page <= 400) {
      const separator = path.includes('?') ? '&' : '?';
      const data = await fetchJson(`${path}${separator}page=${page}&limit=50`, token);
      if (!data) break;
      const payload = data.data && typeof data.data === 'object' ? data.data : data;
      const list = payload.users || payload.items || (Array.isArray(payload) ? payload : []);
      for (const item of list) {
        const user = item.user || item;
        const username = user && user.username;
        if (username) names.push(username);
      }
      const pagination = payload.pagination || data.pagination;
      if (pagination) {
        page = (pagination.page || page) + 1;
        hasMore = Boolean(pagination.hasMore);
      } else {
        page += 1;
        hasMore = list.length >= 50;
      }
    }
    return names;
  }

  async function snapshotListsIfDue(token) {
    const stored = await chrome.storage.local.get(['listsAt', 'me']);
    if (stored.listsAt && Date.now() - stored.listsAt < 20 * 3600 * 1000) return;
    const me = stored.me;
    if (!me || !me.id) return;
    const followers = await fetchAllPages(`/api/users/${me.id}/followers`, token);
    const following = await fetchAllPages(`/api/users/${me.id}/following`, token);
    if (!followers.length && !following.length) return;
    await chrome.storage.local.set({ listsAt: Date.now() });
    chrome.runtime.sendMessage({ kind: 'followLists', followers, following }).catch(() => {});
  }

  async function poll() {
    const token = await getToken();
    if (!token) return;
    const [countData, listData] = await Promise.all([
      fetchJson('/api/notifications/count', token),
      fetchJson('/api/notifications/?limit=30', token),
    ]);
    let mePayload = null;
    const storedMe = await chrome.storage.local.get('me');
    if (!storedMe.me || !storedMe.me.at || Date.now() - storedMe.me.at > 10 * 60 * 1000) {
      const meData = await fetchJson('/api/users/me', token);
      if (meData && meData.username) {
        mePayload = {
          id: meData.id,
          username: meData.username,
          followersCount: meData.followersCount,
          followingCount: meData.followingCount,
          postsCount: meData.postsCount,
        };
      }
    }
    let count = null;
    if (countData) {
      if (countData.count !== undefined && countData.count !== null) count = countData.count;
      else if (countData.data && countData.data.count !== undefined && countData.data.count !== null) count = countData.data.count;
    }
    const rawList = listData && (listData.notifications || listData.items || (Array.isArray(listData) ? listData : []));
    const items = Array.isArray(rawList) ? rawList.map(compactNotification).filter(Boolean) : [];
    if (count !== null || items.length || mePayload) {
      chrome.runtime.sendMessage({ kind: 'poll', count, items, me: mePayload }).catch(() => {});
    }
    snapshotListsIfDue(token).catch(() => {});
  }

  function injectNavButton() {
    if (document.querySelector('[data-itdplus="nav-settings"]')) return;
    const nav = document.querySelector('nav');
    if (!nav) return;
    const profileLink = [...nav.querySelectorAll('a[href^="/@"]')].find(link => /^\/@[^/]+\/?$/.test(new URL(link.href).pathname));
    if (!profileLink) return;
    const classCounts = new Map();
    for (const link of nav.querySelectorAll('a')) for (const name of link.classList) classCounts.set(name, (classCounts.get(name) || 0) + 1);
    const clone = profileLink.cloneNode(true);
    for (const name of [...clone.classList]) if (classCounts.get(name) === 1) clone.classList.remove(name);
    clone.setAttribute('data-itdplus', 'nav-settings');
    clone.setAttribute('href', '#');
    clone.setAttribute('title', 'Настройки расширения ITD EXTENDED');
    const spans = clone.querySelectorAll(':scope > span');
    if (spans.length >= 2) {
      spans[0].innerHTML = GEAR_SVG;
      spans[spans.length - 1].textContent = 'ITD EXTENDED';
    } else {
      clone.textContent = 'ITD EXTENDED';
    }
    clone.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      globalThis.ITDPanel.open('settings');
    });
    profileLink.after(clone);
  }

  const BRAND_LOGO = '<svg data-itdplus="logo" xmlns="http://www.w3.org/2000/svg" width="128" height="18" viewBox="0 0 128 18" fill="none" style="overflow: visible"><rect x="0.75" y="0.75" width="16.5" height="16.5" rx="5.25" stroke="currentColor" stroke-width="1.5"/><g transform="translate(4 3.2) scale(0.83)"><path fill="currentColor" d="M9 0 3 9V0H0v14h3l6-9v9h3V0H9Z"/></g><text x="24" y="13.4" fill="currentColor" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-size="11.5" font-weight="800" letter-spacing="0.7">ITD EXTENDED</text></svg>';

  function applyBrand() {
    const versionButton = document.querySelector('button[data-itdplus="version"]') || document.querySelector('button[title="Что нового"]');
    if (versionButton) {
      if (!versionButton.hasAttribute('data-itdplus')) versionButton.setAttribute('data-itdplus', 'version');
      if (versionButton.getAttribute('title') !== 'ITD EXTENDED — что нового') versionButton.setAttribute('title', 'ITD EXTENDED — что нового');
      const label = 'v' + chrome.runtime.getManifest().version;
      if (versionButton.textContent.trim() !== label) versionButton.textContent = label;
      const row = versionButton.parentElement;
      const siteLogo = row && row.querySelector(':scope > svg');
      if (siteLogo && siteLogo.getAttribute('data-itdplus') !== 'logo') {
        const template = document.createElement('template');
        template.innerHTML = BRAND_LOGO;
        siteLogo.replaceWith(template.content.firstChild);
      }
    }
    const iconHref = chrome.runtime.getURL('assets/icons/icon48.png');
    let iconLink = document.querySelector('link[rel~="icon"]');
    if (!iconLink) {
      iconLink = document.createElement('link');
      iconLink.setAttribute('rel', 'icon');
      document.head.appendChild(iconLink);
    }
    if (iconLink.getAttribute('href') !== iconHref) iconLink.setAttribute('href', iconHref);
  }

  function profileUsername() {
    const match = location.pathname.match(/^\/@([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  async function getProfile(username) {
    const cached = state.userCache.get(username);
    const ttl = cached && cached.data ? 5 * 60 * 1000 : 15 * 1000;
    if (cached && Date.now() - cached.at < ttl) return cached.data;
    const token = await getToken();
    const data = token ? await fetchJson(`/api/users/${encodeURIComponent(username)}`, token) : null;
    state.userCache.set(username, { at: Date.now(), data });
    return data;
  }

  function schedulePostsRetry(username) {
    if (state.retry.username !== username) {
      state.retry.username = username;
      state.retry.left = 6;
    }
    if (state.retry.left <= 0) return;
    state.retry.left -= 1;
    setTimeout(() => {
      injectPostsStat().catch(() => {});
    }, 3000);
  }

  const FOLLOWERS_LABEL = /^подписчик/i;
  const FOLLOWING_LABEL = /^подпис(ок|ка|ки)$/i;

  function findStatBlock(matcher) {
    for (const span of document.querySelectorAll('span')) {
      if (matcher.test(span.textContent.trim()) && !span.closest('[data-itdplus]')) return span.parentElement;
    }
    return null;
  }

  function setStatValue(block, value) {
    if (!block || value === undefined || value === null) return;
    const number = block.querySelector('span');
    if (!number) return;
    const full = String(value);
    if (number.textContent.trim() !== full) number.textContent = full;
  }

  function expandStatCounts(data) {
    setStatValue(findStatBlock(FOLLOWERS_LABEL), data.followersCount);
    setStatValue(findStatBlock(FOLLOWING_LABEL), data.followingCount);
  }

  async function injectPostsStat() {
    const username = profileUsername();
    if (!username) return;
    const followingBlock = findStatBlock(FOLLOWING_LABEL);
    if (!followingBlock || followingBlock.children.length < 2) return;
    const data = await getProfile(username);
    if (data && (data.followersCount !== undefined || data.followingCount !== undefined)) expandStatCounts(data);
    if (document.querySelector('[data-itdplus="posts-stat"]')) return;
    const settings = await getSettings();
    if (!settings.profilePosts) return;
    if (!data || data.postsCount === undefined || data.postsCount === null) {
      schedulePostsRetry(username);
      return;
    }
    state.retry.left = 0;
    const clone = followingBlock.cloneNode(true);
    clone.setAttribute('data-itdplus', 'posts-stat');
    clone.setAttribute('title', 'Всего постов: считается через API итд.com');
    clone.querySelector('span:first-child').textContent = String(data.postsCount);
    clone.querySelector('span:last-child').textContent = 'постов';
    followingBlock.after(clone);
    const container = followingBlock.parentElement;
    if (container && !container.getAttribute('data-itdplus-wrap')) {
      container.setAttribute('data-itdplus-wrap', '1');
      container.style.flexWrap = 'wrap';
      container.style.rowGap = '10px';
    }
  }

  const INJECTED_STYLE_ID = 'itdplus-page-style';

  const INJECTED_CSS = `
[data-itdplus="cringe"]{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;margin-right:8px;border-radius:999px;border:1px solid transparent;font:600 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:inherit;background:rgba(127,127,127,.14);cursor:pointer;user-select:none}
[data-itdplus="cringe"]:hover{filter:brightness(1.12)}
[data-itdplus="cringe"][data-level="0"]{background:rgba(46,160,67,.16);border-color:rgba(46,160,67,.4)}
[data-itdplus="cringe"][data-level="1"]{background:rgba(152,183,63,.16);border-color:rgba(152,183,63,.4)}
[data-itdplus="cringe"][data-level="2"]{background:rgba(210,153,34,.18);border-color:rgba(210,153,34,.45)}
[data-itdplus="cringe"][data-level="3"]{background:rgba(219,109,40,.2);border-color:rgba(219,109,40,.5)}
[data-itdplus="cringe"][data-level="4"]{background:rgba(214,55,55,.22);border-color:rgba(214,55,55,.55)}
.itdplus-cringe-pop{position:fixed;z-index:2147483000;width:270px;box-sizing:border-box;background:#1c1c1e;color:#f2f2f7;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:12px 14px;font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;box-shadow:0 14px 34px rgba(0,0,0,.45)}
.itdplus-cringe-pop .itdplus-cringe-head{font-weight:700;margin-bottom:6px}
.itdplus-cringe-pop ul{margin:0;padding-left:16px}
.itdplus-cringe-pop li{margin:4px 0}
.itdplus-cringe-pop .itdplus-cringe-foot{margin-top:8px;opacity:.6;font-size:11px}
.itdplus-b-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;padding:16px;font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.itdplus-b-card{width:min(1160px,100%);max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;background:#1c1c1e;color:#f2f2f7;border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:12px}
.itdplus-b-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.itdplus-b-title{font-size:16px;font-weight:700}
.itdplus-b-x{background:none;border:none;color:inherit;font-size:22px;line-height:1;padding:2px 9px;border-radius:8px;cursor:pointer}
.itdplus-b-x:hover{background:rgba(127,127,127,.2)}
.itdplus-b-empty{border:1.5px dashed rgba(127,127,127,.55);border-radius:12px;padding:34px 16px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px}
.itdplus-b-hint{font-size:13px;opacity:.75}
.itdplus-b-btn{background:#3a3a3c;color:#fff;border:none;border-radius:10px;padding:9px 16px;font:600 14px/1 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;cursor:pointer}
.itdplus-b-btn:hover{filter:brightness(1.12)}
.itdplus-b-btn.primary{background:#0a84ff}
.itdplus-b-btn.ghost{background:rgba(127,127,127,.24)}
.itdplus-b-btn:disabled{opacity:.45;cursor:default;filter:none}
.itdplus-b-stage{position:relative;width:min(100%,calc(56vh * 2.8947));margin:0 auto;aspect-ratio:1100/380;overflow:hidden;border-radius:12px;background:#111;touch-action:none;display:none}
.itdplus-b-stage.ready{display:block;cursor:grab}
.itdplus-b-stage.dragging{cursor:grabbing}
.itdplus-b-img{position:absolute;left:0;top:0;transform-origin:0 0;max-width:none;max-height:none;user-select:none;-webkit-user-drag:none;pointer-events:none}
.itdplus-b-grid{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .15s;background-image:linear-gradient(rgba(255,255,255,.3) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.3) 1px,transparent 1px);background-size:calc(100% / 3) calc(100% / 3)}
.itdplus-b-stage:hover .itdplus-b-grid{opacity:1}
.itdplus-b-controls{display:none;align-items:center;gap:10px;flex-wrap:wrap}
.itdplus-b-controls.ready{display:flex}
.itdplus-b-controls input[type="range"]{flex:1;min-width:120px;accent-color:#0a84ff}
.itdplus-b-status{font-size:13px;min-height:18px;color:rgba(242,242,247,.85)}
.itdplus-b-status.error{color:#ff6b60}
.itdplus-b-status.ok{color:#30d158}
.itdplus-b-actions{display:flex;justify-content:flex-end;gap:10px}
`;

  function ensureStyles() {
    if (document.getElementById(INJECTED_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = INJECTED_STYLE_ID;
    style.textContent = INJECTED_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function makeElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const CRINGE_LEVELS = [
    { icon: '😎', word: 'чисто' },
    { icon: '🙂', word: 'норм' },
    { icon: '😐', word: 'спорно' },
    { icon: '😬', word: 'кринж' },
    { icon: '🤯', word: 'жёстко' },
  ];

  function cringeScore(raw) {
    const text = raw.replace(/\s+/g, ' ').trim();
    const tips = [];
    let score = 0;
    const letters = (text.match(/[A-Za-zА-Яа-яЁё]/g) || []).length;
    const caps = (text.match(/[A-ZА-ЯЁ]/g) || []).length;
    if (letters >= 10 && caps / letters > 0.5) {
      score += 35;
      tips.push('Больше половины текста капсом — похоже на крик');
    } else if (letters >= 10 && caps / letters > 0.3) {
      score += 18;
      tips.push('Многовато КАПСА — можно спокойнее');
    }
    const runs = text.match(/[!?]{2,}/g) || [];
    if (runs.length >= 2 || runs.some(run => run.length >= 3)) {
      score += 16;
      tips.push('Много «!!!» и «?!» — обычно хватает одного знака');
    }
    if (/(.)\1{3,}/u.test(text)) {
      score += 14;
      tips.push('Буквы растянуты: «привееееет» читается тяжелее');
    }
    if (/[)(]{4,}/.test(text)) {
      score += 10;
      tips.push('Гирлянда из скобок ))))) — это ещё из ВК');
    }
    const emoji = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
    if (emoji >= 6 || (emoji >= 3 && letters > 0 && emoji / (letters + emoji) > 0.25)) {
      score += 14;
      tips.push('Много эмодзи — смысл тонет в 🌈✨🔥');
    }
    if (/\.{5,}/.test(text)) {
      score += 8;
      tips.push('Очень длинное многоточие');
    }
    if (letters >= 24 && !/\s/.test(text)) {
      score += 12;
      tips.push('Нет ни одного пробела — читать тяжело');
    }
    score = Math.min(100, score);
    const level = score >= 80 ? 4 : score >= 60 ? 3 : score >= 40 ? 2 : score >= 20 ? 1 : 0;
    return { score, tips, level };
  }

  let cringePop = null;
  let cringePopClose = null;

  function closeCringePop() {
    if (cringePopClose) {
      document.removeEventListener('mousedown', cringePopClose);
      cringePopClose = null;
    }
    if (cringePop) {
      cringePop.remove();
      cringePop = null;
    }
  }

  function renderCringePop(pop, chip) {
    const result = chip.itdplusResult || { score: 0, tips: [], level: 0 };
    const level = CRINGE_LEVELS[result.level];
    pop.textContent = '';
    pop.appendChild(makeElement('div', 'itdplus-cringe-head', `Кринж-сканер: ${level.icon} ${result.score}% — ${level.word}`));
    if (result.tips.length) {
      const list = makeElement('ul');
      for (const tip of result.tips) list.appendChild(makeElement('li', null, tip));
      pop.appendChild(list);
    } else {
      pop.appendChild(makeElement('div', null, 'Всё чисто — хороший пост ✨'));
    }
    pop.appendChild(makeElement('div', 'itdplus-cringe-foot', 'Совет, а не блокировка. Отключить: ITD EXTENDED → Настройки.'));
  }

  function toggleCringePop(chip) {
    if (cringePop && cringePop.itdplusChip === chip) {
      closeCringePop();
      return;
    }
    closeCringePop();
    ensureStyles();
    const pop = makeElement('div', 'itdplus-cringe-pop');
    pop.itdplusChip = chip;
    renderCringePop(pop, chip);
    document.body.appendChild(pop);
    cringePop = pop;
    const rect = chip.getBoundingClientRect();
    let left = rect.left;
    if (left + 270 > window.innerWidth - 12) left = window.innerWidth - 282;
    if (left < 12) left = 12;
    pop.style.left = `${left}px`;
    let top = rect.top - pop.offsetHeight - 10;
    if (top < 12) top = rect.bottom + 10;
    pop.style.top = `${top}px`;
    cringePopClose = event => {
      if (!cringePop) return;
      if (cringePop.contains(event.target) || chip.contains(event.target)) return;
      closeCringePop();
    };
    setTimeout(() => document.addEventListener('mousedown', cringePopClose), 0);
  }

  const cringeTimers = new WeakMap();

  function queueCringeUpdate(editor) {
    clearTimeout(cringeTimers.get(editor));
    cringeTimers.set(editor, setTimeout(() => updateCringeChip(editor), 250));
  }

  function updateCringeChip(editor) {
    const chip = editor.itdplusChip;
    if (!chip || !chip.isConnected) return;
    const text = editor.innerText || '';
    const letters = (text.match(/[A-Za-zА-Яа-яЁё]/g) || []).length;
    if (letters < 12) {
      chip.style.display = 'none';
      if (cringePop && cringePop.itdplusChip === chip) closeCringePop();
      return;
    }
    chip.style.display = '';
    const result = cringeScore(text);
    chip.itdplusResult = result;
    chip.textContent = `${CRINGE_LEVELS[result.level].icon} ${result.score}%`;
    chip.setAttribute('data-level', String(result.level));
    chip.setAttribute('title', result.tips.length ? `Кринж-сканер: ${result.tips[0]}` : 'Кринж-сканер: всё чисто ✨');
    if (cringePop && cringePop.itdplusChip === chip) renderCringePop(cringePop, chip);
  }

  function composerChipOwner(editor) {
    let node = editor.parentElement;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      for (const button of node.querySelectorAll('button')) {
        if (/^опубликовать$/i.test(button.textContent.trim())) return { host: button.parentElement, button };
      }
    }
    return null;
  }

  function scanComposers() {
    for (const editor of document.querySelectorAll('div[contenteditable="true"][data-placeholder]')) {
      const placeholder = editor.getAttribute('data-placeholder') || '';
      if (!/Что нового|Написать на стене/i.test(placeholder)) continue;
      const owner = composerChipOwner(editor);
      if (!owner) continue;
      let chip = editor.itdplusChip;
      if (!chip || !chip.isConnected) {
        chip = makeElement('button', null, '');
        chip.type = 'button';
        chip.setAttribute('data-itdplus', 'cringe');
        chip.style.display = 'none';
        chip.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          toggleCringePop(chip);
        });
        owner.host.insertBefore(chip, owner.button);
        editor.itdplusChip = chip;
      }
      if (!editor.itdplusBound) {
        editor.itdplusBound = true;
        editor.addEventListener('input', () => queueCringeUpdate(editor));
      }
      updateCringeChip(editor);
    }
  }

  async function applyCringe() {
    const settings = await getSettings();
    if (!settings.cringe) {
      closeCringePop();
      for (const chip of document.querySelectorAll('[data-itdplus="cringe"]')) chip.remove();
      return;
    }
    ensureStyles();
    scanComposers();
  }

  const BANNER_ERRORS = {
    'Banner file not found': 'Файл обложки не найден',
    'You can only use your own files as banner': 'Можно использовать только свои файлы',
    'Banner cannot be NSFW content': 'Обложка не прошла модерацию — попробуйте другое фото',
    'Banner must be an image': 'Обложка должна быть картинкой',
  };

  async function bannerErrorText(response) {
    let message = '';
    try {
      const json = await response.json();
      const inner = json && typeof json.error === 'object' && json.error ? json.error : json;
      message = (inner && (inner.detail || inner.message || inner.title)) || (json && typeof json.error === 'string' ? json.error : '');
    } catch {}
    if (BANNER_ERRORS[message]) return BANNER_ERRORS[message];
    if (/nsfw|prohibited/i.test(message)) return 'Обложка не прошла модерацию — попробуйте другое фото';
    if (response.status === 401) return 'Сессия истекла — обновите страницу и войдите заново';
    if (response.status === 413) return 'Файл слишком большой';
    if (!message) return `Не получилось загрузить баннер (${response.status})`;
    return message;
  }

  async function uploadBanner(blob) {
    const token = await getToken();
    if (!token) throw new Error('Нужно войти на сайт');
    const form = new FormData();
    form.append('file', blob, 'banner.jpg');
    const response = await fetch('/api/files/upload', {
      method: 'POST',
      credentials: 'include',
      headers: { authorization: `Bearer ${token}`, 'x-requested-with': 'XMLHttpRequest' },
      body: form,
    });
    if (!response.ok) throw new Error(await bannerErrorText(response));
    const json = await response.json();
    const file = json && json.data && json.data.id ? json.data : json;
    if (!file || !file.id) throw new Error('Сервер не вернул файл баннера');
    return file;
  }

  async function submitBanner(blob) {
    const token = await getToken();
    if (!token) throw new Error('Нужно войти на сайт');
    const file = await uploadBanner(blob);
    const response = await fetch('/api/users/me', {
      method: 'PUT',
      credentials: 'include',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      body: JSON.stringify({ bannerId: file.id }),
    });
    if (!response.ok) throw new Error(await bannerErrorText(response));
    return file;
  }

  function renderBanner(state) {
    return new Promise(resolve => {
      if (!state.img || !state.sw || !state.sh) {
        resolve(null);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = 1100;
      canvas.height = 380;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1100, 380);
      ctx.drawImage(state.img, -state.ox / state.scale, -state.oy / state.scale, state.sw / state.scale, state.sh / state.scale, 0, 0, 1100, 380);
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.92);
    });
  }

  let bannerOverlay = null;

  function closeBannerModal() {
    if (!bannerOverlay) return;
    if (bannerOverlay.itdplusPaste) document.removeEventListener('paste', bannerOverlay.itdplusPaste, true);
    if (bannerOverlay.itdplusResize) window.removeEventListener('resize', bannerOverlay.itdplusResize);
    if (bannerOverlay.itdplusUrl) URL.revokeObjectURL(bannerOverlay.itdplusUrl);
    bannerOverlay.remove();
    bannerOverlay = null;
  }

  function openBannerModal() {
    if (bannerOverlay) return;
    ensureStyles();

    const overlay = makeElement('div', 'itdplus-b-overlay');
    overlay.setAttribute('data-itdplus', 'banner-overlay');
    const card = makeElement('div', 'itdplus-b-card');
    const head = makeElement('div', 'itdplus-b-head');
    const title = makeElement('div', 'itdplus-b-title', 'Новый баннер');
    const close = makeElement('button', 'itdplus-b-x', '×');
    close.type = 'button';
    head.append(title, close);
    const empty = makeElement('div', 'itdplus-b-empty');
    empty.append(
      makeElement('div', 'itdplus-b-hint', 'Своё фото вместо рисования — подгоним под баннер 1100×380'),
      makeElement('div', 'itdplus-b-hint', 'Ctrl+V — вставить из буфера · или перетащите файл сюда'),
    );
    const choose = makeElement('button', 'itdplus-b-btn primary', 'Выбрать файл с ПК');
    choose.type = 'button';
    const fileInput = makeElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.id = 'itdplus-banner-file';
    fileInput.style.display = 'none';
    empty.append(choose, fileInput);
    const stage = makeElement('div', 'itdplus-b-stage');
    const image = makeElement('img', 'itdplus-b-img');
    const grid = makeElement('div', 'itdplus-b-grid');
    stage.append(image, grid);
    const controls = makeElement('div', 'itdplus-b-controls');
    const pick = makeElement('button', 'itdplus-b-btn ghost', 'Другой файл');
    pick.type = 'button';
    const slider = makeElement('input');
    slider.type = 'range';
    slider.min = '1';
    slider.max = '6';
    slider.step = '0.01';
    slider.value = '1';
    const reset = makeElement('button', 'itdplus-b-btn ghost', 'Сбросить');
    reset.type = 'button';
    controls.append(pick, slider, reset);
    const status = makeElement('div', 'itdplus-b-status');
    const actions = makeElement('div', 'itdplus-b-actions');
    const cancel = makeElement('button', 'itdplus-b-btn ghost', 'Отмена');
    cancel.type = 'button';
    const save = makeElement('button', 'itdplus-b-btn primary', 'Загрузить баннер');
    save.type = 'button';
    save.disabled = true;
    actions.append(cancel, save);
    card.append(head, empty, stage, controls, status, actions);
    overlay.append(card);
    document.body.append(overlay);
    bannerOverlay = overlay;

    const state = { img: null, w: 0, h: 0, sw: 0, sh: 0, scale: 1, min: 1, max: 1, ox: 0, oy: 0, ready: false, busy: false, url: null };
    let drag = null;

    function setStatus(text, kind) {
      status.textContent = text || '';
      status.className = `itdplus-b-status${kind ? ` ${kind}` : ''}`;
    }

    function apply() {
      image.style.width = `${state.w}px`;
      image.style.height = `${state.h}px`;
      image.style.transform = `translate(${state.ox}px, ${state.oy}px) scale(${state.scale})`;
      slider.value = String(state.scale / state.min);
    }

    function clamp() {
      const width = state.w * state.scale;
      const height = state.h * state.scale;
      state.ox = Math.min(0, Math.max(state.sw - width, state.ox));
      state.oy = Math.min(0, Math.max(state.sh - height, state.oy));
    }

    function fit() {
      if (!state.img) return;
      state.sw = stage.clientWidth;
      state.sh = stage.clientHeight;
      const cover = Math.max(state.sw / state.w, state.sh / state.h);
      state.min = cover;
      state.max = cover * 6;
      if (!state.ready) {
        state.scale = cover;
        state.ox = (state.sw - state.w * cover) / 2;
        state.oy = (state.sh - state.h * cover) / 2;
        state.ready = true;
      }
      state.scale = Math.min(state.max, Math.max(state.min, state.scale));
      clamp();
      apply();
    }

    function zoomAt(cx, cy, factor) {
      const next = Math.min(state.max, Math.max(state.min, state.scale * factor));
      const ratio = next / state.scale;
      state.ox = cx - (cx - state.ox) * ratio;
      state.oy = cy - (cy - state.oy) * ratio;
      state.scale = next;
      clamp();
      apply();
    }

    function loadFile(file) {
      if (!file || !file.type || !file.type.startsWith('image/')) {
        setStatus('Это не картинка — нужен файл изображения', 'error');
        return;
      }
      if (state.url) URL.revokeObjectURL(state.url);
      state.url = URL.createObjectURL(file);
      overlay.itdplusUrl = state.url;
      const probe = new Image();
      probe.onload = () => {
        state.img = probe;
        state.w = probe.naturalWidth;
        state.h = probe.naturalHeight;
        state.ready = false;
        image.src = state.url;
        empty.style.display = 'none';
        stage.classList.add('ready');
        controls.classList.add('ready');
        save.disabled = false;
        requestAnimationFrame(() => fit());
        setStatus('');
      };
      probe.onerror = () => setStatus('Не получилось прочитать картинку', 'error');
      probe.src = state.url;
    }

    close.addEventListener('click', closeBannerModal);
    cancel.addEventListener('click', closeBannerModal);
    overlay.addEventListener('mousedown', event => {
      if (event.target === overlay) closeBannerModal();
    });
    choose.addEventListener('click', () => fileInput.click());
    pick.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) loadFile(file);
      fileInput.value = '';
    });
    reset.addEventListener('click', () => {
      state.ready = false;
      fit();
    });
    stage.addEventListener('pointerdown', event => {
      if (!state.img || state.busy) return;
      drag = { x: event.clientX, y: event.clientY };
      stage.classList.add('dragging');
      stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener('pointermove', event => {
      if (!drag) return;
      state.ox += event.clientX - drag.x;
      state.oy += event.clientY - drag.y;
      drag = { x: event.clientX, y: event.clientY };
      clamp();
      apply();
    });
    const endDrag = () => {
      drag = null;
      stage.classList.remove('dragging');
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('dblclick', () => {
      state.ready = false;
      fit();
    });
    stage.addEventListener('wheel', event => {
      if (!state.img) return;
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * 0.0015));
    }, { passive: false });
    slider.addEventListener('input', () => {
      if (!state.img) return;
      zoomAt(state.sw / 2, state.sh / 2, (state.min * Number(slider.value)) / state.scale);
    });
    overlay.addEventListener('dragover', event => event.preventDefault());
    overlay.addEventListener('drop', event => {
      event.preventDefault();
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) loadFile(file);
    });
    const onPaste = event => {
      const items = event.clipboardData ? [...event.clipboardData.items] : [];
      const item = items.find(entry => entry.type && entry.type.startsWith('image/'));
      if (!item) return;
      const file = item.getAsFile();
      if (!file) return;
      event.preventDefault();
      loadFile(file);
    };
    document.addEventListener('paste', onPaste, true);
    overlay.itdplusPaste = onPaste;
    const onResize = () => {
      if (state.img) {
        state.ready = false;
        fit();
      }
    };
    window.addEventListener('resize', onResize);
    overlay.itdplusResize = onResize;
    save.addEventListener('click', async () => {
      if (state.busy || !state.img) return;
      state.busy = true;
      save.disabled = true;
      setStatus('Готовим картинку…');
      try {
        const blob = await renderBanner(state);
        if (!blob) throw new Error('Не получилось собрать картинку');
        setStatus('Загружаем баннер…');
        await submitBanner(blob);
        setStatus('Готово! Обновляем страницу…', 'ok');
        setTimeout(() => location.reload(), 900);
      } catch (error) {
        state.busy = false;
        save.disabled = false;
        setStatus(String(error && error.message ? error.message : error) || 'Не получилось загрузить баннер', 'error');
      }
    });
  }

  function injectBannerButton() {
    const drawButton = document.querySelector('button[title="Нарисовать баннер"]');
    if (!drawButton) return;
    if (document.querySelector('[data-itdplus="banner-upload"]')) return;
    const button = drawButton.cloneNode(true);
    button.setAttribute('data-itdplus', 'banner-upload');
    button.setAttribute('title', 'Загрузить баннер');
    button.removeAttribute('disabled');
    button.innerHTML = UPLOAD_SVG;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openBannerModal();
    });
    drawButton.after(button);
  }

  let injectTimer = null;
  function scheduleInject() {
    clearTimeout(injectTimer);
    injectTimer = setTimeout(() => {
      applyBrand();
      injectNavButton();
      injectPostsStat().catch(() => {});
      injectBannerButton();
      applyCringe().catch(() => {});
    }, 400);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.kind === 'openPanel') {
      globalThis.ITDPanel.open(message.tab || 'settings');
      return false;
    }
    return false;
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll().catch(() => {});
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) scheduleInject();
  });

  new MutationObserver(scheduleInject).observe(document.documentElement, { childList: true, subtree: true });

  scheduleInject();
  poll().catch(() => {});
  setTimeout(() => poll().catch(() => {}), 6000);
  setTimeout(() => poll().catch(() => {}), 16000);
  setInterval(() => poll().catch(() => {}), 60000);
})();
