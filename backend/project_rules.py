"""Сколько работы по каждому проекту шло в каждую неделю, по ежедневным отчётам.

Зачем это есть. Доска Team Gantt показывает, сколько проект открыт, но не
сколько по нему работали: Home Alliance ID открыт 208 дней, а с середины
августа до начала октября по нему шло по одному пункту отчёта в неделю. Без
этого счёта строка проекта выглядит сплошной, и со стороны это читается как
«человек полгода тянет одно и то же», хотя в те же недели он вёл ещё четыре
проекта.

Как считается. Пункт ежедневного отчёта относится к проекту, если в его тексте
есть отличительное слово этого проекта. Отличительное — ключевое слово:
«CRM», «доступ», «Claude», «агент», «сайт» встречаются почти в каждом отчёте и
в правила не берутся, иначе всё сходится со всем. Поэтому часть работы не
попадает ни в один проект, и это честнее, чем раздуть совпадения: ответ несёт
`matched` и `total`, чтобы страница могла показать охват.

Один пункт может относиться к двум проектам и считается в оба — отчёты пишут
прозой, и «перенёс flow Минина в n8n на сервисные учётки» это правда и про n8n,
и про передачу доступов.

Имена проектов обязаны совпадать с frontend/src/lib/projectMap.js: там те же
имена присваиваются задачам с доски, и страница кладёт недельный счёт в строку
по имени. Переименовали здесь — переименуйте и там.
"""
import re
from collections import defaultdict
from datetime import date, timedelta

# (имя проекта, отличительные слова). Порядок не важен: пункт попадает во все
# проекты, чьи слова в нём нашлись.
RULES = [
    ("Home Alliance ID", r"Home ?Alliance ID|HomeAlliance ID|\bHA ID\b|\bHAID\b"),
    ("Passport", r"\bPassport\b"),
    ("TechApp / Alliance Connect", r"\bTech ?App\b|Alliance Connect|communication[- ]server"),
    ("FOS и бухгалтерия", r"\bFOS\b|QuickBooks|\bQBO\b|Intuit"),
    ("Hiring Intelligence / HR CRM", r"Hiring Intelligence|\bHR CRM\b|HRCRM"),
    ("Колл-центр и телефония", r"[Кк]олл-?центр|\b[Cc]all [Cc]ent|cc-agent|cc-routing|voicemail|голосов[аы]|\bDSR\b|Twilio Flex"),
    ("CRM Apollo и интеграции", r"\bApollo\b|GoHighLevel|\bGHL\b"),
    ("Звонки: аналитика и качество", r"Happy Calls|call-scoring|транскрипц|расшифров|QA Control|\bCSAT\b|Qalytics|Reviews Tracker|Bright ?Data|SerpAPI|\bGBP\b"),
    ("Partner Success OS", r"Partner Success"),
    ("Сайты и веб", r"WordPress|WP Rocket|лендинг|[Ww]eb ?[Ff]orms?|дисклеймер|Cloudflare"),
    ("Автоматизации n8n и агенты", r"\bn8n\b|LiteLLM|OpenRouter|\bNewo\b"),
    ("Инфраструктура и деплой", r"\bAWS\b|\bECS\b|\bRender\b|Postgres|Drone"),
    ("Home Alliance OS", r"\bHA OS\b|HAOS|Home Alliance OS|Central Brain|Customer Brain"),
    ("База знаний и SEO", r"Knowledge Panel|Search Console|llms\.txt|\bSEO\b|[Бб]аза знаний"),
    ("Доступы, безопасность, офбординг", r"\b2FA\b|\bVPN\b|офбординг|offboard|\bDMARC\b|фишинг|phishing|LastPass|Bitwarden"),
    ("Расходы и AI-подписки", r"Lovable|подписк|биллинг|invoice|инвойс"),
    ("Проект Тадэжа", r"Tadej|Тадэж"),
    ("Передача дел Минина", r"передач[аиу] доступов|передачу дел"),
]
_COMPILED = [(name, re.compile(pat, re.I)) for name, pat in RULES]

# Поля отчёта, которые описывают работу. Заголовки и пустые строки не считаем.
REPORT_FIELDS = ("completed", "next_tasks", "delayed_risks", "invisible_work")


def monday_of(day: str) -> str:
    d = date.fromisoformat(day)
    return (d - timedelta(days=d.weekday())).isoformat()


def items_of(report: dict):
    """Пункты одного отчёта — списком строк, в каком бы виде поле ни лежало."""
    out = []
    for field in REPORT_FIELDS:
        value = report.get(field)
        if isinstance(value, list):
            out += [str(v) for v in value if str(v).strip()]
        elif value and str(value).strip():
            out.append(str(value))
    return out


def weekly_activity(rows):
    """rows — (report_date, engineer_name, report dict).

    Возвращает недельный счёт по проектам, параллельность по людям и охват.
    """
    counts = defaultdict(lambda: defaultdict(int))     # проект -> неделя -> пунктов
    parallel = defaultdict(lambda: defaultdict(set))   # инженер -> неделя -> проекты
    weeks = set()
    total = matched = 0

    for day, engineer, report in rows:
        week = monday_of(day)
        weeks.add(week)
        for text in items_of(report):
            total += 1
            hit = False
            for name, rx in _COMPILED:
                if rx.search(text):
                    counts[name][week] += 1
                    parallel[engineer][week].add(name)
                    hit = True
            if hit:
                matched += 1

    weeks = sorted(weeks)
    team = {}
    for week in weeks:
        projects, people = set(), 0
        for engineer, by_week in parallel.items():
            if week in by_week:
                projects |= by_week[week]
                people += 1
        team[week] = {"projects": len(projects), "engineers": people}

    return {
        "weeks": weeks,
        "projects": {name: dict(by_week) for name, by_week in counts.items()},
        "per_engineer": {
            engineer: {week: sorted(p) for week, p in by_week.items()}
            for engineer, by_week in parallel.items()
        },
        "team_week": team,
        "items_total": total,
        "items_matched": matched,
    }
