// Measures a full register import (upload, validate, commit) against the running dev API.
// Usage: node scripts/perf-import.mjs [rows] [companySlug]
// Uses the seeded group admin account. Writes fictitious data into the given company.
const BASE = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3100';
const rows = Number(process.argv[2] ?? 50000);
const slug = process.argv[3] ?? 'meghna-logistics';

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: ORIGIN },
  body: JSON.stringify({ email: 'group.admin@meghna.example', password: process.env.SEED_DEFAULT_PASSWORD ?? 'Agm!Dev2026' }),
});
if (!login.ok) throw new Error(`login failed ${login.status}`);
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const { csrfToken } = await login.json();
const h = { cookie, 'x-csrf-token': csrfToken, origin: ORIGIN };

const companies = await (await fetch(`${BASE}/companies?pageSize=100`, { headers: h })).json();
const company = companies.items.find((c) => c.slug === slug);
if (!company) throw new Error(`company ${slug} not found`);

const lines = ['BO ID,Name,Type,Shares,Mobile'];
for (let i = 0; i < rows; i++) {
  const bo = `12019588${String(i).padStart(8, '0')}`;
  lines.push(`${bo},Perf Holder ${i},${i % 50 === 0 ? 'corporate' : 'individual'},${100 + (i % 9000)},017${String(10000000 + i).slice(-8)}`);
}
const csv = Buffer.from(lines.join('\n'));

const t0 = performance.now();
const form = new FormData();
form.append('file', new Blob([csv], { type: 'text/csv' }), 'perf.csv');
const up = await fetch(`${BASE}/companies/${company.id}/imports`, { method: 'POST', headers: h, body: form });
if (!up.ok) throw new Error(`upload ${up.status} ${await up.text()}`);
const imp = await up.json();
const t1 = performance.now();

const val = await fetch(`${BASE}/companies/${company.id}/imports/${imp.id}/validate`, {
  method: 'POST',
  headers: { ...h, 'content-type': 'application/json' },
  body: JSON.stringify({ mapping: { boId: 'BO ID', name: 'Name', holderType: 'Type', shares: 'Shares', phone: 'Mobile' }, mode: 'FULL', asOfDate: '2026-10-31' }),
});
if (!val.ok) throw new Error(`validate ${val.status} ${await val.text()}`);
const v = await val.json();
const t2 = performance.now();

const com = await fetch(`${BASE}/companies/${company.id}/imports/${imp.id}/commit`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{}' });
if (!com.ok) throw new Error(`commit ${com.status} ${await com.text()}`);
const t3 = performance.now();

const s = (a, b) => ((b - a) / 1000).toFixed(1) + 's';
console.log(JSON.stringify({ rows, summary: v.summary, errors: v.errorRows, upload: s(t0, t1), validatePreview: s(t1, t2), commit: s(t2, t3), total: s(t0, t3) }));
