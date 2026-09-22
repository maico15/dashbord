#!/usr/bin/env python3
"""Apply the 2026-09-22 dev-meeting decisions to the Team Gantt.

Run it once, from anywhere that can reach the API:

    python3 scripts/gantt_update_2026_09_22.py --password 'ADMIN_PASSWORD'
    python3 scripts/gantt_update_2026_09_22.py --password '…' --dry-run   # show, change nothing

What it does, in order:

  0. Reads the whole board and checks that every id it is about to touch is the
     row the meeting notes describe. A mismatched engineer or project aborts the
     run before anything is written.
  1. Probes PUT semantics on id 171 — the one row whose update (100% / done) is
     wanted anyway — and re-reads it to confirm project, start_date, est_days
     and engineer_id survived. If PUT turns out to replace rather than merge,
     every later update is sent as the full row instead of a patch.
  2. Applies the updates, the deletion and the new tasks.
  3. Prints the table of every id it touched.

Safe to re-run: updates are idempotent by nature, the delete is skipped when the
row is already gone, and a new task is skipped when the same engineer already
has one with that exact title.

The password is read from the argument or GANTT_ADMIN_PW and never printed.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE = "https://dashbord-5u0i.onrender.com"
SRC = ("Source: https://app.fireflies.ai/view/01M34QS1KSDFVBC4WG3RARM1BG "
       "(dev meet 2026-09-22)")


def note(en: str, ru: str) -> str:
    """The house format: English, the ____ ru separator, Russian, then Source."""
    return f"{en}\n____ ru\n{ru}\n{SRC}"


# ── updates ──────────────────────────────────────────────────────────────────
# `expect` is a sanity check, not an edit: the run aborts if the row at that id
# is not the one the meeting was about (engineer id and a fragment of the title).

UPDATES = [
    {
        "id": 163, "expect": {"project_has": "Lead SLA"},
        "fields": {"percent": 85},
        "note": note(
            "Flow is live, missed forms now reach the monitor. Remaining: fix the wording bug "
            "seen on the Sydney Summer lead (\"Number disconnected, will send SMS\") via "
            "call-centre classification, and switch alert messages to English. QA by Anna.",
            "Флоу работает, пропущенные формы летят в монитор. Осталось: починить формулировку "
            "из заявки Sydney Summer через классификацию колл-центра и перевести сообщения "
            "алертов на английский. Проверяет Анна (QA).",
        ),
    },
    {
        "id": 176, "expect": {"project_has": "HA-Chat"},
        "fields": {"percent": 15, "status": "active"},
        "note": note(
            "Onboarding into the task done, draft n8n workflow assembled, open questions going "
            "to Roman (client owner, WordPress deployment method, content source).",
            "Онбординг в задачу пройден, собран черновой n8n workflow, открытые вопросы уходят "
            "Роману (владелец клиента, способ деплоя на WordPress, источник контента).",
        ),
    },
    {
        "id": 184, "expect": {"engineer_id": 1},
        "fields": {"percent": 20, "status": "active"},
        "note": note(
            "Taken into work after finishing the technician commissions fix.",
            "Взято в работу после закрытия правок по комиссиям техников.",
        ),
    },
    {
        "id": 185, "expect": {"engineer_id": 15},
        "fields": {"percent": 60},
        "note": note(
            "Staging finished and handed over to Pogrebnyak; production in progress today.",
            "Стейджинг закончен и передан Погребняку, сегодня занимается продом.",
        ),
    },
    {
        "id": 189, "expect": {"engineer_id": 18, "project_has": "Knowledge Panel"},
        # 80%, deliberately not closed — indexing has to happen first.
        "fields": {"percent": 80},
        "note": note(
            "Everything possible at this stage is done and tested; demo to Regina tonight. "
            "Cannot be closed — waiting for Google indexing, follow-up work after that.",
            "Всё, что можно сделать сейчас, сделано и протестировано, вечером показ Регине. "
            "Закрывать нельзя — ждём индексации в Google, после неё будут доработки.",
        ),
    },
    {
        "id": 182, "expect": {"engineer_id": 12, "project_has": "RingCentral"},
        "fields": {"percent": 50, "status": "active", "est_days": 5},
        "note": note(
            "Partial answers in: RingCentral is used only by DSRs and technicians, the call "
            "centre runs fully on Twilio. Tom does not respond, so answers are being collected "
            "directly from DSRs and Valeriia.",
            "Часть ответов получена: RingCentral используют только DSR и технические "
            "специалисты, колл-центр полностью на Twilio. Том не отвечает, ответы собираются "
            "напрямую у DSR и Валерии.",
        ),
    },
    {
        "id": 178, "expect": {"project_has": "Plumbing"},
        "fields": {"percent": 15, "status": "active"},
        "note": note(
            "In progress: reviewing SSL certificates, fixing critical errors, adding captcha, "
            "checking form validation. NB: the title says 16 domains, on the meeting 32 sites "
            "were named — scope needs confirming.",
            "В работе: пересмотр SSL-сертификатов, устранение критических ошибок, установка "
            "капчи, проверка валидации заявок. Внимание: в названии 16 доменов, на мите "
            "названо 32 сайта — объём нужно подтвердить.",
        ),
    },
    {
        "id": 171, "expect": {"project_has": "vikingappliance"},
        "fields": {"percent": 100, "status": "done"},
        "note": note(
            "Site handed over, moved to production, working.",
            "Сайт отдан, перенесён на прод, работает.",
        ),
        "probe": True,   # this is the row the PUT-semantics probe uses
    },
    {
        "id": 145, "expect": {"engineer_id": 12, "project_has": "Hiring"},
        "fields": {"start_date": "2026-09-22", "percent": 10},
        "note": note(
            "Stack decision: leaving Lovable for a separate closed Next.js + PostgreSQL "
            "project. Needs separate stage and prod on AWS; hosting on an Apollosoft subdomain "
            "instead of hi.alliancevs.io.",
            "Решение по стеку: уход из Lovable в отдельный закрытый проект на Next.js + "
            "PostgreSQL. Нужны отдельные stage и prod на AWS, размещение на субдомене "
            "Apollosoft вместо hi.alliancevs.io.",
        ),
    },
    {
        "id": 187, "expect": {"engineer_id": 13, "project_has": "Passport"},
        # The board only knows active / queued / continuous / done. "blocked" is
        # attempted first because the meeting asked for it; on the 422 the row
        # falls back to queued and the note carries the state instead.
        "fields": {"status": "blocked"},
        "status_fallback": "queued",
        "note": note(
            "BLOCKED — scope needed from Kia and Peter: Peter already has his own dashboard, "
            "unclear what exactly should be transferred.",
            "ЗАБЛОКИРОВАНА — нужен скоуп от Кии и Питера: у Питера уже есть свой дашборд, "
            "неясно, что именно переносить.",
        ),
    },
]

# ── deletion ─────────────────────────────────────────────────────────────────
DELETE = {
    "id": 180, "expect": {"engineer_id": 13, "project_has": "спам"},
    "why": "meeting: not taken without approval, not critical, back to the backlog",
}

# ── new tasks ────────────────────────────────────────────────────────────────
CREATE = [
    {
        "engineer_id": 1, "project": "Комиссии техников — исправление по документу Сергея",
        "start_date": "2026-09-22", "est_days": 1, "percent": 100, "status": "done",
        "note": note(
            "Reuploaded and corrected technician commissions; most now match Sergey's document.",
            "Перезалил и поправил комиссии техников, большинство приведено в соответствие "
            "документу Сергея.",
        ),
    },
    {
        "engineer_id": 13, "project": "Passport — дубликаты кастомеров по email",
        "start_date": "2026-09-22", "est_days": 2, "percent": 20, "status": "active",
        "note": note(
            "Members are matched by email instead of customerId; 46 customers share one "
            "placeholder address, so new customers fail to be created.",
            "Мемберы матчатся по email вместо customerId: 46 кастомеров на одном служебном "
            "адресе, из-за чего новые кастомеры не заводятся.",
        ),
    },
    {
        "engineer_id": 13, "project": "Passport — отсечение неподтверждённых по SMS на flow Дениса",
        "start_date": "2026-09-22", "est_days": 2, "percent": 30, "status": "active",
        "note": note(
            "Mechanism agreed with Denis, to be enabled across his whole calling flow; waiting "
            "on confirmation that the SMS actually arrives.",
            "Механизм согласован с Денисом, включаем на весь его flow; ждём подтверждения, "
            "что SMS доходит.",
        ),
    },
    {
        "engineer_id": 13, "project": "Passport — полная статистика по всем лидам",
        "start_date": "2026-09-23", "est_days": 2, "percent": 0, "status": "queued",
        "note": note(
            "New request from the business side. Noted at the meeting that this is outside "
            "Passport's scope but will be delivered.",
            "Новый запрос от бизнеса. На мите отмечено, что к Паспорту отношения не имеет, "
            "но будет сделано.",
        ),
    },
    {
        "engineer_id": 12, "project": "Расследование запросов по удалённому виртуальному ключу LLM",
        "start_date": "2026-09-22", "est_days": 1, "percent": 30, "status": "active",
        "note": note(
            "Alerts keep firing on a virtual key that was deleted; it is still in use somewhere "
            "(suspected old TechApp flow or staging). Requests observed throughout the day.",
            "Алерты продолжают приходить по удалённому виртуальному ключу — он где-то ещё "
            "используется (предположительно старый флоу TechApp или стейдж). Запросы идут "
            "весь день.",
        ),
    },
    {
        "engineer_id": 15, "project": "Stage и prod на AWS для Hiring Intelligence",
        "start_date": "2026-09-23", "est_days": 3, "percent": 0, "status": "queued",
        "note": note(
            "Separate stage and prod environments on AWS, hosted on an Apollosoft subdomain.",
            "Отдельные окружения stage и prod на AWS, размещение на субдомене Apollosoft.",
        ),
    },
    {
        "engineer_id": 18, "project": "Knowledge Panel Sardor — доработки после индексации в Google",
        "start_date": "2026-09-29", "est_days": 2, "percent": 0, "status": "queued",
        "note": note(
            "Follow-up work once the data is picked up by Google; scope to be defined then.",
            "Доработки после того, как данные подтянутся в Google; объём определяется тогда же.",
        ),
    },
    {
        "engineer_id": 10, "project": "Портал заявок IT Ops — единая точка приёма запросов",
        "start_date": "2026-09-22", "est_days": 2, "percent": 60, "status": "active",
        "note": note(
            "Four pages: submit a request, check status by number, my requests, admin triage. "
            "Finish tomorrow, hand to Minin for testing, demo to Sardor on Friday.",
            "Четыре страницы: подать заявку, проверить статус по номеру, мои заявки, разбор "
            "заявок (админка). Добить завтра, отдать Минину на тест, в пятницу показать Сардору.",
        ),
    },
]

# Fields a full-row PUT has to carry if the API turns out to replace rather than
# merge. Read back from the row itself, so nothing is invented.
FULL_ROW_FIELDS = ("engineer_id", "project", "start_date", "est_days", "percent",
                   "status", "queue_start", "note", "depends_on")


class Api:
    def __init__(self, base, password, dry_run=False):
        self.base = base.rstrip("/")
        self._pw = password
        self.dry_run = dry_run

    def _call(self, method, path, body=None, with_password=False):
        url = f"{self.base}{path}"
        if with_password:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode({"password": self._pw})
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            url, data=data, method=method,
            headers={"Content-Type": "application/json"} if data else {},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as ex:
            detail = ex.read().decode("utf-8", "replace")[:300]
            # Never echo the URL: it carries the password.
            raise RuntimeError(f"{method} {path} → HTTP {ex.code}: {detail}") from None

    def board(self):
        """Every assignment on the board, keyed by id, with the engineer name."""
        data = self._call("GET", "/api/gantt")
        rows = {}
        for eng in data.get("engineers", []):
            for a in eng.get("assignments", []):
                rows[a["id"]] = {**a, "_engineer": eng.get("name", "?")}
        return rows

    def put(self, item_id, fields):
        if self.dry_run:
            return {"dry_run": True}
        return self._call("PUT", f"/api/gantt/{item_id}", fields, with_password=True)

    def delete(self, item_id):
        if self.dry_run:
            return {"dry_run": True}
        return self._call("DELETE", f"/api/gantt/{item_id}", with_password=True)

    def post(self, body):
        if self.dry_run:
            return {"dry_run": True, "id": None}
        return self._call("POST", "/api/gantt", body, with_password=True)


def check_expectations(rows, item_id, expect, label):
    """Abort rather than write to a row that is not the one the meeting meant."""
    row = rows.get(item_id)
    if row is None:
        return None, f"{label} id {item_id}: not on the board — skipped"
    if "engineer_id" in expect and row.get("engineer_id") != expect["engineer_id"]:
        return None, (f"{label} id {item_id}: expected engineer_id {expect['engineer_id']}, "
                      f"found {row.get('engineer_id')} ({row.get('_engineer')}) — skipped")
    frag = expect.get("project_has")
    if frag and frag.lower() not in str(row.get("project", "")).lower():
        return None, (f"{label} id {item_id}: expected a title containing {frag!r}, "
                      f"found {row.get('project')!r} — skipped")
    return row, None


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--password", default=os.environ.get("GANTT_ADMIN_PW", ""),
                    help="admin password (or set GANTT_ADMIN_PW)")
    ap.add_argument("--base-url", default=DEFAULT_BASE)
    ap.add_argument("--dry-run", action="store_true",
                    help="read and check everything, write nothing")
    args = ap.parse_args()

    if not args.password and not args.dry_run:
        sys.exit("Need the admin password: --password '…' or GANTT_ADMIN_PW=…")

    api = Api(args.base_url, args.password, args.dry_run)
    print(f"Board: {args.base_url}{'  (DRY RUN — nothing will be written)' if args.dry_run else ''}\n")

    rows = api.board()
    print(f"Read {len(rows)} assignments.")

    touched = []
    warnings = []

    # ── step 1: PUT semantics, probed on the row that wants updating anyway ──
    probe = next(u for u in UPDATES if u.get("probe"))
    before, err = check_expectations(rows, probe["id"], probe["expect"], "probe")
    if err:
        sys.exit(f"Aborting — the probe row is not what was expected.\n  {err}")

    snapshot = {k: before.get(k) for k in ("project", "start_date", "est_days", "engineer_id")}
    print(f"\n── PUT semantics probe on id {probe['id']} ──")
    print(f"   before: {snapshot}")
    api.put(probe["id"], {"percent": 100, "status": "done"})

    put_is_partial = True
    if args.dry_run:
        print("   dry run — probe not sent; assuming a partial (merging) PUT")
    else:
        after = api.board().get(probe["id"], {})
        lost = {k: (v, after.get(k)) for k, v in snapshot.items() if after.get(k) != v}
        if lost:
            put_is_partial = False
            print(f"   PUT REPLACES the row — fields changed: {lost}")
            print("   → restoring them and sending full rows for every later update")
            api.put(probe["id"], {**{k: before.get(k) for k in FULL_ROW_FIELDS},
                                  "percent": 100, "status": "done"})
        else:
            print("   PUT merges (partial update) — project, start_date, est_days, "
                  "engineer_id all survived")

    def send(item_id, fields, row):
        """One update, as a patch or as a full row depending on the probe."""
        if put_is_partial:
            return api.put(item_id, fields)
        merged = {k: row.get(k) for k in FULL_ROW_FIELDS}
        merged.update(fields)
        return api.put(item_id, merged)

    # ── step 2: the updates ─────────────────────────────────────────────────
    print("\n── updates ──")
    for upd in UPDATES:
        row, err = check_expectations(rows, upd["id"], upd["expect"], "update")
        if err:
            warnings.append(err)
            print(f"   ! {err}")
            continue
        fields = dict(upd["fields"])
        fields["note"] = upd["note"]
        if upd.get("probe"):
            # Already applied above; only the note is left to write.
            fields = {"note": upd["note"], **fields}
        try:
            send(upd["id"], fields, row)
            applied = fields.get("status", row.get("status"))
        except RuntimeError as ex:
            fallback = upd.get("status_fallback")
            if fallback and "Invalid status" in str(ex):
                warnings.append(
                    f"id {upd['id']}: status {fields['status']!r} rejected by the API "
                    f"(it knows active/queued/continuous/done) — set to {fallback!r}, "
                    f"the blocked state is recorded in the note"
                )
                print(f"   ! {warnings[-1]}")
                fields["status"] = fallback
                send(upd["id"], fields, row)
                applied = fallback
            else:
                raise
        touched.append(upd["id"])
        print(f"   ✓ id {upd['id']:<4} {row['_engineer']:<20} {str(row['project'])[:44]:<44} "
              f"→ {fields.get('percent', row.get('percent'))}% / {applied}")

    # ── step 3: the deletion ────────────────────────────────────────────────
    print("\n── deletion ──")
    row, err = check_expectations(rows, DELETE["id"], DELETE["expect"], "delete")
    if err:
        print(f"   · {err} (already removed?)")
    else:
        api.delete(DELETE["id"])
        print(f"   ✓ id {DELETE['id']} removed — {row['_engineer']}: {str(row['project'])[:60]}")
        print(f"     reason: {DELETE['why']}")

    # ── step 4: the new tasks ───────────────────────────────────────────────
    print("\n── new tasks ──")
    existing = {(r.get("engineer_id"), str(r.get("project", "")).strip()) for r in rows.values()}
    created_ids = []
    for item in CREATE:
        key = (item["engineer_id"], item["project"].strip())
        if key in existing:
            print(f"   · already on the board, skipped: {item['project'][:60]}")
            continue
        res = api.post(item)
        created_ids.append(res.get("id"))
        print(f"   ✓ id {str(res.get('id')):<5} engineer {item['engineer_id']:<3} "
              f"{item['project'][:52]:<52} {item['percent']}% / {item['status']}")

    # ── step 5: the result ──────────────────────────────────────────────────
    print("\n── board after the run ──")
    final = api.board() if not args.dry_run else rows
    ids = [i for i in touched + [c for c in created_ids if c] if i in final]
    print(f"{'id':<6}{'engineer':<22}{'task':<58}{'%':>5}  status")
    print("-" * 100)
    for i in ids:
        r = final[i]
        print(f"{i:<6}{str(r['_engineer'])[:21]:<22}{str(r['project'])[:57]:<58}"
              f"{r.get('percent', 0):>4}%  {r.get('status')}")
    if DELETE["id"] not in final:
        print(f"{DELETE['id']:<6}{'—':<22}{'(deleted, back to the backlog)':<58}{'':>5}  deleted")

    if warnings:
        print("\n── warnings ──")
        for w in warnings:
            print(f"   ! {w}")

    print("\nNot touched, as agreed: id 146 (FOS Migration Phase 1 — percent still to be "
          "decided), and the domain count in id 178's title (16 vs the 32 named at the "
          "meeting — only the note mentions it).")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as ex:
        msg = str(ex)
        if "HTTP 403" in msg:
            sys.exit("Rejected by the API — wrong admin password.\n  " + msg)
        sys.exit("Stopped: " + msg)
    except urllib.error.URLError as ex:
        sys.exit(f"Cannot reach the API: {ex.reason}")
    except KeyboardInterrupt:
        sys.exit("\nInterrupted — anything already sent has been applied.")
