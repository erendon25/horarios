import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dir = resolve('migration/transformed');
const read = async (name) => JSON.parse(await readFile(resolve(dir, `${name}.json`), 'utf8'));
const report = await read('transformation-report');
const [stores, authUsers, staff, users, schedules, shifts, holidays, cessations, requests] = await Promise.all([
  read('stores'), read('auth_users'), read('staff_profiles'), read('user_profiles'), read('schedule_weeks'),
  read('schedule_shifts'), read('worked_holidays'), read('cessations'), read('schedule_requests'),
]);

const ids = (rows) => new Set(rows.map((row) => row.id));
const storeIds = ids(stores);
const authIds = ids(authUsers);
const staffIds = ids(staff);
const scheduleKeys = new Set(schedules.map((row) => row.migration_key));
const issues = [];
const check = (condition, code, count) => { if (!condition) issues.push({ code, count }); };

check(stores.every((row) => row.id && row.name), 'INVALID_STORES', stores.filter((row) => !row.id || !row.name).length);
check(authUsers.every((row) => row.id && row.email), 'INVALID_AUTH_USERS', authUsers.filter((row) => !row.id || !row.email).length);
check(new Set(authUsers.map((row) => row.email.trim().toLowerCase())).size === authUsers.length, 'DUPLICATE_AUTH_EMAILS', authUsers.length - new Set(authUsers.map((row) => row.email.trim().toLowerCase())).size);
check(authIds.size === authUsers.length, 'DUPLICATE_AUTH_IDS', authUsers.length - authIds.size);
check(staff.every((row) => row.id && row.store_id && row.first_name && row.last_name !== null), 'INVALID_STAFF', staff.filter((row) => !row.id || !row.store_id || !row.first_name || row.last_name === null).length);
check(staff.every((row) => storeIds.has(row.store_id)), 'STAFF_UNKNOWN_STORE', staff.filter((row) => !storeIds.has(row.store_id)).length);
check(staff.every((row) => !row.user_id || authIds.has(row.user_id)), 'STAFF_UNKNOWN_USER', staff.filter((row) => row.user_id && !authIds.has(row.user_id)).length);
check(new Set(staff.map((row) => row.user_id).filter(Boolean)).size === staff.filter((row) => row.user_id).length, 'DUPLICATE_STAFF_USER', staff.filter((row) => row.user_id).length - new Set(staff.map((row) => row.user_id).filter(Boolean)).size);
check(users.every((row) => authIds.has(row.id)), 'PROFILE_UNKNOWN_AUTH', users.filter((row) => !authIds.has(row.id)).length);
check(users.every((row) => !row.staff_profile_id || staffIds.has(row.staff_profile_id)), 'PROFILE_UNKNOWN_STAFF', users.filter((row) => row.staff_profile_id && !staffIds.has(row.staff_profile_id)).length);
check(schedules.every((row) => staffIds.has(row.staff_id) && storeIds.has(row.store_id) && row.week_start), 'INVALID_SCHEDULE_WEEKS', schedules.filter((row) => !staffIds.has(row.staff_id) || !storeIds.has(row.store_id) || !row.week_start).length);
check(shifts.every((row) => scheduleKeys.has(row.schedule_week_key)), 'SHIFT_UNKNOWN_WEEK', shifts.filter((row) => !scheduleKeys.has(row.schedule_week_key)).length);
check(holidays.every((row) => staffIds.has(row.staff_id) && storeIds.has(row.store_id) && row.holiday_date), 'INVALID_HOLIDAYS', holidays.filter((row) => !staffIds.has(row.staff_id) || !storeIds.has(row.store_id) || !row.holiday_date).length);
check(cessations.every((row) => staffIds.has(row.staff_id) && storeIds.has(row.store_id) && row.cessation_date), 'INVALID_CESSATIONS', cessations.filter((row) => !staffIds.has(row.staff_id) || !storeIds.has(row.store_id) || !row.cessation_date).length);
check(requests.every((row) => staffIds.has(row.staff_id) && authIds.has(row.user_id) && storeIds.has(row.store_id) && row.requested_date), 'INVALID_REQUESTS', requests.filter((row) => !staffIds.has(row.staff_id) || !authIds.has(row.user_id) || !storeIds.has(row.store_id) || !row.requested_date).length);

const quarantineSummary = {};
for (const item of report.quarantined) {
  const key = `${item.collection}:${item.reason}`;
  quarantineSummary[key] = (quarantineSummary[key] ?? 0) + 1;
}

const result = {
  valid: issues.length === 0,
  issues,
  counts: report.counts,
  quarantine_summary: quarantineSummary,
  superadmins: users.filter((row) => row.role === 'superadmin').length,
  auth_users_with_password_hash: authUsers.filter((row) => row.password_hash).length,
};
console.log(JSON.stringify(result));
if (issues.length) process.exitCode = 1;
