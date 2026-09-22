/* Every string the IT request pages render — form, status page, "my requests",
 * triage and the shared footer. Components hold no literals: if a word appears
 * on screen, its key is here, in both halves.
 *
 * The reader's choice lives in one localStorage key shared by all four routes,
 * so switching language on the form carries over to the status page they land
 * on. Only the defaults differ (see useRequestsLang): the public pages open in
 * English because half the requesters write in it, the triage page in Russian
 * because the IT team works in it. */

export const LANG_KEY = 'it_requests_lang'

export const LANGS = ['en', 'ru']

const en = {
  langName: { en: 'EN', ru: 'RU' },

  // ── form ────────────────────────────────────────────────────────────────
  form: {
    title: 'IT request',
    subtitle: 'Tell us what you need. You get a link to track it, and Slack keeps you posted.',
    groupWho: 'Who',
    groupWhat: 'What',
    groupWhy: 'Why and when',
    email: 'Work email',
    emailPlaceholder: 'name@homealliance.com',
    emailHint: 'We reply here and to Slack.',
    emailForeign: 'That is not a Home Alliance address — you can still send it, but replies may not reach you.',
    slack: 'Slack handle',
    slackPlaceholder: '@name',
    department: 'Department',
    departmentPlaceholder: 'Sales, BBDM, Support…',
    kind: 'Type of request',
    system: 'System',
    summary: 'What is needed',
    summaryPlaceholder: 'Describe it the way you would to a colleague — what happens now, what should happen.',
    workaround: 'What you do today instead',
    workaroundPlaceholder: 'The manual steps this replaces, if any.',
    value: 'What it gives us',
    valuePlaceholder: 'Time saved, errors avoided, revenue — your best guess is fine.',
    impact: 'How urgent',
    people: 'People affected',
    peoplePlaceholder: 'e.g. 12',
    desired: 'Needed by',
    links: 'Links or screenshots',
    linksPlaceholder: 'Paste any links that help',
    submit: 'Send request',
    submitting: 'Sending…',
    required: 'Required',
    checkTitle: 'Already sent one?',
    checkPlaceholder: 'IT-0001 or your email',
    checkGo: 'Check status',
    doneTitle: 'Request sent',
    doneRef: 'Your number',
    doneSlack: 'Sent to Slack — IT sees it now.',
    doneTrack: 'Track this request',
    doneAnother: 'Send another',
    errors: {
      email: 'Enter your work email.',
      slack: 'Enter your Slack handle.',
      kind: 'Pick the type of request.',
      system: 'Pick the system.',
      summary: 'Describe what is needed.',
      impact: 'Pick how urgent it is.',
      generic: 'Could not send the request.',
      rate: 'Too many requests from this address. Try again a bit later.',
    },
  },

  kind: {
    broken: 'Something is broken',
    change: 'Change something',
    access: 'Access',
    data: 'Data or report',
    question: 'Question',
  },
  system: {
    apollo: 'Apollo',
    passport: 'Passport',
    techapp: 'TechApp',
    fos: 'FOS',
    websites: 'Websites',
    ghl_n8n: 'GHL / n8n',
    telephony: 'Telephony',
    other: 'Other',
  },
  impact: {
    blocked: 'Blocked — cannot work',
    daily: 'Slows us down daily',
    can_wait: 'Can wait',
  },
  impactShort: { blocked: 'Blocked', daily: 'Daily', can_wait: 'Can wait' },
  status: {
    new: 'New',
    accepted: 'Accepted',
    in_progress: 'In progress',
    waiting_requester: 'Waiting for you',
    done: 'Done',
    rejected: 'Rejected',
  },
  steps: {
    submitted: 'Submitted',
    accepted: 'Accepted',
    in_progress: 'In progress',
    done: 'Done',
    confirmed: 'Confirmed',
  },

  // ── status page ─────────────────────────────────────────────────────────
  statusPage: {
    title: 'Request',
    lookupTitle: 'Check a request',
    lookupPlaceholder: 'IT-0001',
    lookupGo: 'Open',
    lookupByEmail: 'Or see everything you have sent',
    notFound: 'No request with that number.',
    rejected: 'Rejected',
    rejectedReason: 'Reason',
    owner: 'Owner',
    due: 'Due',
    priority: 'Priority',
    unassigned: 'Not assigned yet',
    none: '—',
    yourRequest: 'Your request',
    itResponse: 'IT response',
    noResponse: 'No reply yet. IT sees new requests in Slack.',
    log: 'History',
    commentTitle: 'Add a comment',
    commentPlaceholder: 'Anything that helps — a screenshot link, a new detail.',
    commentSend: 'Send',
    confirmTitle: 'Did it work?',
    confirm: 'It works — close it',
    reopen: 'Does not work — reopen',
    reopenPlaceholder: 'What is still wrong?',
    reopenSend: 'Reopen',
    confirmed: 'You confirmed this on {date}.',
    autoClosed: 'Closed automatically — nobody confirmed it within 3 working days.',
    fields: {
      kind: 'Type', system: 'System', impact: 'Urgency', department: 'Department',
      workaround: 'Workaround today', value: 'Value', people: 'People affected',
      desired: 'Needed by', links: 'Links', created: 'Sent',
    },
    actor: { requester: 'You', it: 'IT', system: 'System' },
    event: {
      created: 'Request sent',
      status: 'Status: {from} → {to}',
      reply: 'IT replied',
      comment: 'Comment',
      confirm: 'Confirmed by requester',
      reopen: 'Reopened by requester',
      notify: 'Notification',
      system: 'System',
    },
  },

  // ── my requests ─────────────────────────────────────────────────────────
  mine: {
    title: 'My requests',
    emailPlaceholder: 'name@homealliance.com',
    load: 'Show',
    empty: 'Nothing sent from this address yet.',
    prompt: 'Enter your work email to see your requests.',
    newRequest: 'New request',
    sent: 'Sent',
  },

  // ── triage ──────────────────────────────────────────────────────────────
  admin: {
    title: 'Requests triage',
    kpiNew: 'New',
    kpiOverdue: 'No answer > 24 h',
    kpiAccept: 'Avg. time to accept',
    kpiCreated: 'Created (30 d)',
    hours: 'h',
    filterAll: 'All',
    filterClosed: 'Closed',
    systemAll: 'All systems',
    searchPlaceholder: 'Search ref, text, email',
    empty: 'Nothing here.',
    pickOne: 'Pick a request on the left.',
    age: { now: 'just now', hours: '{n} h', days: '{n} d' },
    requester: 'Requester',
    triage: 'Triage',
    ownerPlaceholder: 'Who takes it',
    priorityPlaceholder: 'P0 / P1 / P2',
    duePlaceholder: 'YYYY-MM-DD',
    estimatePlaceholder: 'e.g. 2 d',
    ganttId: 'Gantt task id',
    backlogId: 'Backlog item id',
    linked: 'Linked',
    replyTitle: 'Reply to the requester',
    replyPlaceholder: 'What you want them to read in Slack.',
    save: 'Save and notify in Slack',
    saving: 'Saving…',
    reject: 'Reject…',
    rejectTitle: 'Reject the request',
    rejectPlaceholder: 'Why — the requester sees this.',
    rejectConfirm: 'Reject',
    cancel: 'Cancel',
    saved: 'Saved',
    log: 'History',
    passwordTitle: 'Admin password',
    passwordHint: 'Triage needs the admin password.',
    passwordSubmit: 'Enter',
    passwordWrong: 'Wrong password',
  },

  // ── shared ──────────────────────────────────────────────────────────────
  common: {
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    password: 'Password',
    loading: 'Loading…',
    back: 'Back',
    copy: 'Copy',
    copied: 'Copied',
  },

  notFound: {
    title: 'Page not found',
    text: 'This address does not exist in the dashboard. If it used to work, the page may be newer than the deployed build — reload, or pick one of the links below.',
    home: 'Go to the dashboard',
  },

  footer: {
    team: 'For the team',
    requests: 'Requests',
    admin: 'Admin',
    dashboard: 'Dashboard',
    gantt: 'Team Gantt',
    reports: 'Daily reports',
    review: 'Monthly review',
    submit: 'Submit a request',
    check: 'Check status',
    mine: 'My requests',
    backlog: 'IT Backlog',
    triage: 'Requests triage',
    adminPanel: 'Admin panel',
    org: 'Engineering Dashboard · Home Alliance',
    healthOk: 'Backend online',
    healthDown: 'Backend unreachable',
  },
}

const ru = {
  langName: { en: 'EN', ru: 'RU' },

  form: {
    title: 'Заявка в IT',
    subtitle: 'Опишите, что нужно. Вы получите ссылку для отслеживания, а Slack будет держать вас в курсе.',
    groupWho: 'Кто',
    groupWhat: 'Что',
    groupWhy: 'Зачем и когда',
    email: 'Рабочая почта',
    emailPlaceholder: 'name@homealliance.com',
    emailHint: 'Ответим сюда и в Slack.',
    emailForeign: 'Это не адрес Home Alliance — отправить можно, но ответ может не дойти.',
    slack: 'Ник в Slack',
    slackPlaceholder: '@name',
    department: 'Отдел',
    departmentPlaceholder: 'Sales, BBDM, Support…',
    kind: 'Тип заявки',
    system: 'Система',
    summary: 'Что нужно',
    summaryPlaceholder: 'Опишите так, как рассказали бы коллеге: что происходит сейчас и что должно быть.',
    workaround: 'Как обходитесь сейчас',
    workaroundPlaceholder: 'Что делаете руками вместо этого.',
    value: 'Что это даст',
    valuePlaceholder: 'Сэкономленное время, меньше ошибок, деньги — достаточно вашей оценки.',
    impact: 'Насколько срочно',
    people: 'Сколько человек затронуто',
    peoplePlaceholder: 'например, 12',
    desired: 'Нужно к дате',
    links: 'Ссылки или скриншоты',
    linksPlaceholder: 'Вставьте ссылки, которые помогут',
    submit: 'Отправить заявку',
    submitting: 'Отправляем…',
    required: 'Обязательно',
    checkTitle: 'Уже отправляли?',
    checkPlaceholder: 'IT-0001 или ваша почта',
    checkGo: 'Проверить статус',
    doneTitle: 'Заявка отправлена',
    doneRef: 'Ваш номер',
    doneSlack: 'Отправлено в Slack — IT уже видит заявку.',
    doneTrack: 'Следить за заявкой',
    doneAnother: 'Отправить ещё одну',
    errors: {
      email: 'Укажите рабочую почту.',
      slack: 'Укажите ник в Slack.',
      kind: 'Выберите тип заявки.',
      system: 'Выберите систему.',
      summary: 'Опишите, что нужно.',
      impact: 'Укажите срочность.',
      generic: 'Не удалось отправить заявку.',
      rate: 'Слишком много заявок с этого адреса. Попробуйте чуть позже.',
    },
  },

  kind: {
    broken: 'Что-то сломалось',
    change: 'Изменить существующее',
    access: 'Доступ',
    data: 'Данные или отчёт',
    question: 'Вопрос',
  },
  system: {
    apollo: 'Apollo',
    passport: 'Passport',
    techapp: 'TechApp',
    fos: 'FOS',
    websites: 'Сайты',
    ghl_n8n: 'GHL / n8n',
    telephony: 'Телефония',
    other: 'Другое',
  },
  impact: {
    blocked: 'Блокирует — работать нельзя',
    daily: 'Мешает каждый день',
    can_wait: 'Может подождать',
  },
  impactShort: { blocked: 'Блокирует', daily: 'Каждый день', can_wait: 'Может подождать' },
  status: {
    new: 'Новая',
    accepted: 'Принята',
    in_progress: 'В работе',
    waiting_requester: 'Ждёт вас',
    done: 'Сделано',
    rejected: 'Отклонена',
  },
  steps: {
    submitted: 'Отправлена',
    accepted: 'Принята',
    in_progress: 'В работе',
    done: 'Сделано',
    confirmed: 'Подтверждена',
  },

  statusPage: {
    title: 'Заявка',
    lookupTitle: 'Проверить заявку',
    lookupPlaceholder: 'IT-0001',
    lookupGo: 'Открыть',
    lookupByEmail: 'Или посмотреть все свои заявки',
    notFound: 'Заявки с таким номером нет.',
    rejected: 'Отклонена',
    rejectedReason: 'Причина',
    owner: 'Исполнитель',
    due: 'Срок',
    priority: 'Приоритет',
    unassigned: 'Пока не назначен',
    none: '—',
    yourRequest: 'Ваша заявка',
    itResponse: 'Ответ IT',
    noResponse: 'Ответа пока нет. Новые заявки IT видит в Slack.',
    log: 'История',
    commentTitle: 'Добавить комментарий',
    commentPlaceholder: 'Всё, что поможет: ссылка на скриншот, новая деталь.',
    commentSend: 'Отправить',
    confirmTitle: 'Всё заработало?',
    confirm: 'Работает — закрыть',
    reopen: 'Не работает — вернуть в работу',
    reopenPlaceholder: 'Что именно не так?',
    reopenSend: 'Вернуть в работу',
    confirmed: 'Вы подтвердили {date}.',
    autoClosed: 'Закрыта автоматически — подтверждения не было 3 рабочих дня.',
    fields: {
      kind: 'Тип', system: 'Система', impact: 'Срочность', department: 'Отдел',
      workaround: 'Как обходятся сейчас', value: 'Польза', people: 'Затронуто людей',
      desired: 'Нужно к', links: 'Ссылки', created: 'Отправлена',
    },
    actor: { requester: 'Вы', it: 'IT', system: 'Система' },
    event: {
      created: 'Заявка отправлена',
      status: 'Статус: {from} → {to}',
      reply: 'Ответ IT',
      comment: 'Комментарий',
      confirm: 'Подтверждена заявителем',
      reopen: 'Возвращена в работу заявителем',
      notify: 'Уведомление',
      system: 'Система',
    },
  },

  mine: {
    title: 'Мои заявки',
    emailPlaceholder: 'name@homealliance.com',
    load: 'Показать',
    empty: 'С этого адреса заявок ещё не было.',
    prompt: 'Введите рабочую почту, чтобы увидеть свои заявки.',
    newRequest: 'Новая заявка',
    sent: 'Отправлена',
  },

  admin: {
    title: 'Разбор заявок',
    kpiNew: 'Новые',
    kpiOverdue: 'Без ответа > 24 ч',
    kpiAccept: 'Среднее время до принятия',
    kpiCreated: 'Создано за 30 дней',
    hours: 'ч',
    filterAll: 'Все',
    filterClosed: 'Закрытые',
    systemAll: 'Все системы',
    searchPlaceholder: 'Поиск по номеру, тексту, почте',
    empty: 'Здесь пусто.',
    pickOne: 'Выберите заявку слева.',
    age: { now: 'только что', hours: '{n} ч', days: '{n} д' },
    requester: 'Заявитель',
    triage: 'Разбор',
    ownerPlaceholder: 'Кто берёт',
    priorityPlaceholder: 'P0 / P1 / P2',
    duePlaceholder: 'ГГГГ-ММ-ДД',
    estimatePlaceholder: 'например, 2 д',
    ganttId: 'ID задачи в Ганте',
    backlogId: 'ID пункта бэклога',
    linked: 'Связано',
    replyTitle: 'Ответ заявителю',
    replyPlaceholder: 'То, что он прочитает в Slack.',
    save: 'Сохранить и написать в Slack',
    saving: 'Сохраняем…',
    reject: 'Отклонить…',
    rejectTitle: 'Отклонить заявку',
    rejectPlaceholder: 'Причина — её увидит заявитель.',
    rejectConfirm: 'Отклонить',
    cancel: 'Отмена',
    saved: 'Сохранено',
    log: 'История',
    passwordTitle: 'Пароль администратора',
    passwordHint: 'Для разбора заявок нужен пароль администратора.',
    passwordSubmit: 'Войти',
    passwordWrong: 'Неверный пароль',
  },

  common: {
    showPassword: 'Показать пароль',
    hidePassword: 'Скрыть пароль',
    password: 'Пароль',
    loading: 'Загрузка…',
    back: 'Назад',
    copy: 'Скопировать',
    copied: 'Скопировано',
  },

  notFound: {
    title: 'Страница не найдена',
    text: 'Такого адреса в дашборде нет. Если он раньше работал, страница может быть новее развёрнутой сборки — обновите страницу или выберите ссылку ниже.',
    home: 'На дашборд',
  },

  footer: {
    team: 'Команде',
    requests: 'Заявки',
    admin: 'Админ',
    dashboard: 'Дашборд',
    gantt: 'Гант команды',
    reports: 'Ежедневные отчёты',
    review: 'Месячный обзор',
    submit: 'Оставить заявку',
    check: 'Проверить статус',
    mine: 'Мои заявки',
    backlog: 'IT Backlog',
    triage: 'Разбор заявок',
    adminPanel: 'Админ-панель',
    org: 'Engineering Dashboard · Home Alliance',
    healthOk: 'Бэкенд на связи',
    healthDown: 'Бэкенд недоступен',
  },
}

export const I18N = { en, ru }

/** Fill {name} placeholders: fmt('Status: {from}', { from: 'New' }). */
export function fmt(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (
    values && values[k] != null ? String(values[k]) : m
  ))
}

/** "30 Sep 2026" / "30 сент. 2026" — the trailing "г." Intl adds in Russian is
 *  dropped so both languages read as one short date. */
export function formatDate(value, lang) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(withZone(value))
  if (isNaN(d.getTime())) return String(value)
  // Assembled from parts rather than taken whole: en-GB renders September as
  // "Sept" and ru-RU appends " г.", and neither matches the agreed format.
  const parts = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  }).formatToParts(d)
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || ''
  const month = get('month').replace(/^Sept$/, 'Sep').replace(/\s*г\.?$/, '')
  return `${get('day')} ${month} ${get('year')}`
}

/** Same, plus the clock — used in the event log. */
export function formatDateTime(value, lang) {
  if (!value) return ''
  const d = new Date(withZone(value))
  if (isNaN(d.getTime())) return String(value)
  const time = d.toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-GB', {
    hour: '2-digit', minute: '2-digit',
  })
  return `${formatDate(d, lang)}, ${time}`
}

/** The API writes naive UTC ISO strings; a browser would read them as local
 *  time, so pin them to UTC unless they already carry a zone. */
export function withZone(iso) {
  const s = String(iso || '')
  return /(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`
}

export function readLang(fallback) {
  try {
    const stored = localStorage.getItem(LANG_KEY)
    if (LANGS.includes(stored)) return stored
  } catch { /* private mode */ }
  return fallback
}

export function writeLang(lang) {
  try { localStorage.setItem(LANG_KEY, lang) } catch { /* private mode */ }
}
