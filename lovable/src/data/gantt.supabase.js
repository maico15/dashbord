/* Реализация слоя данных поверх Supabase.
 *
 * Включается, когда VITE_DATA_SOURCE=supabase. Формат ответов — ровно тот же,
 * что у gantt.rest.js: страница Ганта не знает, какая из двух реализаций
 * работает.
 *
 * Чтение и простые записи идут через функции в самой базе (supabase/migrations
 * /0001_gantt.sql), а не собираются из нескольких запросов на клиенте. Так
 * сделано по двум причинам: форма ответа задаётся в одном месте и не может
 * разойтись с REST-версией, и запись остаётся атомарной — выдача номера IT-
 * и перенос задачи в бэклог не должны разваливаться на полпути.
 *
 * Чего здесь пока нет (осознанно, а не забыто): два синка — подтягивание
 * процентов из ежедневных отчётов и перечитывание бэклога из Google-таблицы.
 * Оба ходят во внешние системы и в Supabase станут edge-функциями на втором
 * этапе. До тех пор они честно сообщают, что не перенесены, и кнопки на
 * странице показывают эту ошибку вместо того, чтобы молча ничего не делать.
 */

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && key ? createClient(url, key) : null

function client() {
  if (!supabase) {
    throw new Error(
      'VITE_DATA_SOURCE=supabase, но VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY не заданы'
    )
  }
  return supabase
}

/** Ошибка, которую страница показывает как есть. */
function notMigrated(what) {
  return Promise.reject(
    new Error(`${what}: ещё не перенесено на Supabase (второй этап, edge-функция)`)
  )
}

async function rpc(fn, args = {}) {
  const { data, error } = await client().rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}

export const loadBoard = () => rpc('gantt_board')

export const loadBacklog = () => rpc('backlog_board')

export const loadAiWeekly = () => notMigrated('Потребление AI за неделю')

export const syncFromReports = () => notMigrated('Синк процентов из отчётов')

export const syncBacklog = () => notMigrated('Синк бэклога из Google-таблицы')

export async function setBacklogSheetUrl(urlValue) {
  const { error } = await client()
    .from('config')
    .upsert({ key: 'backlog_sheet_csv_url', value: urlValue }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
  return { ok: true }
}

export const applyChanges = (changes) =>
  rpc('gantt_apply_changes', { p_changes: changes })

export const toBacklog = (assignmentId, reason) =>
  rpc('gantt_to_backlog', { p_assignment_id: assignmentId, p_reason: reason })

export const lookupRef = (ref) => rpc('lookup_ref', { p_ref: ref })

/* --- общее, не только для Ганта --- */

/* Пароль администратора на втором этапе остаётся тем же, что сегодня: одна
 * строка в таблице config. Это не аутентификация, и ею никогда не была —
 * нормальный вход (Supabase Auth или Home Alliance ID) это отдельная задача,
 * и смешивать её с переездом не нужно: сначала переехать как есть, потом
 * менять модель доступа. */
export const verifyPassword = (password) =>
  rpc('verify_admin_password', { p_password: password })

export const health = () => rpc('health')
