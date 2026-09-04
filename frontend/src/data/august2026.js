// Monthly review — August 2026 (Aug 3 – Aug 31)
// Source: team EOD/EOW reports in #devs-and-product, #devs-apollo, DMs. Numbers are taken
// verbatim from reports. confidence: 'confirmed' = figure stated in a report or by a third
// party; 'estimate' = derived with the stated assumption; 'needs_data' = driver measured,
// $ requires a business input (avg ticket, ARPU, cost per call).

export const PERIOD = { month: 8, year: 2026, label: { en: 'August 2026', ru: 'Август 2026' } };

export const ASSUMPTIONS = {
  en: 'Estimates use $40/h for analyst and manager time and $50/h for engineer time. Average ticket, Passport ARPU and AI cost per call are not in the reports — where value depends on them, the driver is shown and the input is named.',
  ru: 'Оценки используют $40/ч для времени аналитика и менеджера и $50/ч для инженера. Средний чек, ARPU Passport и стоимость AI-обработки звонка в репортах отсутствуют — где выгода зависит от них, показан драйвер и названо недостающее число.',
};

export const SUMMARY = {
  en: [
    { label: 'Confirmed savings', value: '$157K', sub: 'ezMCP pilot avoided $150K + Workspace $6.85K/yr' },
    { label: 'Brought under control', value: '$510K', sub: 'Authorize.Net unsettled charges gap' },
    { label: 'Leaks stopped', value: '3', sub: 'reward minted ×3, double charge path, brand-less payment SMS' },
    { label: 'Awaiting business input for $', value: '3', sub: 'average ticket · Passport ARPU · AI cost per call' },
  ],
  ru: [
    { label: 'Подтверждённая экономия', value: '$157K', sub: 'ezMCP pilot $150K + Workspace $6.85K/год' },
    { label: 'Взято под контроль', value: '$510K', sub: 'разрыв Authorize.Net unsettled charges' },
    { label: 'Утечек остановлено', value: '3', sub: 'rewards ×3, двойное списание, SMS без бренда' },
    { label: 'Нужны данные для $', value: '3', sub: 'средний чек · ARPU Passport · $/звонок' },
  ],
};

// confidence: 'confirmed' | 'estimate' | 'needs_data' | 'none'
export const ENGINEERS = [
  {
    id: 'pogrebnyak', initials: 'AP', color: '#ff6b6b',
    name: { en: 'Andrey Pogrebnyak', ru: 'Андрей Погребняк' },
    role: { en: 'Full-stack', ru: 'Full-stack' },
    tasks: [
      {
        title: { en: 'Finance Data — Authorize.Net reconciliation', ru: 'Finance Data — сверка Authorize.Net' },
        goal: { en: 'Payments in Authorize.Net did not match CRM — part of the money was invisible to reports and accounting.', ru: 'Платежи из Authorize.Net не сходились с CRM — часть денег не была видна ни в отчётах, ни в бухгалтерии.' },
        effect: { en: 'Sync 96.2%. Unsettled-charges gap of $509,981 identified. Homes dimension: 617K locations, 481K unique homes, 98K Zillow-matched. Saba/Sardor scorecard live with ARPH and Active Households.', ru: 'Sync 96.2%. Выявлен разрыв $509,981 unsettled charges. Homes dimension: 617K локаций, 481K домов, 98K Zillow-matched. Scorecard Saba/Sardor live с ARPH и Active Households.' },
        value: { amount: '$509,981', note: { en: 'brought under control for reconciliation and recovery', ru: 'взято под контроль для сверки и востребования' }, confidence: 'confirmed' },
      },
      {
        title: { en: 'Passport 2 — notifications and data accuracy', ru: 'Passport 2 — уведомления и точность данных' },
        goal: { en: 'Members were not receiving SMS confirmations and 133 of 202 saw the wrong tier — trust and renewals at risk.', ru: 'Участники не получали SMS-подтверждения, 133 из 202 видели неверный тариф — под риском доверие и продления.' },
        effect: { en: 'Root cause of zero SMS: 3,895 profiles had sms_urgent_only but no phone captured from Calendly — fixed. Tier display fixed. Document recognition 17% → 65%. 44 zero-home members restored. Expert sessions admin table shipped.', ru: 'Root cause нулевых SMS: 3,895 профилей с sms_urgent_only, номер не захватывался из Calendly — исправлено. Тир исправлен. Распознавание документов 17% → 65%. 44 участника восстановлены.' },
        value: { amount: '3,895', note: { en: 'members regained notifications. $ = retention × ARPU', ru: 'клиентов вернули канал уведомлений. $ = retention × ARPU' }, confidence: 'needs_data' },
      },
      {
        title: { en: 'Missed calls — spam-attack containment', ru: 'Missed calls — защита от спам-атак' },
        goal: { en: 'Spam calls occupied agent lines; real customers could not get through.', ru: 'Спам-звонки занимали линии агентов, реальные клиенты не дозванивались.' },
        effect: { en: 'Interventions #28–#42. Peak 19,146 attacks/day, 0 leaks to agents. False-positive cost measured: 3.6% of mobile blocks. Two systemic data bugs fixed: reservations backfill 41K → 321K rows, CRM mirror sync cursor.', ru: 'Интервенции #28–#42. Пик 19,146 атак/день, 0 утечек к агентам. Ложные срабатывания 3.6%. Исправлены 2 системных бага: reservations backfill 41K → 321K строк, CRM mirror sync.' },
        value: { amount: '1,326 / week', note: { en: 'calls previously missed, 82% new customers. $ = × average ticket', ru: 'пропущенных звонков до фильтра, 82% новые клиенты. $ = × средний чек' }, confidence: 'needs_data' },
      },
      {
        title: { en: 'TechApp — CRM login and production readiness', ru: 'TechApp — вход через CRM и готовность к проду' },
        goal: { en: 'Technicians need one login and a stable release path before the app reaches 217 people.', ru: 'Техникам нужен один вход и стабильный релизный путь до выхода приложения на 217 человек.' },
        effect: { en: 'CRM email/password login end-to-end, 881 tests. NPS and Growth pages on live data. Drone CI root cause found: queue worker had not redeployed for months → 3 prod bugs. Apollo DB index: 10,293 ms → 267 ms.', ru: 'Вход по CRM email/паролю end-to-end, 881 тест. NPS и Growth на живых данных. Root cause Drone CI: worker не редеплоился месяцами → 3 бага в проде. Индекс Apollo: 10,293 мс → 267 мс.' },
        value: { amount: '39×', note: { en: 'faster CRM queries; fewer agent timeouts. Strategic — ROI after rollout', ru: 'быстрее запросы CRM; меньше таймаутов у агентов. Стратегически — ROI после rollout' }, confidence: 'estimate' },
      },
    ],
  },
  {
    id: 'brunetkin', initials: 'AB', color: '#00cfff',
    name: { en: 'Andrey Brunetkin', ru: 'Андрей Брунеткин' },
    role: { en: 'Platform', ru: 'Platform' },
    tasks: [
      {
        title: { en: 'TechApp messenger — SMS bridge for technicians', ru: 'TechApp messenger — SMS-бридж для техников' },
        goal: { en: 'Dispatcher–technician SMS lived outside any system; nobody could see or search it.', ru: 'SMS между диспетчером и техником жили вне систем — их нельзя было увидеть или найти.' },
        effect: { en: 'Bridge in production: a technician SMS creates a thread in the app from the first message. 23 technicians, 145 numbers; top-4 numbers carry 47% of volume. Webhook auth taken observe → enforce on live traffic. Phone directory synced: 2,794 rows, 217 technicians queued for onboarding.', ru: 'Бридж в проде: SMS техника создаёт тред в приложении с первого сообщения. 23 техника, 145 номеров; top-4 дают 47% объёма. Webhook-аутентификация observe → enforce на живом трафике. Справочник: 2,794 строки, очередь 217 техников.' },
        value: { amount: '47%', note: { en: 'of dispatcher SMS traffic now in-app. $ = dispatcher minutes saved × volume', ru: 'SMS-трафика диспетчеров теперь в приложении. $ = минуты диспетчера × объём' }, confidence: 'needs_data' },
      },
      {
        title: { en: 'HA ID — single sign-on for new users and CRM password parity', ru: 'HA ID — единый вход для новых пользователей и паритет с CRM' },
        goal: { en: 'New users got wrong permission levels automatically; employees had to remember two passwords.', ru: 'Новые пользователи автоматически получали неверный уровень прав; сотрудникам нужно было помнить два пароля.' },
        effect: { en: 'Over-privileged support role (~13 people) fixed. 5 Star Plumbing partner admin set up. CRM password parity in production; 13 defects found in two independent reviews and closed, including brute-force protection.', ru: 'Исправлены избыточные права support-роли (~13 человек). Настроен партнёр-админ для 5 Star Plumbing. Паритет паролей с CRM в проде; 13 дефектов найдены на двух ревью и закрыты, включая защиту от brute-force.' },
        value: { amount: 'Security', note: { en: 'access surface reduced; fewer IT tickets (Kudlaev handles ~4/week)', ru: 'поверхность доступа сокращена; меньше IT-тикетов (Kudlaev ~4/нед)' }, confidence: 'estimate' },
      },
    ],
  },
  {
    id: 'azizbek', initials: 'AT', color: '#34a853',
    name: { en: 'Azizbek Turgunov', ru: 'Азизбек Тургунов' },
    role: { en: 'AI / Automation · until Aug 31', ru: 'AI / Automation · до 31 авг' },
    tasks: [
      {
        title: { en: 'Google Workspace licence audit', ru: 'Аудит лицензий Google Workspace' },
        goal: { en: 'The company was paying for accounts of former and inactive staff in HousePros and HA.', ru: 'Компания платила за аккаунты уволенных и неактивных сотрудников в HousePros и HA.' },
        effect: { en: 'HousePros: 68 accounts removed. HA: 184 accounts sorted into 3 buckets and handed to Kateryna for sign-off.', ru: 'HousePros: 68 аккаунтов удалено. HA: 184 аккаунта разобраны по 3 группам и переданы Kateryna на решение.' },
        value: { amount: '$6,854 / yr', note: { en: '$571/mo HousePros, confirmed by Sergi and Kateryna. HA part up to ~$3.7K/yr pending', ru: '$571/мес HousePros, подтверждено Sergi и Kateryna. HA-часть до ~$3.7K/год ждёт sign-off' }, confidence: 'confirmed' },
      },
      {
        title: { en: 'GA4 and Search Console connectors for marketing', ru: 'Коннекторы GA4 и Search Console для маркетинга' },
        goal: { en: 'Marketing spent up to 2 hours per site on manual analytics — 21 sites, every month.', ru: 'Маркетинг тратил до 2 часов на ручной анализ каждого сайта — 21 сайт, каждый месяц.' },
        effect: { en: '21 properties connected (12 appliance + 9 electrical). Sona: analysis that took up to 2 hours per site is now instant.', ru: '21 property подключена (12 appliance + 9 electrical). Sona: анализ, занимавший до 2 часов на сайт, теперь мгновенный.' },
        value: { amount: '≈ $1,680 / mo', note: { en: '2 h × 21 sites × $40/h, one analysis per site per month', ru: '2 ч × 21 сайт × $40/ч, один анализ на сайт в месяц' }, confidence: 'estimate' },
      },
      {
        title: { en: 'Corporate email on all 65 GMB domains', ru: 'Корпоративная почта на 65 доменах GMB' },
        goal: { en: 'Business domains had no working corporate mail; deliverability and spoofing protection were inconsistent.', ru: 'У бизнес-доменов не было рабочей корпоративной почты; deliverability и защита от спуфинга были неравномерны.' },
        effect: { en: '65/65 domains on Google Workspace with MX, DKIM, SPF and DMARC. DNS watchdog checks 64 domains every 6 hours.', ru: '65/65 доменов на Google Workspace с MX, DKIM, SPF и DMARC. DNS watchdog проверяет 64 домена каждые 6 часов.' },
        value: { amount: 'Infrastructure', note: { en: 'deliverability and anti-spoofing; not a cash item', ru: 'deliverability и защита от спуфинга; не денежная статья' }, confidence: 'none' },
      },
      {
        title: { en: 'Same-Day missed-agent automation', ru: 'Автоматизация Same-Day missed-agent' },
        goal: { en: "George's team was restoring missed Same-Day requests by hand every day.", ru: 'Команда George вручную восстанавливала пропущенные заявки Same-Day каждый день.' },
        effect: { en: '212 requests per day processed, 94.3% acknowledged. Manual recovery replaced.', ru: '212 заявок в день, 94.3% подтверждено. Ручное восстановление заменено.' },
        value: { amount: '≈ $600–1,200 / mo', note: { en: '30–60 min/day of manual work × $40/h', ru: '30–60 мин/день ручной работы × $40/ч' }, confidence: 'estimate' },
      },
      {
        title: { en: 'Electrical leads — 13-month report for Amanda', ru: 'Electrical leads — отчёт за 13 месяцев для Amanda' },
        goal: { en: 'Nobody knew how many electrical web requests were real leads; marketing budget was set blind.', ru: 'Никто не знал, сколько заявок с электрических сайтов — реальные лиды; бюджет маркетинга ставился вслепую.' },
        effect: { en: '30,927 requests across 92 sites: 1,190 leads, 346 booked, 89.6% spam. Dedup methodology proposed (per domain + per customer column).', ru: '30,927 заявок с 92 сайтов: 1,190 лидов, 346 booked, 89.6% спам. Предложена методика дедупликации (по домену + колонка по клиенту).' },
        value: { amount: '89.6% spam', note: { en: 'baseline for marketing spend decisions on 92 sites', ru: 'база для решений по маркетинговому бюджету на 92 сайта' }, confidence: 'confirmed' },
      },
    ],
  },
  {
    id: 'roman', initials: 'RM', color: '#ffb84d',
    name: { en: 'Roman Misan', ru: 'Роман Мисан' },
    role: { en: 'No-code / Automation', ru: 'No-code / Automation' },
    tasks: [
      {
        title: { en: 'Founder OS — data-loss fix and noise filter', ru: 'Founder OS — устранение потери данных и фильтр шума' },
        goal: { en: 'For 5 weeks 4 of 10 users, including the founder, could not save tasks and goals from calls; AI processed every call regardless of relevance.', ru: '5 недель 4 из 10 пользователей, включая founder, не могли сохранять задачи и цели из звонков; AI обрабатывал каждый звонок без разбора.' },
        effect: { en: 'One account had lost 385 tasks and 452 goals — restored. 94% of non-target calls cut before AI processing.', ru: 'Один аккаунт потерял 385 задач и 452 цели — восстановлены. 94% нецелевых звонков отрезаны до AI-обработки.' },
        value: { amount: '−94%', note: { en: 'AI processing volume. $ = × cost per processed call', ru: 'объёма AI-обработки. $ = × стоимость обработки звонка' }, confidence: 'needs_data' },
      },
      {
        title: { en: 'Passport — reward over-minting stopped', ru: 'Passport — остановлено тройное начисление rewards' },
        goal: { en: 'A $30 reward was minted three times per event — direct overpayment to members.', ru: '$30 reward начислялся трижды за событие — прямая переплата участникам.' },
        effect: { en: 'Triple mint fixed; white screens on /rewards and /referrals, Protection Center documents and scroll reset fixed.', ru: 'Тройное начисление исправлено; белые экраны /rewards и /referrals, документы Protection Center, сброс скролла исправлены.' },
        value: { amount: '$60 per event', note: { en: 'overpayment stopped; total depends on event count', ru: 'переплата остановлена; сумма зависит от числа событий' }, confidence: 'confirmed' },
      },
      {
        title: { en: 'completerepairwa.com — page speed', ru: 'completerepairwa.com — скорость сайта' },
        goal: { en: 'A slow mobile site loses visitors before they see the phone number.', ru: 'Медленный мобильный сайт теряет посетителей до того, как они увидят номер телефона.' },
        effect: { en: 'Mobile performance 40 → 76; page weight 4.7 MB → 1.3 MB.', ru: 'Mobile performance 40 → 76; вес страницы 4.7 MB → 1.3 MB.' },
        value: { amount: '+conversion', note: { en: 'industry rule: −1 s load ≈ +5–10% conversion. Needs site traffic', ru: 'ориентир: −1 с загрузки ≈ +5–10% конверсии. Нужен трафик сайта' }, confidence: 'needs_data' },
      },
      {
        title: { en: 'Self-service web forms → Slack for house cleaning', ru: 'Самообслуживание форм → Slack для house cleaning' },
        goal: { en: 'Every new site needed an engineer to wire its form to Slack.', ru: 'Каждый новый сайт требовал инженера, чтобы подключить форму к Slack.' },
        effect: { en: 'Vivian connects sites herself; firstcallkyplumbing forms fixed (reCAPTCHA → Turnstile), leads flowing again.', ru: 'Vivian подключает сайты сама; формы firstcallkyplumbing исправлены (reCAPTCHA → Turnstile), лиды снова идут.' },
        value: { amount: '0 h / site', note: { en: 'engineer time per new site (was 1–2 h × $50)', ru: 'инженерного времени на новый сайт (было 1–2 ч × $50)' }, confidence: 'estimate' },
      },
      {
        title: { en: 'TechApp QA before rollout', ru: 'QA TechApp перед rollout' },
        goal: { en: 'Catch defects before 217 technicians see them.', ru: 'Поймать дефекты до того, как их увидят 217 техников.' },
        effect: { en: '214 test cases, 27 defects found (10 P1) before production.', ru: '214 тест-кейсов, 27 дефектов найдено (10 P1) до прода.' },
        value: { amount: '10 P1', note: { en: 'blocked from reaching 217 users', ru: 'не дошли до 217 пользователей' }, confidence: 'confirmed' },
      },
    ],
  },
  {
    id: 'yevhenii', initials: 'YS', color: '#a78bfa',
    name: { en: 'Yevhenii Shevchenko', ru: 'Евгений Шевченко' },
    role: { en: 'Web / Automation', ru: 'Web / Automation' },
    tasks: [
      {
        title: { en: 'Mailgun on 137 sites and CAPTCHA on 22', ru: 'Mailgun на 137 сайтах и CAPTCHA на 22' },
        goal: { en: 'Form emails from GMB sites were unreliable and 93% of submissions were spam landing on CSRs.', ru: 'Письма с форм GMB-сайтов приходили ненадёжно, а 93% заявок были спамом, попадавшим на CSR.' },
        effect: { en: '137 sites on Mailgun, 600 routes verified. Cloudflare CAPTCHA on 22 sites.', ru: '137 сайтов на Mailgun, 600 routes проверены. Cloudflare CAPTCHA на 22 сайтах.' },
        value: { amount: 'CSR time', note: { en: 'less spam triage; volume per site not in reports', ru: 'меньше разбора спама; объём по сайту не в репортах' }, confidence: 'needs_data' },
      },
      {
        title: { en: 'WordPress 7.1 × WP Rocket outage on 26 sites', ru: 'Падение 26 сайтов после WordPress 7.1 × WP Rocket' },
        goal: { en: 'A plugin conflict after the WordPress update took 26 lead-generating sites down.', ru: 'Конфликт плагина после обновления WordPress положил 26 сайтов, приносящих лиды.' },
        effect: { en: 'All 26 restored; safe update order documented for Chris and Aldrin.', ru: 'Все 26 восстановлены; безопасный порядок обновлений задокументирован для Chris и Aldrin.' },
        value: { amount: '26 sites', note: { en: 'lead flow restored; downtime length not in reports', ru: 'поток лидов восстановлен; длительность даунтайма не в репортах' }, confidence: 'needs_data' },
      },
    ],
  },
  {
    id: 'minin', initials: 'DM', color: '#f472b6',
    name: { en: 'Dmitry Minin', ru: 'Дмитрий Минин' },
    role: { en: 'AI / Automation', ru: 'AI / Automation' },
    tasks: [
      {
        title: { en: 'Electrical web forms outage', ru: 'Падение веб-форм электрического департамента' },
        goal: { en: 'All electrical sites stopped delivering leads over a weekend — zero potentials Aug 22–24.', ru: 'Все electrical сайты перестали отдавать лиды на выходных — ноль заявок 22–24 авг.' },
        effect: { en: 'Fixed Aug 24 as top priority; root cause in n8n routing after the DB move.', ru: 'Исправлено 24 авг как задача нулевого приоритета; root cause в маршрутизации n8n после переезда БД.' },
        value: { amount: '≈ 30–35 leads', note: { en: 'lost over the weekend at ~500 legit leads/month; further loss stopped', ru: 'потеряно за выходные при ~500 лидов/мес; дальнейшая потеря остановлена' }, confidence: 'estimate' },
      },
      {
        title: { en: 'Zapier → n8n migration and n8n stability', ru: 'Миграция Zapier → n8n и стабильность n8n' },
        goal: { en: 'Remove the Zapier subscription and stop workflows freezing until a manual restart.', ru: 'Убрать подписку Zapier и прекратить зависание воркфлоу до ручного рестарта.' },
        effect: { en: "Dean's flows migrated; hanging-jobs fix shipped; two missing Mailgun domains found for Yevhenii.", ru: 'Флоу Dean перенесены; фикс зависающих jobs; найдены 2 пропущенных домена Mailgun для Евгения.' },
        value: { amount: 'Zapier fee', note: { en: 'subscription eliminated; amount not in reports', ru: 'подписка устранена; сумма не в репортах' }, confidence: 'needs_data' },
      },
      {
        title: { en: 'Call-scoring weekly sheet', ru: 'Еженедельный скоринг звонков' },
        goal: { en: 'Sales calls were not scored consistently; Anastasia needed a weekly view per salesperson.', ru: 'Звонки сейлзов не оценивались единообразно; Anastasia нужен еженедельный срез по сейлзам.' },
        effect: { en: 'Weekly_Summary sheet on the 6-criteria / 1-3-5 rubric; transcript pipeline fixed (calls under 180 s were excluded, 975 calls recovered).', ru: 'Weekly_Summary по rubric 6 критериев / 1-3-5; исправлен пайплайн транскриптов (звонки <180 с не попадали, 975 звонков восстановлены).' },
        value: { amount: '975 calls', note: { en: 'now scorable; coaching value not quantified', ru: 'теперь оцениваются; эффект коучинга не измерен' }, confidence: 'none' },
      },
    ],
  },
  {
    id: 'kudlaev', initials: 'DK', color: '#8b5cf6',
    name: { en: 'Dmitriy Kudlaev', ru: 'Дмитрий Кудлаев' },
    role: { en: 'IT / Security', ru: 'IT / Security' },
    tasks: [
      {
        title: { en: 'hvacallianceexpert.com mail outage', ru: 'Почта hvacallianceexpert.com' },
        goal: { en: 'Customer email on a business domain was stuck for 9 days.', ru: 'Клиентская почта на бизнес-домене стояла 9 дней.' },
        effect: { en: '324 emails released; passwords reset for two mailboxes; DNS corrected; delivery confirmed by client.', ru: '324 письма доставлены; сброшены пароли двух ящиков; DNS исправлен; доставка подтверждена клиентом.' },
        value: { amount: '324 emails', note: { en: 'customer correspondence recovered', ru: 'клиентская переписка восстановлена' }, confidence: 'confirmed' },
      },
      {
        title: { en: 'SIEM — alerting and tool decision', ru: 'SIEM — алертинг и выбор инструмента' },
        goal: { en: 'No central security alerting across Google Workspace logs.', ru: 'Не было централизованного алертинга по логам Google Workspace.' },
        effect: { en: '11 critical + medium rules on 7 log types in Google Alert Center. Sentinel (~$27–35/mo) vs Wazuh (open source) evaluated.', ru: '11 critical + medium правил по 7 типам логов в Google Alert Center. Оценены Sentinel (~$27–35/мес) и Wazuh (open source).' },
        value: { amount: '≈ $400 / yr', note: { en: 'if Wazuh is chosen over Sentinel', ru: 'если выбран Wazuh вместо Sentinel' }, confidence: 'estimate' },
      },
    ],
  },
  {
    id: 'bachinskiy', initials: 'SB', color: '#fb7185',
    name: { en: 'Sergey Bachinskiy', ru: 'Сергей Бачинский' },
    role: { en: 'DevOps', ru: 'DevOps' },
    tasks: [
      {
        title: { en: 'ezMCP assessment for government contracts', ru: 'Оценка ezMCP для гос. контрактов' },
        goal: { en: 'A $150K / 90-day pilot was on the table; the team needed to know if it was worth paying for.', ru: 'На столе был пилот $150K / 90 дней; нужно было понять, стоит ли за него платить.' },
        effect: { en: 'A comparable product identified at no cost; infrastructure review done with Shawn.', ru: 'Найден сопоставимый продукт без затрат; инфраструктурное ревью с Shawn.' },
        value: { amount: '$150K', note: { en: 'pilot spend avoided', ru: 'расход на пилот избежан' }, confidence: 'confirmed' },
      },
      {
        title: { en: 'Finance service infrastructure on AWS', ru: 'Инфраструктура Finance service на AWS' },
        goal: { en: 'The $510K reconciliation work needed production-grade infrastructure.', ru: 'Работа по сверке на $510K нуждалась в продакшн-инфраструктуре.' },
        effect: { en: 'ECS cluster, Load Balancer, WAF, RDS, drone-ci pipeline. Dashboard moved to PostgreSQL. 3CX storage and licence restored after incident.', ru: 'ECS, Load Balancer, WAF, RDS, drone-ci пайплайн. Дашборд переведён на PostgreSQL. После инцидента восстановлены storage и лицензия 3CX.' },
        value: { amount: 'Enabler', note: { en: 'underpins Finance Data; call-center downtime stopped', ru: 'основа Finance Data; даунтайм колл-центра остановлен' }, confidence: 'none' },
      },
    ],
  },
  {
    id: 'shawn', initials: 'SG', color: '#38bdf8',
    name: { en: 'Shawn Gregg', ru: 'Шон Грегг' },
    role: { en: 'AI / Automation', ru: 'AI / Automation' },
    tasks: [
      {
        title: { en: 'HA Academy revamp and Leadbank spam control', ru: 'Обновление HA Academy и спам-контроль Leadbank' },
        goal: { en: 'Internal training platform needed Slack integration and access control; Leadbank was receiving spam leads.', ru: 'Учебной платформе нужны интеграция со Slack и контроль доступа; в Leadbank приходили спам-лиды.' },
        effect: { en: 'Academy: Slack integration, org chart, auth gating, 360 Health, AI assistant. Leadbank: routing plus real-time blocking (with Zach). SEO analyzer ready for deployment.', ru: 'Academy: интеграция Slack, org chart, auth gating, 360 Health, AI-ассистент. Leadbank: маршрутизация и блокировка в реальном времени (с Zach). SEO analyzer готов к деплою.' },
        value: { amount: 'Not measured', note: { en: 'no before/after metrics in reports', ru: 'метрик до/после в репортах нет' }, confidence: 'none' },
      },
    ],
  },
  {
    id: 'malyshev', initials: 'AM', color: '#00e5a0',
    name: { en: 'Aleksandr Malyshev', ru: 'Александр Малышев' },
    role: { en: 'Dev Lead', ru: 'Dev Lead' },
    tasks: [
      {
        title: { en: 'Engineering Dashboard — Team Gantt and reporting', ru: 'Engineering Dashboard — Team Gantt и отчётность' },
        goal: { en: 'Leadership needs one place to see who works on what, what it costs and what it returns.', ru: 'Руководству нужно одно место, где видно кто над чем работает, что это стоит и что приносит.' },
        effect: { en: 'Smartsheet-style Gantt shipped (PR #79–#88): full-width, Active/Done, drag and resize, side panel with assignee and description. All August EOD/EOW reports loaded; bilingual task descriptions with sources.', ru: 'Ганта в стиле Smartsheet (PR #79–#88): полная ширина, Active/Done, drag и resize, панель с исполнителем и описанием. Все репорты августа загружены; двуязычные описания задач с источниками.' },
        value: { amount: 'Management tool', note: { en: 'basis for this review', ru: 'основа этого обзора' }, confidence: 'none' },
      },
      {
        title: { en: 'Dashboard incident after PostgreSQL migration', ru: 'Инцидент дашборда после переезда на PostgreSQL' },
        goal: { en: 'The dashboard went down (connection pool exhausted) and AI-usage telemetry silently stored nothing for a week.', ru: 'Дашборд упал (исчерпан пул соединений), телеметрия AI неделю молча ничего не сохраняла.' },
        effect: { en: 'Pool and non-blocking sync fix (PR #77); telemetry root cause found — PostgreSQL ON CONFLICT ambiguity rolled back every batch while returning 200 (PR #89).', ru: 'Фикс пула и неблокирующего синка (PR #77); root cause телеметрии — неоднозначность ON CONFLICT в PostgreSQL откатывала каждый батч при ответе 200 (PR #89).' },
        value: { amount: 'Restored', note: { en: 'dashboard uptime and AI cost tracking', ru: 'работа дашборда и учёт расходов на AI' }, confidence: 'none' },
      },
    ],
  },
];

// team_members.id — verified against GET /api/team on 2026-09-04
export const ENGINEER_IDS = {
  brunetkin: 1, malyshev: 10, roman: 12, pogrebnyak: 13, kudlaev: 14,
  bachinskiy: 15, azizbek: 16, minin: 18, shawn: 19, yevhenii: 21,
};

// Aug 31 / Sep 1 2026 falls in ISO week 36 — the review is scored on the week it
// is presented, the same way June 2026 was scored on week 27.
export const SCORE_WEEK = 36;
export const SCORE_YEAR = 2026;
