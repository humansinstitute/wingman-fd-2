import { ALL_TASK_BOARD_ID, UNSCOPED_TASK_BOARD_ID } from './task-board-state.js';
import { addPendingWrite, getManageableWappsByOwner, getWappById, upsertWapp } from './db.js';
import { outboundWapp } from './translators/wapps.js';
import { getRecordWriteFieldsForStore } from './preferred-write-group.js';
import { toRaw } from './utils/state-helpers.js';

const WAPP_SCHEDULE_DAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

function normalizeRecordId(value) {
  return String(value || '').trim();
}

function recordScopeIds(record = {}) {
  return [
    record.scope_id,
    record.scope_l5_id,
    record.scope_l4_id,
    record.scope_l3_id,
    record.scope_l2_id,
    record.scope_l1_id,
  ].map(normalizeRecordId).filter(Boolean);
}

function recordPrimaryScopeId(record = {}) {
  const explicitScopeId = normalizeRecordId(record.scope_id);
  if (explicitScopeId) return explicitScopeId;
  return [
    record.scope_l5_id,
    record.scope_l4_id,
    record.scope_l3_id,
    record.scope_l2_id,
    record.scope_l1_id,
  ].map(normalizeRecordId).find(Boolean) || '';
}

function scopeLineageIds(scope = {}) {
  return [
    scope.record_id,
    scope.id,
    scope.l5_id,
    scope.l4_id,
    scope.l3_id,
    scope.l2_id,
    scope.l1_id,
  ].map(normalizeRecordId).filter(Boolean);
}

function wappMatchesSelectedScope(wapp, selectedBoardId, selectedBoardScope) {
  if (!selectedBoardId || selectedBoardId === ALL_TASK_BOARD_ID) return true;
  const wappScopeIds = recordScopeIds(wapp);
  if (selectedBoardId === UNSCOPED_TASK_BOARD_ID) return wappScopeIds.length === 0;
  const selectedId = normalizeRecordId(selectedBoardScope?.record_id || selectedBoardId);
  if (!selectedId) return true;
  const wappScopeId = recordPrimaryScopeId(wapp);
  if (!wappScopeId) return false;
  const selectedLineage = scopeLineageIds(selectedBoardScope);
  if (!selectedLineage.includes(selectedId)) selectedLineage.unshift(selectedId);
  return selectedLineage.includes(wappScopeId);
}

function sortWapps(left, right) {
  const state = String(left.status || '').localeCompare(String(right.status || ''));
  if (state !== 0) return state;
  const title = String(left.title || '').localeCompare(String(right.title || ''));
  if (title !== 0) return title;
  return String(right.updated_at || '').localeCompare(String(left.updated_at || ''));
}

function parseTimeMinutes(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function getZonedDayAndMinutes(now, timezone) {
  const zone = String(timezone || '').trim();
  if (zone && typeof Intl !== 'undefined') {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(now);
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      const day = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[values.weekday];
      const hour = Number(values.hour);
      const minute = Number(values.minute);
      if (Number.isInteger(day) && Number.isInteger(hour) && Number.isInteger(minute)) {
        return { day, minutes: hour * 60 + minute };
      }
    } catch {
      // Fall through to local browser time if the timezone is invalid.
    }
  }
  return {
    day: now.getDay(),
    minutes: now.getHours() * 60 + now.getMinutes(),
  };
}

function windowDays(window) {
  return Array.isArray(window?.days)
    ? new Set(window.days.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))
    : null;
}

function scheduleWindowMatches(window, zoned) {
  const start = parseTimeMinutes(window?.start_time ?? window?.startTime);
  const end = parseTimeMinutes(window?.end_time ?? window?.endTime);
  if (start === null || end === null || start === end) return false;
  const days = windowDays(window);
  if (start < end) {
    return (!days || days.has(zoned.day)) && zoned.minutes >= start && zoned.minutes < end;
  }
  const previousDay = (zoned.day + 6) % 7;
  return (zoned.minutes >= start && (!days || days.has(zoned.day)))
    || (zoned.minutes < end && (!days || days.has(previousDay)));
}

function wappMatchesSchedule(wapp, now = new Date()) {
  const schedule = wapp?.schedule;
  if (!schedule || typeof schedule !== 'object') return true;
  const startsAt = Date.parse(schedule.starts_at ?? schedule.startsAt ?? '');
  if (Number.isFinite(startsAt) && now.getTime() < startsAt) return false;
  const endsAt = Date.parse(schedule.ends_at ?? schedule.endsAt ?? '');
  if (Number.isFinite(endsAt) && now.getTime() >= endsAt) return false;
  const windows = Array.isArray(schedule.windows) ? schedule.windows : [];
  if (windows.length === 0) return true;
  const zoned = getZonedDayAndMinutes(now, schedule.timezone);
  return windows.some((window) => scheduleWindowMatches(window, zoned));
}

function firstScheduleWindow(schedule) {
  const windows = Array.isArray(schedule?.windows) ? schedule.windows : [];
  return windows[0] || null;
}

function normalizeScheduleDays(days, fallback = [1, 2, 3, 4, 5]) {
  const source = Array.isArray(days) && days.length > 0 ? days : fallback;
  return [...new Set(source
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((left, right) => left - right);
}

function isoToDatetimeLocal(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function datetimeLocalToIso(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeTimeInput(value, fallback) {
  const text = String(value || '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback;
}

function buildWappVisibilityDraft(wapp) {
  const schedule = wapp?.schedule && typeof wapp.schedule === 'object' ? wapp.schedule : null;
  const window = firstScheduleWindow(schedule);
  return {
    record_id: wapp?.record_id || '',
    status: wapp?.status === 'archived' || wapp?.record_state === 'archived' ? 'archived' : 'active',
    schedule_enabled: Boolean(schedule),
    timezone: String(schedule?.timezone || 'Australia/Perth'),
    starts_at: isoToDatetimeLocal(schedule?.starts_at ?? schedule?.startsAt),
    ends_at: isoToDatetimeLocal(schedule?.ends_at ?? schedule?.endsAt),
    start_time: normalizeTimeInput(window?.start_time ?? window?.startTime, '06:00'),
    end_time: normalizeTimeInput(window?.end_time ?? window?.endTime, '12:00'),
    days: normalizeScheduleDays(window?.days, window ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]),
  };
}

function buildWappScheduleFromDraft(draft) {
  if (!draft?.schedule_enabled) return null;
  return {
    timezone: String(draft.timezone || '').trim() || null,
    starts_at: datetimeLocalToIso(draft.starts_at),
    ends_at: datetimeLocalToIso(draft.ends_at),
    windows: [{
      days: normalizeScheduleDays(draft.days),
      start_time: normalizeTimeInput(draft.start_time, '06:00'),
      end_time: normalizeTimeInput(draft.end_time, '12:00'),
    }],
  };
}

function scheduleDayLabels(days = []) {
  if (!Array.isArray(days) || days.length === 0) return 'Every day';
  const normalized = normalizeScheduleDays(days);
  if (normalized.length === 7) return 'Every day';
  const labelsByValue = new Map(WAPP_SCHEDULE_DAY_OPTIONS.map((day) => [day.value, day.label]));
  return normalized.map((day) => labelsByValue.get(day)).filter(Boolean).join(', ') || 'Weekdays';
}

export const wappsManagerMixin = {
  wapps: [],
  wappScheduleTick: 0,
  wappScheduleTimer: null,
  editingWappVisibilityId: null,
  editingWappVisibilityDraft: null,
  wappVisibilitySavingId: null,
  wappVisibilityNotice: '',
  wappVisibilityError: '',

  get wappScheduleDayOptions() {
    return WAPP_SCHEDULE_DAY_OPTIONS;
  },

  get manageableWapps() {
    const workspaceOwner = normalizeRecordId(this.workspaceOwnerNpub);
    return (this.wapps || [])
      .filter((wapp) => {
        if (!wapp || wapp.record_state === 'deleted') return false;
        if (workspaceOwner && normalizeRecordId(wapp.workspace_owner_npub || wapp.owner_npub) !== workspaceOwner) return false;
        return true;
      })
      .sort(sortWapps);
  },

  get visibleWapps() {
    void this.wappScheduleTick;
    const workspaceOwner = normalizeRecordId(this.workspaceOwnerNpub);
    return (this.wapps || [])
      .filter((wapp) => {
        if (!wapp || wapp.record_state === 'archived' || wapp.record_state === 'deleted' || wapp.status === 'archived') return false;
        if (workspaceOwner && normalizeRecordId(wapp.workspace_owner_npub || wapp.owner_npub) !== workspaceOwner) return false;
        if (!wappMatchesSchedule(wapp)) return false;
        return wappMatchesSelectedScope(wapp, this.selectedBoardId, this.selectedBoardScope);
      })
      .sort(sortWapps);
  },

  get hasVisibleWapps() {
    return this.visibleWapps.length > 0;
  },

  applyWapps(wapps = []) {
    const nextWapps = Array.isArray(wapps) ? wapps : [];
    if (typeof this.sameListBySignature === 'function') {
      if (this.sameListBySignature(this.wapps, nextWapps, (wapp) => [
        normalizeRecordId(wapp?.record_id),
        String(wapp?.updated_at || ''),
        String(wapp?.version ?? ''),
        String(wapp?.record_state || ''),
        String(wapp?.status || ''),
        JSON.stringify(wapp?.schedule || null),
        String(wapp?.launch_url || ''),
      ].join('|'))) {
        return;
      }
    }
    this.wapps = nextWapps;
    this.ensureWappScheduleTicker();
  },

  async refreshWapps() {
    const ownerNpub = this.workspaceOwnerNpub;
    if (!ownerNpub) return;
    await this.applyWapps(await getManageableWappsByOwner(ownerNpub));
  },

  ensureWappScheduleTicker() {
    const hasScheduledWapps = (this.wapps || []).some((wapp) => wapp?.schedule && typeof wapp.schedule === 'object');
    if (!hasScheduledWapps) {
      if (this.wappScheduleTimer && typeof window !== 'undefined') window.clearInterval(this.wappScheduleTimer);
      this.wappScheduleTimer = null;
      return;
    }
    if (this.wappScheduleTimer || typeof window === 'undefined') return;
    this.wappScheduleTimer = window.setInterval(() => {
      this.wappScheduleTick = Date.now();
    }, 60 * 1000);
  },

  getWappScopeLabel(wapp) {
    const scopeId = normalizeRecordId(wapp?.scope_id);
    if (!scopeId) return 'Workspace';
    return this.getScopeBreadcrumb?.(scopeId) || 'Scoped app';
  },

  getWappVisibilityStatusLabel(wapp) {
    if (wapp?.status === 'archived' || wapp?.record_state === 'archived') return 'Archived';
    if (!wappMatchesSchedule(wapp)) return 'Scheduled';
    return 'Visible';
  },

  getWappVisibilityStatusClass(wapp) {
    if (wapp?.status === 'archived' || wapp?.record_state === 'archived') return 'state-archived';
    if (!wappMatchesSchedule(wapp)) return 'state-new';
    return 'state-done';
  },

  formatWappVisibilitySummary(wapp) {
    if (wapp?.status === 'archived' || wapp?.record_state === 'archived') return 'Hidden from Flight Deck.';
    const schedule = wapp?.schedule;
    if (!schedule || typeof schedule !== 'object') return 'Always visible.';
    const window = firstScheduleWindow(schedule);
    const parts = [];
    if (window) {
      parts.push(`${scheduleDayLabels(window.days)} ${window.start_time || window.startTime || '??:??'}-${window.end_time || window.endTime || '??:??'}`);
    }
    if (schedule.timezone) parts.push(schedule.timezone);
    if (schedule.starts_at || schedule.startsAt) parts.push(`from ${new Date(schedule.starts_at || schedule.startsAt).toLocaleString()}`);
    if (schedule.ends_at || schedule.endsAt) parts.push(`until ${new Date(schedule.ends_at || schedule.endsAt).toLocaleString()}`);
    return parts.join(' | ') || 'Scheduled visibility.';
  },

  startEditWappVisibility(wappId) {
    const targetId = normalizeRecordId(wappId);
    const wapp = (this.wapps || []).find((item) => normalizeRecordId(item?.record_id) === targetId);
    if (!wapp) return;
    this.editingWappVisibilityId = targetId;
    this.editingWappVisibilityDraft = buildWappVisibilityDraft(wapp);
    this.wappVisibilityError = '';
    this.wappVisibilityNotice = '';
  },

  cancelEditWappVisibility() {
    this.editingWappVisibilityId = null;
    this.editingWappVisibilityDraft = null;
    this.wappVisibilityError = '';
  },

  toggleEditingWappVisibilityDay(day) {
    if (!this.editingWappVisibilityDraft) return;
    const value = Number(day);
    const days = normalizeScheduleDays(this.editingWappVisibilityDraft.days);
    this.editingWappVisibilityDraft.days = days.includes(value)
      ? days.filter((entry) => entry !== value)
      : normalizeScheduleDays([...days, value]);
  },

  async saveEditingWappVisibility() {
    const draft = this.editingWappVisibilityDraft;
    const recordId = normalizeRecordId(draft?.record_id || this.editingWappVisibilityId);
    if (!recordId || !this.session?.npub) return;
    this.wappVisibilityError = '';
    this.wappVisibilityNotice = '';
    this.wappVisibilitySavingId = recordId;
    try {
      const current = await getWappById(recordId);
      if (!current || current.record_state === 'deleted') {
        this.wappVisibilityError = 'WApp record not found.';
        return;
      }
      const nextStatus = draft.status === 'archived' ? 'archived' : 'active';
      const updated = toRaw({
        ...current,
        status: nextStatus,
        schedule: buildWappScheduleFromDraft(draft),
        record_state: nextStatus === 'archived' ? 'archived' : 'active',
        version: (current.version ?? 1) + 1,
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      });
      const writeFields = await getRecordWriteFieldsForStore(this, updated, {
        label: 'WApp visibility write',
      });
      if (!writeFields.write_group_ref) {
        this.wappVisibilityError = 'WApp is missing a writable group.';
        return;
      }
      const envelope = await outboundWapp({
        ...updated,
        record_owner_npub: this.workspaceOwnerNpub || updated.workspace_owner_npub || updated.owner_npub,
        group_ids: writeFields.group_ids,
        previous_version: current.version ?? 1,
        signature_npub: this.signingNpub || this.session?.npub,
        write_group_ref: writeFields.write_group_ref,
      });
      await upsertWapp(updated);
      this.wapps = (this.wapps || []).map((item) => item.record_id === recordId ? updated : item);
      await addPendingWrite({
        record_id: recordId,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.flushAndBackgroundSync?.();
      await this.refreshWapps();
      this.editingWappVisibilityDraft = buildWappVisibilityDraft(updated);
      this.editingWappVisibilityId = null;
      this.wappVisibilityNotice = 'WApp visibility saved.';
    } catch (error) {
      this.wappVisibilityError = error?.message || 'Failed to save WApp visibility.';
    } finally {
      this.wappVisibilitySavingId = null;
    }
  },

  openWapp(wapp) {
    const url = String(wapp?.launch_url || '').trim();
    if (!url || typeof window === 'undefined') return;
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (opened) opened.opener = null;
  },
};
