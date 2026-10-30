const SITE_ORIGIN = 'https://xn--d1ah4a.com';
const ICON = 'assets/icons/icon128.png';
const DATA_KEYS = ['notifIndex', 'daily', 'snapshots', 'followLists', 'followDiff', 'listsAt', 'me', 'lastCount'];
const DEFAULT_SETTINGS = { notify: true, badge: true, analytics: true, profilePosts: true };
const TYPE_LABELS = { like: 'лайк', comment: 'комментарий', follow: 'подписка', repost: 'репост', mention: 'упоминание' };

let token = null;

function dateKeyOf(time) {
  const date = new Date(time);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function read(key, fallback) {
  const data = await chrome.storage.local.get(key);
  return data[key] === undefined ? fallback : data[key];
}

async function write(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

function pruneMap(map, maxEntries) {
  const keys = Object.keys(map).sort();
  while (keys.length > maxEntries) delete map[keys.shift()];
  return map;
}

async function setBadge(count) {
  const settings = await read('settings', DEFAULT_SETTINGS);
  if (!settings.badge) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  if (count === null || count === undefined) return;
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#141414' });
    await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  } catch {}
  await chrome.action.setBadgeText({ text: count > 99 ? '99+' : String(count) });
}

function showSystemNotification(item) {
  const label = TYPE_LABELS[item.type] || item.type;
  const actor = item.actor && item.actor.displayName ? item.actor.displayName : 'ИТД';
  const message = item.preview && item.preview.length ? item.preview.slice(0, 160) : label;
  chrome.notifications.create(`itdplus:${item.id}`, {
    type: 'basic',
    iconUrl: ICON,
    title: `${actor} — ${label}`,
    message,
  });
}

async function loadToken() {
  if (token) return token;
  const data = await chrome.storage.session.get(['token']);
  token = data.token || null;
  return token;
}

function registerHarvest() {
  const stats = registerHarvest.stats || (registerHarvest.stats = { events: 0, auth: 0 });
  const listener = details => {
    try {
      stats.events += 1;
      const header = (details.requestHeaders || []).find(item => item.name && item.name.toLowerCase() === 'authorization');
      const value = header && header.value;
      if (value && value.startsWith('Bearer ')) {
        stats.auth += 1;
        const found = value.slice(7);
        if (found && found !== token) {
          token = found;
          chrome.storage.session.set({ token }).catch(() => {});
          chrome.storage.local.set({ swHarvest: { events: stats.events, auth: stats.auth, at: Date.now() } }).catch(() => {});
        }
      } else if (stats.events % 25 === 0) {
        chrome.storage.local.set({ swHarvest: { events: stats.events, auth: stats.auth, at: Date.now() } }).catch(() => {});
      }
    } catch {}
  };
  const filter = { urls: ['https://xn--d1ah4a.com/api/*'] };
  let mode = null;
  try {
    chrome.webRequest.onBeforeSendHeaders.addListener(listener, filter, ['requestHeaders', 'extraHeaders']);
    mode = 'extraHeaders';
  } catch (error) {
    mode = 'extraError:' + String(error).slice(0, 160);
    try {
      chrome.webRequest.onBeforeSendHeaders.addListener(listener, filter, ['requestHeaders']);
      mode += '|plain';
    } catch (error2) {
      mode += '|plainError:' + String(error2).slice(0, 160);
    }
  }
  chrome.storage.local.set({ swDiag: { at: Date.now(), webRequest: typeof chrome.webRequest, mode } }).catch(() => {});
}

async function handlePoll(message) {
  const settings = await read('settings', DEFAULT_SETTINGS);
  if (message.count !== null && message.count !== undefined) {
    await write('lastCount', message.count);
    await setBadge(message.count);
  }

  if (message.me && message.me.username) {
    const previous = await read('me', null);
    await write('me', {
      ...message.me,
      at: Date.now(),
      previous: previous && previous.followersCount !== undefined
        ? { followersCount: previous.followersCount, followingCount: previous.followingCount, postsCount: previous.postsCount }
        : null,
    });
    if (settings.analytics) {
      const snapshots = pruneMap(await read('snapshots', {}), 90);
      snapshots[dateKeyOf(Date.now())] = {
        followers: message.me.followersCount,
        following: message.me.followingCount,
        posts: message.me.postsCount,
        at: Date.now(),
      };
      await write('snapshots', snapshots);
    }
  }

  const items = Array.isArray(message.items) ? message.items : [];
  if (items.length) {
    const index = await read('notifIndex', {});
    const daily = pruneMap(await read('daily', {}), 90);
    let created = 0;
    for (const item of items) {
      if (!item || !item.id || index[item.id]) continue;
      index[item.id] = {
        id: item.id,
        type: item.type || 'other',
        actor: item.actor || null,
        preview: item.preview || '',
        targetType: item.targetType || null,
        targetId: item.targetId || null,
        createdAt: item.createdAt || new Date().toISOString(),
        read: Boolean(item.read),
      };
      if (settings.analytics) {
        const key = dateKeyOf(index[item.id].createdAt);
        if (!daily[key]) daily[key] = { byType: {} };
        const type = index[item.id].type;
        daily[key].byType[type] = (daily[key].byType[type] || 0) + 1;
      }
      if (settings.notify && !index[item.id].read) showSystemNotification(index[item.id]);
      created += 1;
    }
    if (created) {
      const entries = Object.values(index).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const trimmed = {};
      for (const entry of entries.slice(0, 2000)) trimmed[entry.id] = entry;
      await write('notifIndex', trimmed);
      if (settings.analytics) await write('daily', daily);
    }
  }
  return { ok: true };
}

async function handleFollowLists(message) {
  const followers = Array.isArray(message.followers) ? message.followers : [];
  const following = Array.isArray(message.following) ? message.following : [];
  if (!followers.length && !following.length) return { ok: false };
  const previous = await read('followLists', null);
  if (!previous || !Array.isArray(previous.followers) || !Array.isArray(previous.following)) {
    await write('followLists', { followers, following, at: Date.now() });
    return { ok: true, baseline: true };
  }
  const oldFollowers = new Set(previous.followers);
  const newFollowers = new Set(followers);
  const oldFollowing = new Set(previous.following);
  const newFollowing = new Set(following);
  const diff = {
    date: new Date().toISOString(),
    addedFollowers: followers.filter(name => !oldFollowers.has(name)),
    removedFollowers: previous.followers.filter(name => !newFollowers.has(name)),
    addedFollowing: following.filter(name => !oldFollowing.has(name)),
    removedFollowing: previous.following.filter(name => !newFollowing.has(name)),
  };
  const history = await read('followDiff', []);
  history.unshift(diff);
  await write('followDiff', history.slice(0, 60));
  await write('followLists', { followers, following, at: Date.now() });
  return { ok: true };
}

chrome.storage.local.set({ swBoot: { at: Date.now() } }).catch(() => {});
registerHarvest();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.kind) return false;
  if (message.kind === 'ping') {
    loadToken()
      .then(current => sendResponse({ ok: true, token: current || null }))
      .catch(() => sendResponse({ ok: false, token: null }));
    return true;
  }
  if (message.kind === 'poll') {
    handlePoll(message).then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.kind === 'followLists') {
    handleFollowLists(message).then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message.kind === 'clearData') {
    chrome.storage.local.remove(DATA_KEYS).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.kind === 'settingsChanged') {
    read('lastCount', null).then(count => setBadge(count)).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

chrome.action.onClicked.addListener(async tab => {
  if (tab && tab.url && tab.url.startsWith(SITE_ORIGIN)) {
    chrome.tabs.sendMessage(tab.id, { kind: 'openPanel', tab: 'settings' }).catch(() => {});
    return;
  }
  const tabs = await chrome.tabs.query({ url: `${SITE_ORIGIN}/*` });
  if (tabs.length && tabs[0].id) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    chrome.tabs.sendMessage(tabs[0].id, { kind: 'openPanel', tab: 'settings' }).catch(() => {});
    return;
  }
  chrome.tabs.create({ url: `${SITE_ORIGIN}/` });
});

chrome.notifications.onClicked.addListener(id => {
  if (!id.startsWith('itdplus:')) return;
  chrome.tabs.create({ url: `${SITE_ORIGIN}/notifications` });
});

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await read('settings', null);
  if (!settings) await write('settings', DEFAULT_SETTINGS);
});
