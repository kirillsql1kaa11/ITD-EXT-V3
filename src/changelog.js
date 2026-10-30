(() => {
  const CHANGELOG = {
    data: [
      {
        version: '0.3.0',
        date: '17 октября 2026',
        changes: [
          'Кринж-сканер постов: живая оценка текста прямо в композере',
          'Тумблер кринж-сканера в настройках панели',
          'Свой баннер загрузкой: кнопка рядом с «Нарисовать баннер»',
          'Фото с ПК или Ctrl+V, обрезка под 1100×380 и мгновенная установка',
        ],
      },
      {
        version: '0.2.0',
        date: '17 октября 2026',
        changes: [
          'Кастомный логотип ITD EXTENDED в боковом меню',
          'Версия расширения и этот changelog вместо платформенных',
          'Иконка ITD EXTENDED во вкладке браузера',
        ],
      },
      {
        version: '0.1.2',
        date: '17 октября 2026',
        changes: [
          'Переименование в «ITD EXTENDED» — меню, панель, название расширения',
          'Полные числа подписчиков и подписок вместо «1.6K»',
          'Счётчик «N постов» и корректные падежи у больших аккаунтов',
        ],
      },
      {
        version: '0.1.1',
        date: '16 октября 2026',
        changes: [
          'Исправлен парсер списков подписчиков и подписок',
          'Версия в панели берётся из манифеста',
        ],
      },
      {
        version: '0.1.0',
        date: '16 октября 2026',
        changes: [
          'Первый релиз: хранитель непрочитанных, бейдж, системные уведомления',
          'Локальная аналитика: лайки, комментарии, репосты по дням',
          'Дифф подписок, снапшоты профиля, панель настроек',
        ],
      },
    ],
  };

  const body = JSON.stringify(CHANGELOG);
  const isTarget = url => typeof url === 'string' && url.includes('/api/platform/changelog');

  const nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    if (isTarget(url)) {
      return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return nativeFetch.apply(this, arguments);
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__itdExtendedUrl = typeof url === 'string' ? url : String(url);
    return nativeOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (payload) {
    if (!isTarget(this.__itdExtendedUrl)) return nativeSend.apply(this, arguments);
    const xhr = this;
    setTimeout(() => {
      try {
        Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
        Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
        Object.defineProperty(xhr, 'responseText', { value: body, configurable: true });
        Object.defineProperty(xhr, 'response', { value: xhr.responseType === 'json' ? CHANGELOG : body, configurable: true });
        xhr.getAllResponseHeaders = () => 'content-type: application/json';
        xhr.getResponseHeader = name => String(name).toLowerCase() === 'content-type' ? 'application/json' : null;
        xhr.dispatchEvent(new Event('readystatechange'));
        xhr.dispatchEvent(new ProgressEvent('load'));
        xhr.dispatchEvent(new ProgressEvent('loadend'));
      } catch {
        nativeSend.call(xhr, payload);
      }
    }, 20);
    return undefined;
  };
})();
