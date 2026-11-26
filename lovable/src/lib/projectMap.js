/* Проекты для страницы /projects.
 *
 * В gantt_assignments колонка `project` — это название задачи, отдельного поля
 * проекта нет. Пока его нет, задачи сворачиваются в проекты правилами ниже:
 * сначала точное совпадение по ref, затем первое подошедшее регулярное
 * выражение по названию. Одна задача попадает ровно в один проект.
 *
 * Как править: добавить ref в BY_REF или выражение в RULES. Порядок RULES
 * значим — выигрывает первое совпадение. Новый проект заводится одной строкой.
 *
 * Когда в gantt_assignments появится своё поле проекта, этот файл станет
 * запасным вариантом для строк, у которых оно не заполнено.
 */

/** Задачи, у которых проект назначен вручную. Имеет приоритет над RULES. */
export const BY_REF = {
  'Home Alliance OS': ['IT-0089', 'IT-0106', 'IT-0143', 'IT-0040'],
  'Передача дел Минина': ['IT-0149', 'IT-0215', 'IT-0216', 'IT-0207', 'IT-0219', 'IT-0186', 'IT-0181', 'IT-0258', 'IT-0264'],
  'Проект Тадэжа': ['IT-0093', 'IT-0153'],
  'Partner Success OS': ['IT-0182'],
  'Поддержка (постоянная)': ['IT-0011', 'IT-0209', 'IT-0148', 'IT-0132'],
  'Колл-центр и телефония': ['IT-0229', 'IT-0067'],
  'Инфраструктура и деплой': ['IT-0059', 'IT-0023'],
  'Автоматизации n8n и агенты': ['IT-0077', 'IT-0032'],
  'CRM Apollo и интеграции': ['IT-0019', 'IT-0068', 'IT-0101', 'IT-0193'],
  'FOS и бухгалтерия': ['IT-0031'],
  'TechApp / Alliance Connect': ['IT-0096', 'IT-0109'],
  'Звонки: аналитика и качество': ['IT-0078', 'IT-0195'],
  'Доступы, безопасность, офбординг': ['IT-0252', 'IT-0244', 'IT-0119'],
}

/** Порядок значим: выигрывает первое совпадение по названию задачи. */
export const RULES = [
  ['Home Alliance ID', /Home ?Alliance ID|HomeAlliance ID|HA ID|единый каталог сотрудников/i],
  ['Колл-центр и телефония', /колл-?центр|Call Center|Call-loss|роутер колл|cc-agent|cc-routing|Flex|outbound|csr|Twilio|RingCentral|SMS|aia\.rocks/i],
  ['Passport', /Passport/i],
  ['TechApp / Alliance Connect', /Tech ?app|Alliance Connect|tech message/i],
  ['FOS и бухгалтерия', /FOS|QuickBooks|Комиссии техников|Authorize\.net|банковским счетам|Финансовое хранилище/i],
  ['Hiring Intelligence / HR CRM', /Hiring Intelligence|HR CRM|Abakus|Abacus/i],
  ['Инфраструктура и деплой', /Deploy|деплой|Infras?tructure|Инфраструктурн|AWS|стейдж|Стенд|Окружение|сборщик|ezMCP|Stage и prod|Collect infra|New project/i],
  ['Автоматизации n8n и агенты', /n8n|Zapier|Watchdog|Same-Day|SLA Monitor|LiteLLM|OpenRouter|restricted_|Newo|MCP/i],
  ['Звонки: аналитика и качество', /call-scoring|AI call|транскрипц|расшифров|QA Control|Qalytics|CSAT|Sales Call Analytics|Happy Calls|GBP-номер|Google Ads|колл-лист|DoNotCall|Scorecard|SAL & Booking|Hector|Brandon|Брэндон|Anna —/i],
  ['Сайты и веб', /сайт|WordPress|WP Rocket|лендинг|[Ww]eb [Ff]orms|Cloudflare|дисклеймер|SSL|Location page|HA-Chat|TrustPro|vikingappliance|thermador|Academy|Нино/i],
  ['Доступы, безопасность, офбординг', /доступ|2FA|VPN|SIEM|офбординг|уволенн|OAuth|лиценз|Workspace|DNS|G Suite|Прокси|Политика|домен/i],
  ['Расходы и AI-подписки', /расход|Cut budget|бюджет|аудит AI|AI-сервис|AI tools access|ChatGPT и Claude|Bright Data|Lovable|Jira|кошельк|GoHighLevel — admin/i],
  ['CRM Apollo и интеграции', /Apollo|CRM|GHL|GoHighLevel|PPC OS|Трекер электриков|UTM/i],
  ['Дашборд и отчётность', /Dashboard|дашборд|Monthly Review|отчёт|Ops\/IT|Владельцы продукта|Корпоративные сервисы|аудит коммуникаций/i],
  ['База знаний и SEO', /База знаний|Knowledge|SEO|GA4|llms\.txt|мануал|Figma/i],
]

/* Отпуска не проект — это разрыв в работе человека. На странице они не строка,
 * а штриховка поверх недель того, кто был в отпуске. «Vacation (working
 * remotely)» разрывом не считается: человек работал. */
export const EXCLUDE = /^Vacation/i
export const VACATION = /^Vacation/i
export const VACATION_WORKING = /working remotely/i

/* История из git — карта проектов Андрея Брюнеткина (27.04–09.11.2026),
 * построенная из 14 репозиториев: 1 573 коммита, 1 026 заметок.
 * Доска Team Gantt начинается только 6 июля, поэтому для этих проектов
 * настоящая длительность берётся отсюда и помечается на странице звёздочкой.
 *
 * Сведены только те линии, где это один и тот же проект. Его «Call center»,
 * «Alliance Connect», «CRMv2» и «DWH» намеренно не сведены: это его участки
 * работы, а не те же проекты, что на доске. */
export const GIT_HISTORY = {
  'Home Alliance ID': { src: 'HA ID', start: '2026-04-16', last: '2026-11-06', stages: 9 },
  'FOS и бухгалтерия': { src: 'FOS', start: '2026-04-21', last: '2026-11-09', stages: 10 },
  'CRM Apollo и интеграции': { src: 'Apollo CRM', start: '2026-04-06', last: '2026-11-02', stages: 8 },
  'Home Alliance OS': { src: 'HAOS/CSR', start: '2026-05-25', last: '2026-07-03', stages: 3 },
}

/** Первый день, за который на доске есть задачи. */
export const BOARD_START = '2026-07-06'
/** Первый день, за который есть история в git. */
export const GIT_START = '2026-04-06'

/** Проект одной задачи. */
export function projectOf(task) {
  const title = task.project || ''
  if (EXCLUDE.test(title)) return null
  for (const [name, refs] of Object.entries(BY_REF)) {
    if (task.ref && refs.includes(task.ref)) return name
  }
  for (const [name, re] of RULES) {
    if (re.test(title)) return name
  }
  return 'Прочее'
}
