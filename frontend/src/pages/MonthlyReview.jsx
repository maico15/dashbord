import { useState } from 'react'
import { Link } from 'react-router-dom'

// ── Translations ─────────────────────────────────────────────────────────────
const T = {
  en: {
    title: 'IT Department',
    subtitle: 'Engineering · Infrastructure · AI · Operations',
    presented: 'Presented',
    prevReview: 'Previous review',
    teamSize: 'Team size',
    newThisMonth: 'New this month',
    trackingSince: 'Tracking since',
    sectionMetrics: 'Key Metrics — May vs June',
    sectionReporting: 'Daily Reporting — June 2026',
    sectionAI: 'AI Usage — June 2026',
    sectionProjects: 'Key Projects — June 2026',
    sectionTelemetry: 'AI Telemetry Platform — Built in June',
    backToDashboard: '← Dashboard',
    nextReview: 'Next review: August 1, 2026 →',
    footer: 'Engineering Dashboard · Data collected via cc_telemetry_tray',
    may: 'May 2026',
    june: 'June 2026',
    notTracked: 'Not tracked',
    sporadic: 'Sporadic',
    systematic: 'Systematic',
    peak: 'Peak week',
    shippedToProd: 'Shipped to prod',
    active: 'Active',
    alpha: 'Alpha',
    inProgress: 'In Progress',
    context: 'Context',
    contextText: 'The daily reporting system was established on Jun 15 (W25). Brunetkin was the only engineer writing daily throughout all of June. From Jun 15 onward — all 4 core engineers report daily (80–100% coverage). W23–W24 reports for Pogrebnyak, Romario, and Malyshev will be migrated into the dashboard.',
    fullMonthTracking: 'Full-month tracking begins July 2026.',
    trackerNote: 'Tracker deployed Jun 15. Romario used Lovable ~4h/day Jun 1–14 (untracked ~40h). Real June total estimated 140h+.',
    tracked: 'Tracked (2.5 wks)',
    fullMonthEst: 'Full month est.',
    totalJune: 'Total June output tokens',
    whatWeTrack: 'What we track',
    vsMay: 'vs May',
    next: 'Next',
    releases: 'releases in June',
    engineersTracked: 'Engineers tracked',
    toolsDetected: 'AI tools detected',
    browserAI: 'Browser AI tracked',
    latestVersion: 'Latest version',
    dayOf: 'of',
    days: 'days',
    fromJun15: 'From Jun 15',
    notLoadedYet: 'W23–W24 not loaded yet',
    dashboardFocus: 'Dashboard focus',
  },
  ru: {
    title: 'IT Отдел',
    subtitle: 'Разработка · Инфраструктура · AI · Операции',
    presented: 'Презентация',
    prevReview: 'Предыдущий обзор',
    teamSize: 'Команда',
    newThisMonth: 'Новый в этом месяце',
    trackingSince: 'Отслеживание с',
    sectionMetrics: 'Ключевые метрики — Май vs Июнь',
    sectionReporting: 'Ежедневные репорты — Июнь 2026',
    sectionAI: 'Использование AI — Июнь 2026',
    sectionProjects: 'Ключевые проекты — Июнь 2026',
    sectionTelemetry: 'Платформа телеметрии AI — создана в июне',
    backToDashboard: '← Дашборд',
    nextReview: 'Следующий обзор: 1 августа 2026 →',
    footer: 'Engineering Dashboard · Данные собраны через cc_telemetry_tray',
    may: 'Май 2026',
    june: 'Июнь 2026',
    notTracked: 'Не отслеживалось',
    sporadic: 'Нерегулярно',
    systematic: 'Систематически',
    peak: 'Пиковая неделя',
    shippedToProd: 'В продакшне',
    active: 'Активно',
    alpha: 'Альфа',
    inProgress: 'В процессе',
    context: 'Контекст',
    contextText: 'Система ежедневных репортов запущена 15 июня (W25). Брунеткин единственный писал каждый день весь июнь. Начиная с 15 июня — все 4 инженера пишут ежедневно (80–100%). Репорты за W23–W24 для Погребняка, Ромарио и Малышева будут загружены в дашборд.',
    fullMonthTracking: 'Полный месячный трекинг начинается с июля 2026.',
    trackerNote: 'Трекер запущен 15 июня. Ромарио использовал Lovable ~4ч/день 1–14 июня (не отслеживалось ~40ч). Реальный итог июня: 140ч+.',
    tracked: 'Отслежено (2.5 нед)',
    fullMonthEst: 'Оценка за месяц',
    totalJune: 'Всего токенов (вывод) за июнь',
    whatWeTrack: 'Что отслеживаем',
    vsMay: 'vs Май',
    next: 'Следующие шаги',
    releases: 'релизов в июне',
    engineersTracked: 'Инженеров подключено',
    toolsDetected: 'AI инструментов',
    browserAI: 'Browser AI отслежено',
    latestVersion: 'Последняя версия',
    dayOf: 'из',
    days: 'дней',
    fromJun15: 'С 15 июня',
    notLoadedYet: 'W23–W24 не загружены',
    dashboardFocus: 'Фокус на дашборде',
  }
}

// ── Data ──────────────────────────────────────────────────────────────────────
const ENGINEERS = [
  {
    id: 'brunetkin', initials: 'AB', color: '#00cfff',
    name: { en: 'Andrey Brunetkin', ru: 'Андрей Брунеткин' },
    badge: 'shippedToProd',
    reporting: { pct: 76, days: 16, total: 21, fromJun15: 100, note: null },
    sections: {
      en: [
        {
          title: 'HomeAlliance ID — Single Sign-On',
          items: [
            { text: 'Silent sign-in: token present → no form, token expired → fallback. No existing flows broken.', impact: 'Engineers sign into any HA platform without a second login' },
            { text: 'SSO deployed to Operator Console and Call-Center Monitoring Dashboard — fully verified in production.' },
            { text: 'CRM endpoint exposing token — live, security hardening in progress.' },
          ]
        },
        {
          title: 'HAOS CSR Block — Customer 360°',
          items: [
            { text: 'Built single customer-card service: property, contacts, jobs, memberships, metrics — one API call.', impact: 'Operator sees full customer history on every incoming call' },
            { text: 'Equipment and call history sections (with recordings and transcripts) added to live data.' },
            { text: 'Role-based access + rate limit + access log — first activation of access control for customer cards.' },
            { text: '3 prototype screens moved from test data to live CRM, deployed to test environment.' },
          ]
        },
        {
          title: 'FOS Technician Report',
          items: [
            { text: 'Basic and extended tiers shipped to production: jobs, sales, closing ratio, estimates, runs, company filter.' },
            { text: '~21K real jobs updated with 6 missing fields — zero data bloat.' },
          ]
        },
        {
          title: 'Payouts & Data Quality',
          items: [
            { text: 'Fixed 3.5% card fee anchoring: recalculated 668 June jobs (~+$2,090 in fees recovered).', impact: 'Financial accuracy on technician and company payouts' },
            { text: 'Eliminated duplicate job counts — repeat visits no longer inflate sales totals.' },
            { text: 'Restored 1,981 real paid jobs that lost codes in old import; deleted 39 genuine duplicates.' },
          ]
        },
      ],
      ru: [
        {
          title: 'HomeAlliance ID — Single Sign-On',
          items: [
            { text: 'Silent sign-in: токен есть → без формы, истёк → fallback. Существующие потоки не сломаны.', impact: 'Инженеры заходят в любую HA платформу без второго логина' },
            { text: 'SSO задеплоен в Operator Console и Call-Center Dashboard — подтверждено в продакшне.' },
            { text: 'CRM endpoint с токеном — live, усиление безопасности в процессе.' },
          ]
        },
        {
          title: 'HAOS CSR Блок — Customer 360°',
          items: [
            { text: 'Сервис карточки клиента: имущество, контакты, задания, членства, метрики — один API вызов.', impact: 'Оператор видит полную историю клиента на каждом входящем звонке' },
            { text: 'Секции оборудования и истории звонков (с записями и транскриптами) добавлены в live данные.' },
            { text: 'Role-based доступ + rate limit + лог доступа — первая активация контроля доступа к карточкам.' },
            { text: '3 прототипных экрана переведены с тестовых данных на live CRM, задеплоено в тест.' },
          ]
        },
        {
          title: 'FOS Отчёт Техников',
          items: [
            { text: 'Базовый и расширенный уровни в продакшне: задания, продажи, closing ratio, оценки, пробеги.' },
            { text: '~21K реальных заданий обновлены с 6 недостающими полями — без раздувания данных.' },
          ]
        },
        {
          title: 'Выплаты и качество данных',
          items: [
            { text: 'Исправлена привязка комиссии 3.5%: пересчитано 668 заданий за июнь (~+$2,090).', impact: 'Финансовая точность выплат техникам и компании' },
            { text: 'Устранены дублирующиеся задания — повторные визиты больше не раздувают продажи.' },
            { text: 'Восстановлено 1,981 реальных заданий; удалено 39 настоящих дублей.' },
          ]
        },
      ]
    }
  },
  {
    id: 'pogrebnyak', initials: 'AP', color: '#7b61ff',
    name: { en: 'Andrey Pogrebnyak', ru: 'Андрей Погребняк' },
    badge: 'active',
    reporting: { pct: 19, days: 4, total: 21, fromJun15: 80, note: 'notLoadedYet' },
    sections: {
      en: [
        {
          title: 'homealliance.com Homepage',
          items: [
            { text: 'Configured auto-deploy to Vercel for prod and staging — triggers on Lovable changes.' },
            { text: 'Completed booking form: customer creation, removed PrimeApp dependency.' },
            { text: 'Released to production — homealliance.com live.', impact: 'Main company website rebuilt on Lovable and deployed' },
          ]
        },
        {
          title: 'TCPA Incident Response',
          items: [
            { text: 'Added allow_sms and allow_email to Segment events — prod.' },
            { text: 'DNC color highlight in CustomerInfo + call warning in Flex — prod.' },
            { text: 'Flex Skill button access restriction to admin-specified users — staging.' },
            { text: 'CRM DNC API update for Flex — prod.' },
          ]
        },
        {
          title: 'HA OS — New Platform',
          items: [
            { text: '5 Claude agents, 4 custom skills, 8 DB models, geocoding + Gemini AI services.' },
            { text: 'ETL pipeline: migration for csrs and call_records tables.' },
            { text: 'QueryLab: 50 pre-built queries across 7 categories with SQL preview and execution.' },
            { text: 'Alliance Capture: onboarding wizard, missed-call SMS webhook, calls feed with filters.' },
          ]
        },
        {
          title: 'Twilio Flex SSO',
          items: [
            { text: 'Investigated SSO deprecation, reconfigured locally and on Twilio domain.' },
            { text: 'Staging complete; production deployment in progress.' },
          ]
        },
      ],
      ru: [
        {
          title: 'Главная страница homealliance.com',
          items: [
            { text: 'Auto-deploy на Vercel для prod и staging — запускается при изменениях в Lovable.' },
            { text: 'Форма бронирования завершена: создание клиента, убрана зависимость от PrimeApp.' },
            { text: 'Выпущено в продакшн — homealliance.com live.', impact: 'Главный сайт компании пересобран на Lovable' },
          ]
        },
        {
          title: 'TCPA Инцидент',
          items: [
            { text: 'Добавлены allow_sms и allow_email в Segment events — прод.' },
            { text: 'DNC подсветка в CustomerInfo + предупреждение в Flex — прод.' },
            { text: 'Ограничение кнопки Flex Skill по списку admin — staging.' },
            { text: 'Обновлён CRM DNC API для Flex — прод.' },
          ]
        },
        {
          title: 'HA OS — Новая платформа',
          items: [
            { text: '5 Claude агентов, 4 custom skills, 8 DB моделей, геокодинг + Gemini AI сервисы.' },
            { text: 'ETL pipeline: миграция для таблиц csrs и call_records.' },
            { text: 'QueryLab: 50 готовых запросов в 7 категориях с SQL предпросмотром и исполнением.' },
            { text: 'Alliance Capture: онбординг-wizard, SMS вебхук на пропущенные звонки, лента звонков.' },
          ]
        },
        {
          title: 'Twilio Flex SSO',
          items: [
            { text: 'Расследован deprecated SSO, переконфигурирован локально и на Twilio домене.' },
            { text: 'Staging завершён; деплой в прод в процессе.' },
          ]
        },
      ]
    }
  },
  {
    id: 'romario', initials: 'RM', color: '#00ff9d',
    name: { en: 'Roman Misan', ru: 'Роман Мисан' },
    badge: 'alpha',
    reporting: { pct: 24, days: 5, total: 21, fromJun15: 100, note: 'notLoadedYet' },
    sections: {
      en: [
        {
          title: 'Founder OS — AI-Powered SaaS',
          items: [
            { text: 'Transformed from frontend demo → working multi-tenant SaaS with Google auth + real backend.', impact: '4 users onboarded to alpha by end of June' },
            { text: 'Live Google Calendar sync: AI classifies events, unrecognized time dropped from ~70% to near zero.' },
            { text: 'Full Fireflies integration: reads meetings → OpenAI creates tasks and goals automatically.' },
            { text: '"Convert to Meeting Notes" feature for meetings without Fireflies recording.' },
            { text: 'Security: token protection, access rights, self-privilege escalation prevention.' },
          ]
        },
        {
          title: 'LeadFlow — CRM Analytics',
          items: [
            { text: 'Unified report: LSA + GA4 + GSC with MoM comparison engine (3/4/6/12 months).' },
            { text: 'CRM Apollosoft integration: auto-pull Booked status and Revenue, full export.' },
          ]
        },
        {
          title: 'Sites & n8n Automation',
          items: [
            { text: '73+ sites total — ~30 new this month (painting, cleaning, electrical, franchise sites).', impact: 'All form leads flow automatically to Slack channels' },
            { text: 'TrustPro Appliance — fully rebuilt on Lovable with forms, Slack, CAPTCHA.' },
            { text: 'Project Launch — Google Calendar OAuth, onboarding flow, GA4/GTM/GSC/Clarity.' },
            { text: 'Blogerman — blog post restoration across all sites completed.' },
          ]
        },
      ],
      ru: [
        {
          title: 'Founder OS — AI SaaS',
          items: [
            { text: 'Трансформирован из frontend-демо в работающий multi-tenant SaaS с Google auth.', impact: '4 пользователя в альфа-тестировании к концу июня' },
            { text: 'Live Google Calendar sync: AI классифицирует события, нераспознанное время упало с ~70% до нуля.' },
            { text: 'Полная интеграция Fireflies: читает встречи → OpenAI создаёт задачи и цели автоматически.' },
            { text: 'Функция "Convert to Meeting Notes" для встреч без записи Fireflies.' },
            { text: 'Безопасность: защита токенов, права доступа, предотвращение эскалации привилегий.' },
          ]
        },
        {
          title: 'LeadFlow — CRM Аналитика',
          items: [
            { text: 'Единый отчёт: LSA + GA4 + GSC с MoM сравнением (3/4/6/12 месяцев).' },
            { text: 'Интеграция CRM Apollosoft: авто-подтягивание статуса Booked и Revenue, полный экспорт.' },
          ]
        },
        {
          title: 'Сайты и n8n Автоматизация',
          items: [
            { text: '73+ сайтов — ~30 новых за месяц (малярные, клининг, электрика, франшизы).', impact: 'Все лиды с форм автоматически идут в Slack каналы' },
            { text: 'TrustPro Appliance — полностью пересобран на Lovable с формами, Slack, CAPTCHA.' },
            { text: 'Project Launch — Google Calendar OAuth, онбординг, GA4/GTM/GSC/Clarity.' },
            { text: 'Blogerman — восстановление постов блогов по всем сайтам завершено.' },
          ]
        },
      ]
    }
  },
  {
    id: 'malyshev', initials: 'AM', color: '#ffa200',
    name: { en: 'Aleksandr Malyshev', ru: 'Александр Малышев' },
    badge: 'shippedToProd',
    reporting: { pct: 19, days: 4, total: 21, fromJun15: 80, note: 'dashboardFocus' },
    sections: {
      en: [
        {
          title: 'Engineering Dashboard — Platform',
          items: [
            { text: 'Fully deployed, used daily by team.', impact: 'Single source of truth for all engineering activity' },
            { text: 'Multi-department: IT/Test tabs, self-registration API, branded onboarding screen.' },
            { text: 'AI Weekly Summary with HTML project-group formatting.' },
            { text: 'Loaded 29+ reports for team across all weeks.' },
          ]
        },
        {
          title: 'AI Telemetry Platform — 15 Releases',
          items: [
            { text: 'v2.4 shipped with auto-updater via GitHub Releases — one-click update for team.', impact: 'Zero manual distribution overhead going forward' },
            { text: 'Browser AI tracking: DNS cache + socket detection for 20+ tools (Claude, ChatGPT, Lovable, Gemini, Cursor...).' },
            { text: 'Fixed critical bugs: last_seen not updating, engineer_id type mismatch, python312.dll conflict.' },
            { text: 'My Stats window, Check for Update button, flush on exit, single instance lock.' },
            { text: '4 engineers on telemetry: Brunetkin, Pogrebnyak, Romario, Malyshev.' },
          ]
        },
      ],
      ru: [
        {
          title: 'Engineering Dashboard — Платформа',
          items: [
            { text: 'Полностью задеплоен, используется ежедневно.', impact: 'Единый источник правды для всей активности команды' },
            { text: 'Мультиотдел: вкладки IT/Test, self-registration API, брендированный онбординг.' },
            { text: 'AI Weekly Summary с HTML группировкой по проектам.' },
            { text: 'Загружено 29+ репортов для команды по всем неделям.' },
          ]
        },
        {
          title: 'Платформа телеметрии — 15 релизов',
          items: [
            { text: 'v2.4 с auto-updater через GitHub Releases — обновление одним кликом.', impact: 'Нулевые ручные расходы на дистрибуцию' },
            { text: 'Browser AI tracking: DNS cache + socket для 20+ инструментов.' },
            { text: 'Исправлены критические баги: last_seen, engineer_id type, python312.dll конфликт.' },
            { text: 'My Stats окно, Check for Update, flush on exit, single instance lock.' },
            { text: '4 инженера на телеметрии: Брунеткин, Погребняк, Ромарио, Малышев.' },
          ]
        },
      ]
    }
  },
  {
    id: 'bachinskiy', initials: 'SB', color: '#f59e0b',
    name: { en: 'Sergey Bachinskiy', ru: 'Сергей Бачинский' },
    badge: 'shippedToProd',
    reporting: null,
    sections: {
      en: [
        {
          title: 'AP-2919 — New CRM Production Deployment',
          items: [
            { text: 'Created full ECS task-definition with all required secrets for production CRM.', impact: 'Production-ready containerized CRM infrastructure from scratch' },
            { text: 'Created ECS cluster, RDS database, load balancer and security groups.' },
            { text: 'Launched ECS service for new CRM in production.' },
            { text: 'Built and debugged Drone CI pipeline for production deployment.' },
            { text: 'Added WAF rules for SSO testing on CRM.' },
          ]
        },
        {
          title: 'AP-2932 — Twilio Flex Production',
          items: [
            { text: 'Investigated Twilio Flex deployment requirements for new infrastructure.' },
            { text: 'Configured staging deployment — complete. Production in progress.', impact: 'Staging ready; production deployment ongoing' },
            { text: 'Fixed Flex-server production pipeline after CI failures.' },
          ]
        },
        {
          title: 'Infrastructure & Maintenance',
          items: [
            { text: 'Fixed Drone CI after build failures — pipelines restored.' },
            { text: 'CRM auto-scaling: target-tracking (CPU 60%), min 2 / max 8 instances.' },
            { text: 'CloudWatch alarms: RDS CPU >80%, EBS disk >85%, freeable memory.' },
            { text: 'Cleaned unattached EBS volumes, checked S3 lifecycle policies.' },
            { text: 'Fixed ACL on backup bucket — granular per-user access added.' },
          ]
        },
      ],
      ru: [
        {
          title: 'AP-2919 — Деплой нового CRM в прод',
          items: [
            { text: 'Создан полный ECS task-definition со всеми secrets для продакшн CRM.', impact: 'Production-ready контейнерная инфраструктура CRM с нуля' },
            { text: 'Создан ECS кластер, RDS база, load balancer и security groups.' },
            { text: 'Запущен ECS сервис нового CRM в продакшне.' },
            { text: 'Создан и отлажен Drone CI pipeline для деплоя в прод.' },
            { text: 'Добавлены WAF правила для SSO тестирования на CRM.' },
          ]
        },
        {
          title: 'AP-2932 — Twilio Flex Продакшн',
          items: [
            { text: 'Исследованы требования для деплоя Twilio Flex на новой инфраструктуре.' },
            { text: 'Staging deployment настроен — завершён. Прод в процессе.', impact: 'Staging готов; деплой в прод продолжается' },
            { text: 'Исправлен Flex-server pipeline после сбоев CI.' },
          ]
        },
        {
          title: 'Инфраструктура и обслуживание',
          items: [
            { text: 'Исправлен Drone CI после сбоев сборок — pipelines восстановлены.' },
            { text: 'CRM auto-scaling: target-tracking (CPU 60%), min 2 / max 8 инстансов.' },
            { text: 'CloudWatch алармы: RDS CPU >80%, EBS диск >85%, свободная память.' },
            { text: 'Очищены неподключённые EBS тома, проверены S3 lifecycle policies.' },
            { text: 'Исправлен ACL на backup bucket — гранулярный доступ по пользователям.' },
          ]
        },
      ]
    }
  },
  {
    id: 'kudlaev', initials: 'DK', color: '#7b61ff',
    name: { en: 'Dmitriy Kudlaev', ru: 'Дмитрий Кудлаев' },
    badge: 'inProgress',
    reporting: null,
    sections: {
      en: [
        {
          title: 'Housepros Google Workspace — Cloud Identity Free PoC',
          items: [
            { text: 'Diagnosed 300-user limit: Cloud Identity Free missing, auto-licensing blocking new users.', impact: 'Unlocks free user expansion beyond 300-user Workspace limit' },
            { text: 'Disabled auto-licensing, created test user above 300 cap — login confirmed.' },
            { text: 'Recovery email for test OU — personal mail as recovery, password reset via personal email.' },
            { text: 'Confirmed Drive, Meet, Gemini available for Cloud Identity Free users.' },
            { text: 'Coordinated tech onboarding dry run with Roland.' },
          ]
        },
        {
          title: 'Twilio Flex SSO',
          items: [
            { text: 'Completed Google SAML app integration on staging.', impact: 'Engineers sign into Flex via corporate Google account' },
            { text: 'Production deployment in progress.' },
            { text: 'SSO tested for housepros.io and ahiringgroup.com — ahiringgroup working.' },
          ]
        },
        {
          title: 'Access & IT Support',
          items: [
            { text: 'Updated Google OAuth redirect URI to HTTPS for leadbank-bi.homealliance.com.' },
            { text: 'Sent Housepros GSuite invoice to Ivanna Zakharchuk — confirmed.' },
            { text: 'Slack app approval routing clarified to Luka Morchiladze.' },
            { text: 'CRM password resets, OAuth fixes, exposed credentials flagged and actioned.' },
          ]
        },
      ],
      ru: [
        {
          title: 'Housepros Google Workspace — Cloud Identity Free PoC',
          items: [
            { text: 'Диагностирован лимит 300 пользователей: Cloud Identity Free отсутствовал, auto-licensing блокировал.', impact: 'Разблокировано расширение пользователей сверх лимита 300' },
            { text: 'Отключён auto-licensing, создан тестовый пользователь сверх 300 — логин подтверждён.' },
            { text: 'Recovery email для test OU — личная почта для сброса пароля, роутинг не нужен.' },
            { text: 'Подтверждена доступность Drive, Meet, Gemini для Cloud Identity Free пользователей.' },
            { text: 'Скоординирован пробный онбординг техников с Roland.' },
          ]
        },
        {
          title: 'Twilio Flex SSO',
          items: [
            { text: 'Завершена интеграция Google SAML app на staging.', impact: 'Инженеры входят в Flex через корпоративный Google аккаунт' },
            { text: 'Деплой в прод в процессе.' },
            { text: 'SSO протестирован для housepros.io и ahiringgroup.com — ahiringgroup работает.' },
          ]
        },
        {
          title: 'Доступы и IT поддержка',
          items: [
            { text: 'Обновлён Google OAuth redirect URI на HTTPS для leadbank-bi.homealliance.com.' },
            { text: 'Отправлен счёт Housepros GSuite Иванне Захарчук — подтверждён.' },
            { text: 'Luka Morchiladze разъяснено что Slack app approval требует workspace owner.' },
            { text: 'Сброс паролей CRM, исправления OAuth, взятие под контроль скомпрометированных credentials.' },
          ]
        },
      ]
    }
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function HALogo() {
  return (
    <svg height="30" viewBox="0 0 42 28" xmlns="http://www.w3.org/2000/svg">
      <g fill="none" fillRule="evenodd">
        <path fill="#33C" d="M0 27.903 15.514 0h8.276l-6.514 11.59h1.513L25.374 0h8.19L20.948 22.347h-8.163l4.965-8.858h-1.525l-8.14 14.414z"/>
        <path d="m33.564 0 8.318 15.364h-8.201l-4.32-7.93L33.564 0zm-4.992 8.86 3.54 6.504h-7.203l3.663-6.504zM23.79 0l.77 1.44-4.166 7.321-.803-1.3L23.79 0z" fill="#293359"/>
      </g>
    </svg>
  )
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 20, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
      {children}
    </div>
  )
}

function BadgeLabel({ type, t }) {
  const map = {
    shippedToProd: { label: t.shippedToProd, bg: 'rgba(34,197,94,.15)', color: 'var(--success)' },
    active:        { label: t.active,        bg: 'rgba(0,207,255,.15)', color: 'var(--accent1)' },
    alpha:         { label: t.alpha,         bg: 'rgba(167,139,250,.15)', color: '#a78bfa' },
    inProgress:    { label: t.inProgress,    bg: 'rgba(0,207,255,.15)', color: 'var(--accent1)' },
  }
  const b = map[type] || map.active
  return (
    <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 10, fontWeight: 500, background: b.bg, color: b.color }}>
      {b.label}
    </span>
  )
}

function CompareCard({ label, mayVal, juneVal, delta, deltaType = 'up', mayNote, juneNote, accent, footNote }) {
  const accentColor = accent || 'var(--accent)'
  const deltaStyle = deltaType === 'new'
    ? { background: 'rgba(0,207,255,.15)', color: 'var(--accent1)' }
    : { background: 'rgba(34,197,94,.15)', color: 'var(--success)' }
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px 14px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${accentColor}, transparent)` }} />
      <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 14 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>May</div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', color: accentColor }}>{mayVal}</div>
          {mayNote && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{mayNote}</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '0 4px 2px' }}>
          <span style={{ fontSize: 16, color: 'var(--muted)' }}>→</span>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, ...deltaStyle }}>{delta}</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>June</div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', color: accentColor }}>{juneVal}</div>
          {juneNote && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{juneNote}</div>}
        </div>
      </div>
      {footNote && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>{footNote}</div>}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function MonthlyReview() {
  const [lang, setLang] = useState('en')
  const t = T[lang]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>

      {/* ── Header ── */}
      <div style={{ background: 'linear-gradient(135deg, var(--card) 0%, var(--bg) 70%)', borderBottom: '1px solid var(--border)', padding: '36px 60px 28px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <HALogo />
            <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Engineering Review</div>
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.1 }}>
            {t.title}<br />
            <span style={{ background: 'linear-gradient(90deg, #3333cc, #00cfff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>June 2026</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>{t.subtitle}</div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: 'rgba(51,51,204,.15)', border: '1px solid rgba(51,51,204,.3)', fontSize: 12, fontWeight: 500, color: '#8888ff', marginTop: 14 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
            {t.presented} July 1, 2026
          </div>
        </div>
        <div style={{ textAlign: 'right', paddingTop: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 2.2 }}>
            <div>{t.prevReview}: <strong style={{ color: 'var(--text)' }}>May 2026 — June 1</strong></div>
            <div>{t.teamSize}: May: <strong style={{ color: 'var(--text)' }}>7</strong> → <strong style={{ color: 'var(--success)' }}>June: 8</strong></div>
            <div>{t.newThisMonth}: <strong style={{ color: 'var(--accent1)' }}>Evgeny Vinogradov</strong></div>
            <div>{t.trackingSince}: <strong style={{ color: 'var(--text)' }}>Jun 1 (Code) · Jun 15 (Browser)</strong></div>
          </div>
          {/* Language toggle */}
          <div style={{ display: 'flex', gap: 6, marginTop: 16, justifyContent: 'flex-end' }}>
            {['en', 'ru'].map(l => (
              <button key={l} onClick={() => setLang(l)} style={{ padding: '5px 14px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', background: lang === l ? 'var(--accent)' : 'var(--card)', color: lang === l ? '#fff' : 'var(--muted)', transition: 'all .2s' }}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: '40px 60px 80px', maxWidth: 1400, margin: '0 auto' }}>

        {/* ── Back link ── */}
        <div style={{ marginBottom: 32 }}>
          <Link to="/" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>{t.backToDashboard}</Link>
        </div>

        {/* ── KEY METRICS ── */}
        <div style={{ marginBottom: 52 }}>
          <SectionLabel>{t.sectionMetrics}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <CompareCard label="AI Output Tokens (Claude Code)" mayVal="13.5M" juneVal="20.1M" delta="+49%" accent="var(--accent1)" footNote="W26 alone: 7.8M — highest week ever" />
            <CompareCard label="Daily Reports Filed" mayVal="~10" juneVal="29" delta="×3" mayNote={t.sporadic} juneNote={t.systematic} accent="var(--success)" />
            <CompareCard label="Browser AI Hours" mayVal="—" juneVal="101h+" delta="NEW" deltaType="new" mayNote={t.notTracked} juneNote="2.5 wks data" accent="#a78bfa" footNote="Romario est. 4h/day in Lovable (untracked W23–W24)" />
            <CompareCard label="Sites Connected" mayVal="43" juneVal="73+" delta="+70%" accent="var(--accent-orange, #f97316)" footNote="~30 new sites via n8n automations (Roman)" />
          </div>
        </div>

        {/* ── DAILY REPORTING ── */}
        <div style={{ marginBottom: 52 }}>
          <SectionLabel>{t.sectionReporting}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
            {ENGINEERS.filter(e => e.reporting).map(eng => (
              <div key={eng.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: eng.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#080d1f', flexShrink: 0 }}>{eng.initials}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{eng.name[lang]}</div>
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: eng.color }}>{eng.reporting.pct}%</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{eng.reporting.days} {t.dayOf} {eng.reporting.total} {t.days}</div>
                <div style={{ marginTop: 10, height: 3, background: 'var(--border)', borderRadius: 2 }}>
                  <div style={{ width: `${eng.reporting.pct}%`, height: 3, borderRadius: 2, background: eng.color }} />
                </div>
                {eng.reporting.fromJun15 && (
                  <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 6 }}>{t.fromJun15}: {eng.reporting.fromJun15}%</div>
                )}
                {eng.reporting.note && (
                  <div style={{ fontSize: 10, color: 'var(--warning, #f59e0b)', marginTop: 2 }}>{t[eng.reporting.note]}</div>
                )}
              </div>
            ))}
          </div>
          <div style={{ background: '#0d1018', border: '1px solid #1a2040', borderRadius: 8, padding: '12px 16px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
            <span style={{ color: 'var(--accent1)', fontWeight: 600 }}>{t.context}: </span>
            {t.contextText} <strong style={{ color: 'var(--success)' }}>{t.fullMonthTracking}</strong>
          </div>
        </div>

        {/* ── AI USAGE ── */}
        <div style={{ marginBottom: 52 }}>
          <SectionLabel>{t.sectionAI}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Claude Code tokens */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 24px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 16 }}>Claude Code — Output Tokens by Week</div>
              {[
                { label: 'W23 Jun 1–7',   val: '3.0M', w: 38 },
                { label: 'W24 Jun 8–14',  val: '1.8M', w: 23 },
                { label: 'W25 Jun 15–21', val: '3.5M', w: 44 },
                { label: 'W26 Jun 22–28', val: '7.8M ↑', w: 100, peak: true },
                { label: 'W27 Jun 29–30', val: '3.9M', w: 49 },
              ].map(row => (
                <div key={row.label} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                    <span style={{ color: 'var(--muted)' }}>{row.label}</span>
                    <span style={{ color: row.peak ? 'var(--accent1)' : 'var(--text)' }}>{row.val}{row.peak ? ` ${t.peak}` : ''}</span>
                  </div>
                  <div style={{ height: 5, background: 'var(--border)', borderRadius: 3 }}>
                    <div style={{ width: `${row.w}%`, height: 5, borderRadius: 3, background: row.peak ? 'linear-gradient(90deg, var(--accent), var(--accent1))' : 'var(--accent)' }} />
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t.totalJune}</span>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent1)' }}>20.1M</div>
                  <div style={{ fontSize: 11, color: 'var(--success)' }}>+49% vs May 13.5M</div>
                </div>
              </div>
            </div>
            {/* Browser AI */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 24px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 14 }}>Browser AI Tools — Tracked from Jun 15</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.6, padding: '10px 12px', background: '#0d1018', borderRadius: 6, border: '1px solid #1a2040' }}>
                ⚠ {t.trackerNote}
              </div>
              {[
                { icon: 'G', name: 'ChatGPT',  time: '92.5h', w: 91, bg: '#10a37f', ibg: 'rgba(16,163,127,.2)' },
                { icon: 'C', name: 'Claude.ai', time: '8.5h',  w: 8,  bg: '#d97706', ibg: 'rgba(215,119,6,.2)' },
                { icon: 'L', name: 'Lovable',   time: '~40h est.', w: 40, bg: '#ff6b6b', ibg: 'rgba(255,107,107,.2)' },
              ].map(tool => (
                <div key={tool.name} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: tool.ibg, color: tool.bg, flexShrink: 0 }}>{tool.icon}</div>
                  <span style={{ fontSize: 13, minWidth: 80 }}>{tool.name}</span>
                  <div style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3 }}>
                    <div style={{ width: `${tool.w}%`, height: 5, borderRadius: 3, background: tool.bg }} />
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 60, textAlign: 'right' }}>{tool.time}</span>
                </div>
              ))}
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.tracked}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{t.fullMonthEst}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#a78bfa' }}>101h tracked</div>
                  <div style={{ fontSize: 11, color: 'var(--warning, #f59e0b)' }}>~140h+ real total</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── PROJECTS ── */}
        <div style={{ marginBottom: 52 }}>
          <SectionLabel>{t.sectionProjects}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {ENGINEERS.map(eng => (
              <div key={eng.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600 }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: eng.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#080d1f', flexShrink: 0 }}>{eng.initials}</div>
                    {eng.name[lang]}
                  </div>
                  <BadgeLabel type={eng.badge} t={t} />
                </div>
                {eng.sections[lang].map((sec, si) => (
                  <div key={si}>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', margin: si === 0 ? '0 0 6px' : '12px 0 6px' }}>{sec.title}</div>
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                      {sec.items.map((item, ii) => (
                        <li key={ii} style={{ fontSize: 13, color: '#9ca3b8', padding: '4px 0', display: 'flex', alignItems: 'flex-start', gap: 8, lineHeight: 1.45, borderBottom: '1px solid #14161e' }}>
                          <span style={{ color: 'var(--success)', flexShrink: 0, fontSize: 11, marginTop: 3 }}>✓</span>
                          <div>
                            {item.text}
                            {item.impact && <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--warning, #f59e0b)', marginTop: 2 }}>{item.impact}</div>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* ── TELEMETRY ── */}
        <div style={{ marginBottom: 52 }}>
          <SectionLabel>{t.sectionTelemetry}</SectionLabel>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 20, marginBottom: 20 }}>
              {[
                { val: 'v2.9.9', label: t.latestVersion,   color: 'var(--accent1)' },
                { val: '15',     label: t.releases,         color: 'var(--success)' },
                { val: '4',      label: t.engineersTracked, color: '#a78bfa' },
                { val: '20+',    label: t.toolsDetected,    color: 'var(--warning, #f59e0b)' },
                { val: '101h',   label: t.browserAI,        color: '#f97316' },
              ].map(s => (
                <div key={s.label}>
                  <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.02em', color: s.color }}>{s.val}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[
                {
                  title: t.whatWeTrack,
                  items: ['✓ Claude Code tokens (real-time)', '✓ Browser AI time (20+ tools)', '✓ Daily reports submitted', '✓ GitHub commits & PRs']
                },
                {
                  title: t.vsMay,
                  items: ['May: Manual token counting only', 'June: Fully automated tracking', '✓ Zero manual overhead', '✓ Auto-updater deployed']
                },
                {
                  title: t.next,
                  items: ['Rollout to all 8 engineers', 'Gemini / Grok detection', 'Multi-source scoring', 'Browser AI trend charts']
                },
              ].map(box => (
                <div key={box.title} style={{ background: '#0d1018', border: '1px solid #1a2040', borderRadius: 8, padding: '14px 16px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>{box.title}</div>
                  <ul style={{ listStyle: 'none', padding: 0 }}>
                    {box.items.map((item, i) => (
                      <li key={i} style={{ fontSize: 12, color: '#9ca3b8', lineHeight: 2 }}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{ paddingTop: 20, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
          <div>{t.footer} · July 1, 2026</div>
          <div style={{ color: 'var(--accent1)', fontWeight: 500 }}>{t.nextReview}</div>
        </div>

      </div>
    </div>
  )
}
