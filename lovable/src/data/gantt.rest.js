/* Реализация слоя данных поверх нынешнего FastAPI.
 *
 * Это эталон формата: всё, что возвращают эти функции, сегодня работает в
 * проде. Реализация на Supabase (gantt.supabase.js) обязана отдавать ровно
 * то же самое.
 *
 * Бэкенд уже отдаёт CORS allow_origins=["*"], поэтому фронт на Lovable
 * обращается к нему напрямую, без единой правки на стороне сервера.
 */

import { api } from '../api/client'

/** Доска: инженеры со своими задачами.
 *  → { engineers: [{ id, name, color, hidden, latest_report_date,
 *                    suggested_next, assignments: [...] }] }
 *  Задача: { id, engineer_id, project, start_date, est_days, percent,
 *            status, queue_start, note, updated_at, depends_on, ref, priority } */
export const loadBoard = () => api.get('/gantt')

/** Недельное потребление AI по инженерам — верхняя полоса над доской.
 *  Не критично: страница переживает отсутствие этих данных. */
export const loadAiWeekly = () => api.get('/ai-usage/weekly')

/** Док бэклога под доской.
 *  → { items: [...], sheet_url, last_sync } */
export const loadBacklog = () => api.get('/backlog')

/** Подтянуть проценты из ежедневных отчётов. */
export const syncFromReports = (password) =>
  api.post('/gantt/sync-from-reports', {}, password)

/** Перечитать бэклог из Google-таблицы. */
export const syncBacklog = () => api.post('/backlog/sync')

/** Сохранить ссылку на таблицу бэклога. */
export const setBacklogSheetUrl = (url, password) =>
  api.put('/config', { backlog_sheet_csv_url: url }, password)

/** Применить очередь правок с доски одним запросом. */
export const applyChanges = (changes, password) =>
  api.post('/gantt/apply-changes', { changes }, password)

/** Снять задачу с Ганта в бэклог. Номер IT- едет вместе с ней. */
export const toBacklog = (assignmentId, reason, password) =>
  api.post(`/gantt/${assignmentId}/to-backlog`, { reason }, password)

/** Найти что угодно по номеру IT-.
 *  → { kind: 'gantt' | 'backlog' | 'request', id, title, engineer, ... } */
export const lookupRef = (ref, password) =>
  api.get(`/ref/${ref}?password=${encodeURIComponent(password)}`)

/* --- общее, не только для Ганта --- */

/** Проверка пароля администратора. Бросает, если пароль неверный. */
export const verifyPassword = (password) =>
  api.post(`/admin/verify?password=${encodeURIComponent(password)}`, {})

/** Жив ли бэкенд — зелёная точка в футере. */
export const health = () => api.get('/overview')
