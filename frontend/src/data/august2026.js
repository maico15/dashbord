// Monthly review — August 2026 (Aug 3 – Aug 31). Business-language version for the founder.
// Fields per task: title · task (business problem) · goal (what we set out to achieve) ·
// benefit (what changed for the business, measured) · value { amount, note, confidence }.
// confidence: 'confirmed' — stated in a report or by a third party; 'estimate' — derived with a
// stated assumption; 'needs_data' — result measured, $ needs a business input; 'none' — not a cash item.

export const PERIOD = { month: 8, year: 2026, label: { en: 'August 2026', ru: 'Август 2026' } };

export const LABELS = {
  en: { task: 'Task', goal: 'Goal', benefit: 'Benefit', amount: 'Amount', tasks: 'tasks' },
  ru: { task: 'Задача', goal: 'Цель', benefit: 'Выгода', amount: 'Сумма', tasks: 'задач' },
};

export const ASSUMPTIONS = {
  en: 'Estimates use $40 per hour for manager and analyst time. Where a figure needs a business input we do not have — average ticket, Passport revenue per member, cost of processing one call — the measured result is shown and the missing input is named.',
  ru: 'Оценки считают час менеджера или аналитика по $40. Где для суммы нужны данные бизнеса, которых у нас нет — средний чек, доход с одного участника Passport, стоимость обработки одного звонка — показан измеренный результат и названо недостающее число.',
};

export const SUMMARY = {
  en: [
    { label: 'Confirmed savings', value: '$157K', sub: 'unneeded pilot $150K + unused licences $6.85K a year' },
    { label: 'Money leaks stopped', value: '3', sub: 'triple bonus payout, double charge risk, payment texts without our brand' },
    { label: 'Results awaiting a business figure', value: '4', sub: 'average ticket · revenue per member · cost per call · call volume' },
  ],
  ru: [
    { label: 'Подтверждённая экономия', value: '$157K', sub: 'ненужный пилот $150K + неиспользуемые лицензии $6.85K в год' },
    { label: 'Остановлено утечек денег', value: '3', sub: 'тройная выплата бонуса, риск двойного списания, платёжные SMS без нашего бренда' },
    { label: 'Результатов ждут цифру от бизнеса', value: '4', sub: 'средний чек · доход с участника · стоимость звонка · объём звонков' },
  ],
};

export const ENGINEERS = [
  {
    id: 'pogrebnyak', initials: 'AP', color: '#ff6b6b',
    name: { en: 'Andrey Pogrebnyak', ru: 'Андрей Погребняк' },
    role: { en: 'Full-stack', ru: 'Full-stack' },
    tasks: [
      {
        title: { en: 'Passport — members were not getting confirmations', ru: 'Passport — участники не получали подтверждения' },
        task: { en: 'Almost 4,000 Passport members had asked for text confirmations and were receiving none. Two thirds of paying members saw a cheaper plan than the one they paid for.', ru: 'Почти 4,000 участников Passport просили SMS-подтверждения и не получали ни одного. Две трети платящих видели в приложении более дешёвый план, чем оплатили.' },
        goal: { en: 'Make every member see the right plan and receive every confirmation — so they renew instead of cancelling.', ru: 'Чтобы каждый участник видел свой план и получал каждое подтверждение — и продлевал, а не отменял.' },
        benefit: { en: 'Confirmations now reach all 3,895 members. Plan display fixed for 133 of 202 paying members. Uploaded receipts are recognised 4 times more often (17% → 65%). 44 members who had lost their home address were restored.', ru: 'Подтверждения доходят всем 3,895 участникам. План показывается верно у 133 из 202 платящих. Загруженные чеки распознаются в 4 раза чаще (17% → 65%). 44 участника, потерявшие адрес дома, восстановлены.' },
        value: { amount: '3,895 members', note: { en: 'kept informed. Money value = members retained × revenue per member', ru: 'снова получают уведомления. Сумма = удержанные участники × доход с участника' }, confidence: 'needs_data' },
      },
      {
        title: { en: 'Call centre — spam calls blocking real customers', ru: 'Колл-центр — спам-звонки не давали дозвониться клиентам' },
        task: { en: 'Automated spam was flooding the lines — up to 19,000 fake calls a day. Agents were busy with robots while real customers hung up.', ru: 'Автоматический спам заваливал линии — до 19,000 ложных звонков в день. Агенты были заняты роботами, а живые клиенты не дозванивались.' },
        goal: { en: 'Block the spam without blocking a single real caller.', ru: 'Отсечь спам, не заблокировав ни одного живого клиента.' },
        benefit: { en: 'On the worst day 19,146 spam calls were stopped and none reached an agent. Only 3.6% of blocked mobile numbers turned out to be real callers. Before the fix the company was missing about 1,300 calls a week, 82% of them from new customers.', ru: 'В худший день остановлено 19,146 спам-звонков, ни один не дошёл до агента. Только 3.6% заблокированных мобильных оказались живыми людьми. До фикса компания теряла около 1,300 звонков в неделю, 82% — от новых клиентов.' },
        value: { amount: '1,300 calls a week', note: { en: 'no longer lost. Money value = × average ticket', ru: 'больше не теряются. Сумма = × средний чек' }, confidence: 'needs_data' },
      },
      {
        title: { en: 'Technician app — one login and a stable release process', ru: 'Приложение техников — один вход и стабильные релизы' },
        task: { en: 'Technicians needed a second password to enter the app. Releases were failing because an update process had silently stopped months ago and produced three production bugs.', ru: 'Техникам нужен был второй пароль для входа. Релизы ломались: процесс обновления молча остановился месяцы назад и породил три бага в продакшене.' },
        goal: { en: 'Technicians log in with the password they already have; every release reaches production correctly.', ru: 'Техники входят с тем паролем, который у них уже есть; каждый релиз доходит до продакшена корректно.' },
        benefit: { en: 'Single login shipped. Release process repaired. Customer database queries became 39 times faster, so agents wait less on screen.', ru: 'Единый вход выпущен. Процесс релизов починен. Запросы к базе клиентов стали быстрее в 39 раз — агенты меньше ждут на экране.' },
        value: { amount: '39× faster', note: { en: 'agent screens. Money value comes with rollout to 217 technicians', ru: 'экраны агентов. Сумма появится после выхода на 217 техников' }, confidence: 'estimate' },
      },
    ],
  },
  {
    id: 'brunetkin', initials: 'AB', color: '#00cfff',
    name: { en: 'Andrey Brunetkin', ru: 'Андрей Брунеткин' },
    role: { en: 'Platform', ru: 'Platform' },
    tasks: [
      {
        title: { en: 'Technician texts inside the company system', ru: 'Переписка с техниками внутри системы компании' },
        task: { en: 'Dispatchers and technicians texted on personal phones. Nobody could see, search or hand over those conversations.', ru: 'Диспетчеры и техники переписывались с личных телефонов. Эту переписку нельзя было увидеть, найти или передать другому.' },
        goal: { en: 'Every technician text lands in the company app the moment it is sent.', ru: 'Каждое SMS техника попадает в приложение компании в момент отправки.' },
        benefit: { en: 'Live in production: 23 technicians and 145 numbers connected; the four busiest numbers alone carry 47% of all dispatcher texting. Directory of 217 technicians prepared for the next wave.', ru: 'Работает в продакшене: подключены 23 техника и 145 номеров; четыре самых активных дают 47% всей переписки диспетчеров. Подготовлен список из 217 техников для следующей волны.' },
        value: { amount: '47%', note: { en: 'of dispatcher texting now traceable. Money value = dispatcher minutes saved × volume', ru: 'переписки диспетчеров теперь под контролем. Сумма = минуты диспетчера × объём' }, confidence: 'needs_data' },
      },
      {
        title: { en: 'Company login — wrong access rights and duplicate passwords', ru: 'Единый вход — лишние права и дублирующиеся пароли' },
        task: { en: 'New employees were automatically given more access than their role needed — about 13 support staff could see what they should not. Staff kept two passwords for two systems.', ru: 'Новые сотрудники автоматически получали больше доступа, чем нужно роли — около 13 человек поддержки видели лишнее. Сотрудники держали два пароля для двух систем.' },
        goal: { en: 'Each person sees only what their role allows; one password opens everything.', ru: 'Каждый видит только то, что положено роли; один пароль открывает всё.' },
        benefit: { en: 'Excess access removed. One password for CRM and internal tools is in production. 13 security gaps found in review and closed, including protection against password guessing.', ru: 'Лишний доступ убран. Один пароль для CRM и внутренних инструментов в продакшене. На ревью найдено и закрыто 13 дыр безопасности, включая защиту от перебора паролей.' },
        value: { amount: 'Security', note: { en: 'lower breach risk; fewer access tickets to IT (about 4 a week today)', ru: 'ниже риск утечки; меньше заявок в IT на доступы (сейчас ~4 в неделю)' }, confidence: 'estimate' },
      },
    ],
  },
  {
    id: 'azizbek', initials: 'AT', color: '#34a853',
    name: { en: 'Azizbek Turgunov', ru: 'Азизбек Тургунов' },
    role: { en: 'AI / Automation · until Aug 31', ru: 'AI / Automation · до 31 авг' },
    tasks: [
      {
        title: { en: 'Paying for email accounts nobody uses', ru: 'Оплата почтовых аккаунтов, которыми никто не пользуется' },
        task: { en: 'The company kept paying Google for mailboxes of people who had left or never used them.', ru: 'Компания продолжала платить Google за ящики уволенных и тех, кто ими не пользовался.' },
        goal: { en: 'Stop paying for what nobody uses.', ru: 'Перестать платить за то, чем никто не пользуется.' },
        benefit: { en: 'HousePros: 68 accounts removed. HA: 184 accounts sorted and handed to Kateryna for the final decision.', ru: 'HousePros: 68 аккаунтов удалено. HA: 184 аккаунта разобраны и переданы Kateryna на решение.' },
        value: { amount: '$6,854 a year', note: { en: 'HousePros, confirmed by Sergi and Kateryna. HA share up to ~$3,700 a year pending sign-off', ru: 'HousePros, подтверждено Sergi и Kateryna. Доля HA до ~$3,700 в год ждёт решения' }, confidence: 'confirmed' },
      },
      {
        title: { en: 'Marketing analytics without manual work', ru: 'Аналитика маркетинга без ручной работы' },
        task: { en: 'Marketing spent up to 2 hours per website pulling traffic and search data by hand — 21 websites, every month.', ru: 'Маркетинг тратил до 2 часов на каждый сайт, вручную собирая данные о трафике и поиске — 21 сайт, каждый месяц.' },
        goal: { en: 'Answers about any website in seconds, not hours.', ru: 'Ответы по любому сайту за секунды, а не часы.' },
        benefit: { en: 'All 21 websites connected. Sona: an analysis that took up to 2 hours is now instant.', ru: 'Подключён 21 сайт. Sona: анализ, занимавший до 2 часов, теперь мгновенный.' },
        value: { amount: '≈ $1,680 a month', note: { en: '2 hours × 21 sites × $40, one analysis per site a month', ru: '2 ч × 21 сайт × $40, один анализ на сайт в месяц' }, confidence: 'estimate' },
      },
      {
        title: { en: 'Working company email on all 65 business domains', ru: 'Рабочая почта на всех 65 бизнес-доменах' },
        task: { en: 'Many of our 65 business websites had no working company email; letters bounced or landed in spam, and the domains could be impersonated.', ru: 'У многих из 65 бизнес-сайтов не было рабочей корпоративной почты; письма терялись или уходили в спам, домены можно было подделать.' },
        goal: { en: 'Every domain sends and receives mail reliably and cannot be spoofed.', ru: 'Каждый домен надёжно отправляет и получает почту и защищён от подделки.' },
        benefit: { en: '65 of 65 domains configured. Automatic check every 6 hours catches a broken domain before customers do.', ru: '65 из 65 доменов настроены. Автопроверка каждые 6 часов замечает сломанный домен раньше клиентов.' },
        value: { amount: 'Reliability', note: { en: 'not a cash item', ru: 'не денежная статья' }, confidence: 'none' },
      },
      {
        title: { en: 'Same-Day requests restored by hand every day', ru: 'Заявки Same-Day восстанавливали вручную каждый день' },
        task: { en: "George's team spent time every day recovering Same-Day requests the system had missed.", ru: 'Команда George каждый день тратила время на восстановление заявок Same-Day, которые система пропустила.' },
        goal: { en: 'The system catches its own misses; people stop doing it.', ru: 'Система сама подхватывает пропуски; люди перестают это делать.' },
        benefit: { en: '212 requests a day handled automatically, 94.3% acknowledged without human help.', ru: '212 заявок в день обрабатываются автоматически, 94.3% подтверждаются без участия человека.' },
        value: { amount: '≈ $600–1,200 a month', note: { en: '30–60 minutes a day of manual work × $40', ru: '30–60 минут в день ручной работы × $40' }, confidence: 'estimate' },
      },
      {
        title: { en: 'How many electrical web requests are real customers', ru: 'Сколько заявок с электрических сайтов — реальные клиенты' },
        task: { en: 'Nobody knew what share of requests from 92 electrical websites were real. Marketing budget was set blind.', ru: 'Никто не знал, какая доля заявок с 92 электрических сайтов настоящая. Бюджет маркетинга ставился вслепую.' },
        goal: { en: 'A clear number: how much of the request flow is worth paying for.', ru: 'Ясное число: какая часть потока заявок стоит денег.' },
        benefit: { en: '13 months analysed: 30,927 requests, of which 1,190 were real leads and 346 became bookings. 89.6% was spam.', ru: 'Проанализировано 13 месяцев: 30,927 заявок, из них 1,190 реальных лидов и 346 бронирований. 89.6% — спам.' },
        value: { amount: '89.6% spam', note: { en: 'a baseline for deciding marketing spend on 92 sites', ru: 'база для решения о маркетинговом бюджете на 92 сайта' }, confidence: 'confirmed' },
      },
    ],
  },
  {
    id: 'roman', initials: 'RM', color: '#ffb84d',
    name: { en: 'Roman Misan', ru: 'Роман Мисан' },
    role: { en: 'No-code / Automation', ru: 'No-code / Automation' },
    tasks: [
      {
        title: { en: 'Founder OS — tasks from calls were being lost', ru: 'Founder OS — задачи из звонков терялись' },
        task: { en: 'For 5 weeks 4 of 10 users, including the founder, could not save tasks and goals from their calls. One account lost 385 tasks and 452 goals. The AI also processed every call, relevant or not.', ru: '5 недель 4 из 10 пользователей, включая founder, не могли сохранить задачи и цели из звонков. Один аккаунт потерял 385 задач и 452 цели. AI при этом обрабатывал каждый звонок, нужный или нет.' },
        goal: { en: 'Nothing said on a call is lost; the AI only works on calls that matter.', ru: 'Ничто сказанное на звонке не теряется; AI работает только с нужными звонками.' },
        benefit: { en: 'All lost tasks and goals restored. 94% of irrelevant calls are now filtered out before the AI touches them.', ru: 'Все потерянные задачи и цели восстановлены. 94% нецелевых звонков отсекаются до AI-обработки.' },
        value: { amount: '−94%', note: { en: 'AI processing volume. Money value = × cost of processing one call', ru: 'объёма AI-обработки. Сумма = × стоимость обработки одного звонка' }, confidence: 'needs_data' },
      },
      {
        title: { en: 'Passport — a $30 bonus was paid three times', ru: 'Passport — бонус $30 выплачивался трижды' },
        task: { en: 'Every time a member earned a $30 reward the system credited it three times.', ru: 'Каждый раз, когда участник зарабатывал бонус $30, система начисляла его трижды.' },
        goal: { en: 'Pay exactly what was earned.', ru: 'Платить ровно столько, сколько заработано.' },
        benefit: { en: 'Triple payout stopped. Four visible bugs fixed along the way: blank reward and referral pages, missing documents, page jumping.', ru: 'Тройная выплата остановлена. Попутно исправлены 4 видимых бага: пустые страницы наград и рефералов, пропавшие документы, скачки страницы.' },
        value: { amount: '$60 per reward', note: { en: 'overpayment stopped; total depends on how many rewards were issued', ru: 'переплата остановлена; итог зависит от числа начислений' }, confidence: 'confirmed' },
      },
      {
        title: { en: 'A slow website was losing visitors', ru: 'Медленный сайт терял посетителей' },
        task: { en: 'completerepairwa.com took too long to open on phones — visitors left before seeing the phone number.', ru: 'completerepairwa.com слишком долго открывался на телефонах — посетители уходили, не увидев номер.' },
        goal: { en: 'The site opens fast enough to keep the visitor.', ru: 'Сайт открывается так быстро, что посетитель остаётся.' },
        benefit: { en: 'Mobile speed score 40 → 76; page size cut from 4.7 MB to 1.3 MB.', ru: 'Оценка скорости на мобильных 40 → 76; размер страницы с 4.7 MB до 1.3 MB.' },
        value: { amount: 'More calls', note: { en: 'industry rule: each second saved ≈ +5–10% conversions. Needs site traffic to price', ru: 'ориентир: каждая сэкономленная секунда ≈ +5–10% конверсии. Нужен трафик сайта для суммы' }, confidence: 'needs_data' },
      },
      {
        title: { en: 'New websites no longer need an engineer', ru: 'Новые сайты больше не требуют инженера' },
        task: { en: 'Every new cleaning website needed an engineer to connect its contact form to Slack. One plumbing site was silently not sending requests at all.', ru: 'Каждый новый сайт клининга требовал инженера, чтобы подключить форму заявок к Slack. Один сантехнический сайт молча не отправлял заявки вообще.' },
        goal: { en: 'The marketing team connects sites themselves; no request is lost.', ru: 'Маркетинг подключает сайты сам; ни одна заявка не теряется.' },
        benefit: { en: 'Vivian connects sites without engineering. The plumbing site sends requests again.', ru: 'Vivian подключает сайты без инженеров. Сантехнический сайт снова отправляет заявки.' },
        value: { amount: '0 engineer hours', note: { en: 'per new site (was 1–2 hours each)', ru: 'на новый сайт (было 1–2 часа на каждый)' }, confidence: 'estimate' },
      },
      {
        title: { en: 'Technician app tested before 217 people see it', ru: 'Приложение техников проверено до выхода на 217 человек' },
        task: { en: 'The app was about to go to 217 technicians with unknown defects.', ru: 'Приложение готовилось к выходу на 217 техников с неизвестным числом дефектов.' },
        goal: { en: 'Find problems in testing, not in the field.', ru: 'Найти проблемы в тестировании, а не в поле.' },
        benefit: { en: '214 scenarios checked; 27 defects found, 10 of them critical, all before release.', ru: 'Проверено 214 сценариев; найдено 27 дефектов, 10 критических, все до релиза.' },
        value: { amount: '10 critical bugs', note: { en: 'never reached technicians', ru: 'не дошли до техников' }, confidence: 'confirmed' },
      },
    ],
  },
  {
    id: 'yevhenii', initials: 'YS', color: '#a78bfa',
    name: { en: 'Yevhenii Shevchenko', ru: 'Евгений Шевченко' },
    role: { en: 'Web / Automation', ru: 'Web / Automation' },
    tasks: [
      {
        title: { en: 'Request emails from 137 websites and spam on 22', ru: 'Письма с заявками со 137 сайтов и спам на 22' },
        task: { en: 'Request emails from 137 local websites arrived unreliably, and 9 of 10 submissions were spam that call-centre staff had to read.', ru: 'Письма с заявками со 137 локальных сайтов приходили ненадёжно, а 9 из 10 заявок были спамом, который читали сотрудники колл-центра.' },
        goal: { en: 'Every real request arrives; spam does not.', ru: 'Каждая настоящая заявка приходит; спам — нет.' },
        benefit: { en: '137 sites moved to a reliable mail service, 600 routes verified. Spam protection added to the 22 worst-hit sites.', ru: '137 сайтов переведены на надёжный почтовый сервис, проверено 600 маршрутов. На 22 самых атакуемых сайтах поставлена защита от спама.' },
        value: { amount: 'Call-centre time', note: { en: 'less spam to read; volume per site not in reports', ru: 'меньше спама на разбор; объём по сайту не в репортах' }, confidence: 'needs_data' },
      },
      {
        title: { en: '26 websites went down after a platform update', ru: '26 сайтов упали после обновления платформы' },
        task: { en: 'A software update broke 26 lead-generating websites at once.', ru: 'Обновление платформы одновременно положило 26 сайтов, приносящих лиды.' },
        goal: { en: 'Bring the sites back and make sure it cannot repeat.', ru: 'Вернуть сайты и исключить повтор.' },
        benefit: { en: 'All 26 restored. A safe update procedure written for Chris and Aldrin.', ru: 'Все 26 восстановлены. Для Chris и Aldrin написана безопасная процедура обновления.' },
        value: { amount: '26 sites', note: { en: 'back to generating leads; downtime length not in reports', ru: 'снова приносят лиды; длительность простоя не в репортах' }, confidence: 'needs_data' },
      },
    ],
  },
  {
    id: 'minin', initials: 'DM', color: '#f472b6',
    name: { en: 'Dmitry Minin', ru: 'Дмитрий Минин' },
    role: { en: 'AI / Automation', ru: 'AI / Automation' },
    tasks: [
      {
        title: { en: 'Electrical websites stopped sending requests over a weekend', ru: 'Электрические сайты не отправляли заявки все выходные' },
        task: { en: 'From Friday to Monday not a single request came through from any electrical website.', ru: 'С пятницы до понедельника ни одна заявка не пришла ни с одного электрического сайта.' },
        goal: { en: 'Restore the flow the same day it is reported.', ru: 'Восстановить поток в тот же день, как о нём сообщили.' },
        benefit: { en: 'Fixed Monday as top priority. Root cause found and closed.', ru: 'Исправлено в понедельник как задача первого приоритета. Причина найдена и закрыта.' },
        value: { amount: '≈ 30–35 leads', note: { en: 'lost over that weekend (at ~500 real leads a month); further loss stopped', ru: 'потеряно за те выходные (при ~500 настоящих лидов в месяц); дальнейшая потеря остановлена' }, confidence: 'estimate' },
      },
      {
        title: { en: 'Replacing a paid automation tool and stopping freezes', ru: 'Замена платного инструмента автоматизации и остановка зависаний' },
        task: { en: 'The company paid for Zapier while our own automation platform could do the same. That platform also froze and needed manual restarts.', ru: 'Компания платила за Zapier, хотя наша платформа автоматизации умела то же самое. Сама платформа при этом зависала и требовала ручного перезапуска.' },
        goal: { en: 'One automation platform, no subscription, no freezes.', ru: 'Одна платформа автоматизации, без подписки, без зависаний.' },
        benefit: { en: "Dean's automations moved off Zapier. Freezing fixed. Two missing domains found for the email project.", ru: 'Автоматизации Dean перенесены с Zapier. Зависания исправлены. Найдены 2 пропущенных домена для почтового проекта.' },
        value: { amount: 'Zapier subscription', note: { en: 'cancelled; amount not in reports', ru: 'отменена; сумма не в репортах' }, confidence: 'needs_data' },
      },
      {
        title: { en: 'Weekly quality score for every sales call', ru: 'Еженедельная оценка качества каждого продажного звонка' },
        task: { en: 'Sales calls were not scored consistently; Anastasia had no weekly view of who sells how.', ru: 'Продажные звонки не оценивались единообразно; у Anastasia не было еженедельного среза, кто как продаёт.' },
        goal: { en: 'Every call scored the same way; a weekly table per salesperson.', ru: 'Каждый звонок оценён по одной шкале; еженедельная таблица по каждому сейлзу.' },
        benefit: { en: 'Weekly scoring on 6 criteria is live. A data gap that hid 95% of calls from scoring was found and fixed — 975 calls now count.', ru: 'Еженедельный скоринг по 6 критериям работает. Найден и закрыт пробел, из-за которого 95% звонков не попадали в оценку — теперь учитываются 975 звонков.' },
        value: { amount: '975 calls', note: { en: 'now scored; sales uplift from coaching not yet measured', ru: 'теперь оцениваются; рост продаж от коучинга ещё не измерен' }, confidence: 'none' },
      },
    ],
  },
  {
    id: 'kudlaev', initials: 'DK', color: '#8b5cf6',
    name: { en: 'Dmitriy Kudlaev', ru: 'Дмитрий Кудлаев' },
    role: { en: 'IT / Security', ru: 'IT / Security' },
    tasks: [
      {
        title: { en: 'Customer emails stuck for 9 days', ru: 'Письма клиентов стояли 9 дней' },
        task: { en: 'Email on the hvacallianceexpert.com domain stopped; 324 customer letters piled up unread.', ru: 'Почта на домене hvacallianceexpert.com остановилась; 324 письма клиентов накопились непрочитанными.' },
        goal: { en: 'Deliver the backlog and make the domain reliable.', ru: 'Доставить накопившееся и сделать домен надёжным.' },
        benefit: { en: 'All 324 letters delivered; two mailboxes recovered; the client confirmed mail works.', ru: 'Все 324 письма доставлены; два ящика восстановлены; клиент подтвердил, что почта работает.' },
        value: { amount: '324 letters', note: { en: 'customer correspondence recovered', ru: 'клиентская переписка восстановлена' }, confidence: 'confirmed' },
      },
      {
        title: { en: 'Security alerts across company accounts', ru: 'Оповещения о безопасности по аккаунтам компании' },
        task: { en: 'Nobody was alerted when something suspicious happened in company Google accounts.', ru: 'Никто не получал сигнал, когда в аккаунтах Google компании происходило что-то подозрительное.' },
        goal: { en: 'Suspicious activity raises an alert within minutes; pick the cheapest tool that does the job.', ru: 'Подозрительная активность поднимает сигнал за минуты; выбрать самый дешёвый инструмент, который справляется.' },
        benefit: { en: '11 alert rules live across 7 types of activity. Paid option ($27–35 a month) compared against a free one.', ru: '11 правил оповещений по 7 типам активности. Платный вариант ($27–35 в месяц) сравнён с бесплатным.' },
        value: { amount: '≈ $400 a year', note: { en: 'if the free tool is chosen', ru: 'если выбран бесплатный инструмент' }, confidence: 'estimate' },
      },
    ],
  },
  {
    id: 'bachinskiy', initials: 'SB', color: '#fb7185',
    name: { en: 'Sergey Bachinskiy', ru: 'Сергей Бачинский' },
    role: { en: 'DevOps', ru: 'DevOps' },
    tasks: [
      {
        title: { en: 'A $150,000 pilot we did not need to buy', ru: 'Пилот за $150,000, который не нужно было покупать' },
        task: { en: 'A vendor offered a 90-day pilot for $150,000 for government-contract work.', ru: 'Поставщик предложил 90-дневный пилот за $150,000 для работы с гос. контрактами.' },
        goal: { en: 'Check whether the same result is available for less.', ru: 'Проверить, доступен ли тот же результат дешевле.' },
        benefit: { en: 'A comparable solution found at no cost. Infrastructure reviewed with Shawn.', ru: 'Найдено сопоставимое решение без затрат. Инфраструктура проверена вместе с Shawn.' },
        value: { amount: '$150,000', note: { en: 'not spent', ru: 'не потрачено' }, confidence: 'confirmed' },
      },
      {
        title: { en: 'Phone system outage and infrastructure for finance', ru: 'Сбой телефонии и инфраструктура для финансов' },
        task: { en: 'The call-centre phone system lost its storage and licence. The new finance reporting had no production servers to run on.', ru: 'Телефония колл-центра потеряла хранилище и лицензию. У новой финансовой отчётности не было продакшн-серверов.' },
        goal: { en: 'Phones back; finance reporting on reliable infrastructure.', ru: 'Телефония работает; финансовая отчётность на надёжной инфраструктуре.' },
        benefit: { en: 'Phone system restored. Finance servers, security and deployment pipeline built. Engineering dashboard moved to a production database.', ru: 'Телефония восстановлена. Построены серверы, защита и процесс выкладки для финансов. Инженерный дашборд переведён на продакшн-базу.' },
        value: { amount: 'Enabler', note: { en: 'call-centre downtime stopped; foundation for finance reporting', ru: 'простой колл-центра остановлен; основа финансовой отчётности' }, confidence: 'none' },
      },
    ],
  },
  {
    id: 'shawn', initials: 'SG', color: '#38bdf8',
    name: { en: 'Shawn Gregg', ru: 'Шон Грегг' },
    role: { en: 'AI / Automation', ru: 'AI / Automation' },
    tasks: [
      {
        title: { en: 'Training platform update and spam in Leadbank', ru: 'Обновление учебной платформы и спам в Leadbank' },
        task: { en: 'The internal training platform lacked Slack integration and access control. Leadbank was receiving spam leads.', ru: 'У внутренней учебной платформы не было интеграции со Slack и контроля доступа. В Leadbank приходили спам-лиды.' },
        goal: { en: 'Training platform usable day to day; only real leads in Leadbank.', ru: 'Учебная платформа удобна в ежедневной работе; в Leadbank только настоящие лиды.' },
        benefit: { en: 'Platform updated: Slack, org chart, access control, AI assistant. Spam routing and real-time blocking added to Leadbank with Zach. SEO content tool ready to launch.', ru: 'Платформа обновлена: Slack, оргструктура, контроль доступа, AI-ассистент. В Leadbank добавлены маршрутизация и блокировка спама в реальном времени (с Zach). Инструмент SEO-контента готов к запуску.' },
        value: { amount: 'Not measured', note: { en: 'no before/after figures in reports', ru: 'цифр до/после в репортах нет' }, confidence: 'none' },
      },
    ],
  },
  {
    id: 'malyshev', initials: 'AM', color: '#00e5a0',
    name: { en: 'Aleksandr Malyshev', ru: 'Александр Малышев' },
    role: { en: 'Dev Lead', ru: 'Dev Lead' },
    tasks: [
      {
        title: { en: 'One screen for who does what and what it returns', ru: 'Один экран: кто что делает и что это приносит' },
        task: { en: 'Leadership had no single view of team workload, progress and business value; this review did not exist.', ru: 'У руководства не было единого вида на загрузку команды, прогресс и бизнес-ценность; этого обзора не существовало.' },
        goal: { en: 'A live team plan and a monthly business review generated from daily reports.', ru: 'Живой план команды и ежемесячный бизнес-обзор, собираемые из ежедневных репортов.' },
        benefit: { en: 'Team plan rebuilt: full-screen timeline, drag to reschedule, task cards with owner and description, active/done views. All August reports collected and loaded. This page is the first output.', ru: 'План команды перестроен: полноэкранная шкала, перенос задач мышкой, карточки с исполнителем и описанием, виды active/done. Все репорты августа собраны и загружены. Эта страница — первый результат.' },
        value: { amount: 'Management tool', note: { en: 'basis for this review', ru: 'основа этого обзора' }, confidence: 'none' },
      },
      {
        title: { en: 'Dashboard outage and a week of lost AI-cost data', ru: 'Падение дашборда и неделя потерянных данных о расходах на AI' },
        task: { en: 'After moving to a production database the dashboard went down, and AI usage tracking silently recorded nothing for a week.', ru: 'После переезда на продакшн-базу дашборд упал, а учёт использования AI неделю молча ничего не записывал.' },
        goal: { en: 'Dashboard stable; every dollar spent on AI tools is tracked again.', ru: 'Дашборд стабилен; каждый доллар на AI-инструменты снова учитывается.' },
        benefit: { en: "Outage root cause fixed in a day. The silent data loss found and closed; lost data is being recovered from engineers' machines.", ru: 'Причина падения устранена за день. Тихая потеря данных найдена и закрыта; потерянные данные восстанавливаются с машин инженеров.' },
        value: { amount: 'Restored', note: { en: 'dashboard uptime and AI cost visibility', ru: 'работа дашборда и видимость расходов на AI' }, confidence: 'none' },
      },
    ],
  },
];

// ── Page support ──────────────────────────────────────────────────────────────
// Not review content: what MonthlyReviewAugust needs to render and score the
// page. Kept here so the whole month lives in one file.

// One tone per SUMMARY card, in card order, on the same scale as the task
// confidence pills. Kept beside SUMMARY (not in the page, and not per-language)
// so adding or dropping a card cannot silently shift every card's colour.
export const SUMMARY_TONES = ['confirmed', 'confirmed', 'needs_data'];

// team_members.id — verified against GET /api/team on 2026-09-04
export const ENGINEER_IDS = {
  brunetkin: 1, malyshev: 10, roman: 12, pogrebnyak: 13, kudlaev: 14,
  bachinskiy: 15, azizbek: 16, minin: 18, shawn: 19, yevhenii: 21,
};

// Aug 31 / Sep 1 2026 falls in ISO week 36 — the review is scored on the week it
// is presented, the same way June 2026 was scored on week 27.
export const SCORE_WEEK = 36;
export const SCORE_YEAR = 2026;
