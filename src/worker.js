const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export default {
  async fetch(request, env) {
    if (!env.DB) return json({ error: "missing_db_binding" }, 500);

    const url = new URL(request.url);
    const key = `${request.method} ${url.pathname}`;

    try {
      switch (key) {
        case "GET /":
          return html(publicPage());
        case "GET /admin":
          return html(adminPage());
        case "GET /health":
          return json({ ok: true, service: "aham-cloudflare", now: new Date().toISOString() });
        case "GET /api/events":
          return listEvents(env);
        case "GET /api/upcoming":
          return listUpcoming(env, url);
        case "POST /api/submit":
          return createPending(request, env);
        case "GET /api/admin/pending":
          return listPending(request, env, url);
        case "POST /api/admin/update":
          return updatePending(request, env);
        case "POST /api/admin/validate":
          return validatePending(request, env);
        case "POST /api/admin/reject":
          return rejectPending(request, env);
        default:
          return json({ error: "not_found" }, 404);
      }
    } catch (error) {
      return json({ error: "internal_error", message: String(error?.message || error) }, 500);
    }
  },
};

async function listEvents(env) {
  const rows = await env.DB.prepare(
    `SELECT id,title,description,start_datetime,end_datetime,location,lat,lng,category
     FROM events_published
     ORDER BY start_datetime ASC`,
  ).all();

  const payload = (rows.results || []).map((row) => ({
    id: Number(row.id),
    title: row.title,
    start: row.start_datetime,
    end: row.end_datetime,
    extendedProps: {
      description: row.description,
      location: row.location,
      category: row.category,
      lat: row.lat,
      lng: row.lng,
    },
  }));
  return json(payload);
}

async function listUpcoming(env, url) {
  const days = clampInt(url.searchParams.get("days"), 8, 1, 90);
  const limit = clampInt(url.searchParams.get("limit"), 4, 1, 50);
  const start = toIsoNoZone(new Date());
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + days);
  const end = toIsoNoZone(endDate);

  const rows = await env.DB.prepare(
    `SELECT id,title,start_datetime,end_datetime,location,category
     FROM events_published
     WHERE start_datetime >= ?1 AND start_datetime < ?2
     ORDER BY start_datetime ASC
     LIMIT ${limit}`,
  )
    .bind(start, end)
    .all();

  return json(rows.results || []);
}

async function createPending(request, env) {
  const body = await readBody(request);
  const input = normalizeEventInput(body);
  if (input.error) return json(input.error, 400);

  const result = await env.DB.prepare(
    `INSERT INTO events_pending
    (title,description,start_datetime,end_datetime,location,lat,lng,category,is_draft,status)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,'pending')`,
  )
    .bind(
      input.value.title,
      input.value.description,
      input.value.start_datetime,
      input.value.end_datetime,
      input.value.location,
      input.value.lat,
      input.value.lng,
      input.value.category,
    )
    .run();

  return json({ ok: true, pending_id: Number(result.meta?.last_row_id || 0) }, 201);
}

async function listPending(request, env, url) {
  const auth = await requireAdmin(request, env, null, url);
  if (!auth.ok) return auth.response;

  const rows = await env.DB.prepare(
    `SELECT id,title,description,start_datetime,end_datetime,location,lat,lng,category,created_at
     FROM events_pending
     WHERE status='pending'
     ORDER BY start_datetime ASC, created_at ASC
     LIMIT 500`,
  ).all();

  return json({ items: rows.results || [] });
}

async function updatePending(request, env) {
  const body = await readBody(request);
  const auth = await requireAdmin(request, env, body, null);
  if (!auth.ok) return auth.response;

  const eventId = Number(body.event_id || body.id);
  if (!Number.isInteger(eventId) || eventId <= 0) return json({ error: "invalid_event_id" }, 400);

  const input = normalizeEventInput(body);
  if (input.error) return json(input.error, 400);

  const result = await env.DB.prepare(
    `UPDATE events_pending
     SET title=?1,description=?2,start_datetime=?3,end_datetime=?4,location=?5,lat=?6,lng=?7,category=?8
     WHERE id=?9 AND status='pending'`,
  )
    .bind(
      input.value.title,
      input.value.description,
      input.value.start_datetime,
      input.value.end_datetime,
      input.value.location,
      input.value.lat,
      input.value.lng,
      input.value.category,
      eventId,
    )
    .run();

  if (Number(result.meta?.changes || 0) === 0) return json({ error: "event_not_pending" }, 409);
  return json({ ok: true, pending_id: eventId });
}

async function validatePending(request, env) {
  const body = await readBody(request);
  const auth = await requireAdmin(request, env, body, null);
  if (!auth.ok) return auth.response;

  const eventId = Number(body.event_id || body.id);
  if (!Number.isInteger(eventId) || eventId <= 0) return json({ error: "invalid_event_id" }, 400);

  const row = await env.DB.prepare(
    `UPDATE events_pending
     SET status='validated'
     WHERE id=?1 AND status='pending'
     RETURNING id,title,description,start_datetime,end_datetime,location,lat,lng,category`,
  )
    .bind(eventId)
    .first();

  if (!row) return json({ error: "event_not_pending" }, 409);

  const result = await env.DB.prepare(
    `INSERT INTO events_published
    (title,description,start_datetime,end_datetime,location,lat,lng,category)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`,
  )
    .bind(row.title, row.description, row.start_datetime, row.end_datetime, row.location, row.lat, row.lng, row.category)
    .run();

  return json({ ok: true, pending_id: eventId, published_id: Number(result.meta?.last_row_id || 0) });
}

async function rejectPending(request, env) {
  const body = await readBody(request);
  const auth = await requireAdmin(request, env, body, null);
  if (!auth.ok) return auth.response;

  const eventId = Number(body.event_id || body.id);
  if (!Number.isInteger(eventId) || eventId <= 0) return json({ error: "invalid_event_id" }, 400);

  const result = await env.DB.prepare(
    `UPDATE events_pending SET status='rejected' WHERE id=?1 AND status='pending'`,
  )
    .bind(eventId)
    .run();

  if (Number(result.meta?.changes || 0) === 0) return json({ error: "event_not_pending" }, 409);
  return json({ ok: true, pending_id: eventId });
}

async function requireAdmin(request, env, body, url) {
  if (!env.ADMIN_TOKEN) return { ok: false, response: json({ error: "admin_token_not_configured" }, 500) };
  const token = getToken(request, body, url);
  if (!token || token !== env.ADMIN_TOKEN) return { ok: false, response: json({ error: "unauthorized" }, 401) };
  return { ok: true };
}

function getToken(request, body, url) {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const head = request.headers.get("x-admin-token");
  if (head) return head.trim();
  if (body?.token) return String(body.token).trim();
  if (body?.admin_token) return String(body.admin_token).trim();
  if (url instanceof URL && url.searchParams.get("token")) return String(url.searchParams.get("token")).trim();
  return "";
}

function normalizeEventInput(body) {
  const title = clean(body.title, 255);
  const description = clean(body.description, 4000, true) || "";
  const location = clean(body.location, 255);
  const category = clean(body.category, 64, true) || "vie_associative";
  const start_datetime = normalizeDate(body.start_datetime || body.start);
  const end_datetime = normalizeDate(body.end_datetime || body.end);
  const lat = parseFloatOrNull(body.lat);
  const lng = parseFloatOrNull(body.lng);

  if (!title || !location || !start_datetime || !end_datetime) {
    return { error: { error: "invalid_input", message: "title, location, start_datetime and end_datetime are required." } };
  }
  if (start_datetime > end_datetime) {
    return { error: { error: "invalid_input", message: "start_datetime must be before end_datetime." } };
  }
  return { value: { title, description, location, category, start_datetime, end_datetime, lat, lng } };
}

async function readBody(request) {
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return await request.json();
    } catch {
      return {};
    }
  }
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const form = await request.formData();
    const out = {};
    for (const [k, v] of form.entries()) out[k] = typeof v === "string" ? v : v.name;
    return out;
  }
  return {};
}

function clean(value, max, allowEmpty = false) {
  if (typeof value !== "string") return allowEmpty ? "" : null;
  const v = value.trim().replace(/\s+/g, " ").slice(0, max);
  if (!v && !allowEmpty) return null;
  return v;
}

function normalizeDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return `${v}:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return toIsoNoZone(d);
}

function toIsoNoZone(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const i = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${i}:${s}`;
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function parseFloatOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...JSON_HEADERS, ...baseHeaders() } });
}

function html(payload, status = 200) {
  return new Response(payload, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...baseHeaders() } });
}

function baseHeaders() {
  return { "x-content-type-options": "nosniff", "referrer-policy": "same-origin" };
}

function publicPage() {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AHAM Cloudflare</title><style>
body{font-family:Segoe UI,Tahoma,sans-serif;margin:0;background:#f4f7fb;color:#182230}main{max-width:960px;margin:20px auto;padding:0 12px;display:grid;gap:12px}
.card{background:#fff;border:1px solid #d7e2ef;border-radius:10px;padding:12px}.top{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
h1,h2{margin:0 0 8px}ul{list-style:none;padding:0;margin:0;display:grid;gap:8px}li{border:1px solid #dbe5f1;border-left:4px solid #0d4f83;border-radius:8px;padding:8px}
form{display:grid;grid-template-columns:1fr 1fr;gap:8px}label{display:grid;gap:4px;font-size:13px}input,textarea,select,button{font:inherit}
input,textarea,select{border:1px solid #bfd0e7;border-radius:7px;padding:7px}textarea{min-height:80px}button{border:none;background:#0d4f83;color:#fff;border-radius:7px;padding:8px;cursor:pointer}
.full{grid-column:1/-1}.status{font-size:13px}.ok{color:#0f7345}.err{color:#8e2d2d}@media (max-width:700px){form{grid-template-columns:1fr}}
</style></head><body><main>
<section class="card top"><div><h1>AHAM calendrier</h1><div>Cloudflare Free Tier - JS vanilla + D1</div></div><a href="/admin">Admin</a></section>
<section class="card"><h2>Publies</h2><div id="events-status" class="status"></div><ul id="events"></ul></section>
<section class="card"><h2>Soumettre (pending)</h2><div id="submit-status" class="status"></div><form id="f">
<label>Titre<input name="title" required maxlength="255"></label><label>Lieu<input name="location" required maxlength="255"></label>
<label>Debut<input type="datetime-local" name="start_datetime" required></label><label>Fin<input type="datetime-local" name="end_datetime" required></label>
<label>Categorie<input name="category" maxlength="64" value="vie_associative"></label><label>Latitude<input type="number" step="0.0000001" name="lat"></label>
<label>Longitude<input type="number" step="0.0000001" name="lng"></label><label class="full">Description<textarea name="description" maxlength="4000"></textarea></label>
<label class="full"><button type="submit">Soumettre</button></label></form></section></main>
<script>
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function show(id,msg,ok){const n=document.getElementById(id);n.textContent=msg||'';n.className='status '+(ok===null?'':ok?'ok':'err');}
function fmt(v){if(!v)return '';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString('fr-FR');}
async function load(){show('events-status','Chargement...',null);try{const r=await fetch('/api/events');const p=await r.json();if(!r.ok)throw new Error(p.error||'error');
const list=document.getElementById('events');if(!p.length){list.innerHTML='<li>Aucun evenement publie.</li>';}else{list.innerHTML=p.map(e=>'<li><b>'+esc(e.title)+'</b><div>'+esc(fmt(e.start))+' -> '+esc(fmt(e.end))+'</div><div>'+esc(e.extendedProps?.location||'')+'</div><div>'+esc(e.extendedProps?.category||'')+'</div></li>').join('');}
show('events-status',p.length+' evenement(s).',true);}catch(e){show('events-status','Erreur: '+e.message,false);}}
document.getElementById('f').addEventListener('submit',async(ev)=>{ev.preventDefault();const body=Object.fromEntries(new FormData(ev.target).entries());show('submit-status','Envoi...',null);
try{const r=await fetch('/api/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const p=await r.json();if(!r.ok)throw new Error(p.message||p.error||'error');
show('submit-status','Cree en pending #'+p.pending_id,true);ev.target.reset();}catch(e){show('submit-status','Erreur: '+e.message,false);}});
load();
</script></body></html>`;
}

function adminPage() {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AHAM Admin</title><style>
body{font-family:Segoe UI,Tahoma,sans-serif;margin:0;background:#eef3fa;color:#182230}main{max-width:1200px;margin:20px auto;padding:0 12px;display:grid;gap:12px}
.card{background:#fff;border:1px solid #d7e2ef;border-radius:10px;padding:12px}.top{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.bar{display:grid;grid-template-columns:1fr auto auto auto;gap:8px}input,textarea,button{font:inherit}input,textarea{border:1px solid #bfd0e7;border-radius:7px;padding:7px}
button{border:none;background:#0d4f83;color:#fff;border-radius:7px;padding:8px;cursor:pointer}.ok{background:#0f7345}.bad{background:#8e2d2d}.mut{background:#60758f}
.status{font-size:13px}.g{color:#0f7345}.r{color:#8e2d2d}.w{overflow:auto;border:1px solid #d8e3f0;border-radius:8px}table{width:100%;border-collapse:collapse;min-width:980px}
th,td{border-bottom:1px solid #e2ebf6;padding:6px;vertical-align:top;font-size:12px}td input,td textarea{width:100%}td textarea{min-height:64px} .act{display:grid;gap:6px}
@media (max-width:840px){.bar{grid-template-columns:1fr 1fr}}
</style></head><body><main>
<section class="card top"><h1>Admin pending</h1><a href="/">Public</a></section>
<section class="card"><div class="bar"><input id="t" placeholder="ADMIN_TOKEN"><button id="save">Sauver</button><button id="clear" class="mut">Effacer</button><button id="reload">Recharger</button></div><div id="s" class="status"></div></section>
<section class="card"><div id="count" class="status"></div><div class="w"><table><thead><tr><th>ID</th><th>Titre</th><th>Description</th><th>Debut</th><th>Fin</th><th>Lieu</th><th>Categorie</th><th>Lat</th><th>Lng</th><th>Actions</th></tr></thead><tbody id="rows"></tbody></table></div></section>
</main><script>
let token=localStorage.getItem('aham_admin_token')||'';const $=id=>document.getElementById(id);$('t').value=token;
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const inp=v=>String(v??'').slice(0,16);function st(msg,mode){$('s').textContent=msg||'';$('s').className='status '+(mode||'');}
async function api(path,opt){const o=Object.assign({},opt||{});o.headers=Object.assign({},o.headers||{},{accept:'application/json'});if(token)o.headers.authorization='Bearer '+token;
const r=await fetch(path,o);const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(p.message||p.error||'error');return p;}
function rowData(tr){return{event_id:Number(tr.dataset.id),title:tr.querySelector('[data-f=title]').value,description:tr.querySelector('[data-f=description]').value,start_datetime:tr.querySelector('[data-f=start_datetime]').value,end_datetime:tr.querySelector('[data-f=end_datetime]').value,location:tr.querySelector('[data-f=location]').value,category:tr.querySelector('[data-f=category]').value,lat:tr.querySelector('[data-f=lat]').value,lng:tr.querySelector('[data-f=lng]').value};}
function render(items){if(!Array.isArray(items)||!items.length){$('rows').innerHTML='<tr><td colspan=\"10\">Aucun pending.</td></tr>';$('count').textContent='0 pending';return;}
$('rows').innerHTML=items.map(i=>'<tr data-id=\"'+esc(i.id)+'\"><td>'+esc(i.id)+'</td><td><input data-f=\"title\" value=\"'+esc(i.title)+'\"></td><td><textarea data-f=\"description\">'+esc(i.description||'')+'</textarea></td><td><input data-f=\"start_datetime\" type=\"datetime-local\" value=\"'+esc(inp(i.start_datetime))+'\"></td><td><input data-f=\"end_datetime\" type=\"datetime-local\" value=\"'+esc(inp(i.end_datetime))+'\"></td><td><input data-f=\"location\" value=\"'+esc(i.location||'')+'\"></td><td><input data-f=\"category\" value=\"'+esc(i.category||'')+'\"></td><td><input data-f=\"lat\" value=\"'+esc(i.lat ?? '')+'\"></td><td><input data-f=\"lng\" value=\"'+esc(i.lng ?? '')+'\"></td><td class=\"act\"><button class=\"ok\" data-a=\"save\">Save</button><button data-a=\"validate\">Valider</button><button class=\"bad\" data-a=\"reject\">Rejeter</button></td></tr>').join('');
$('count').textContent=items.length+' pending';}
async function load(){st('Chargement...');try{const p=await api('/api/admin/pending');render(p.items||[]);st('OK','g');}catch(e){render([]);st('Erreur: '+e.message,'r');}}
$('save').onclick=()=>{token=$('t').value.trim();localStorage.setItem('aham_admin_token',token);st('Token sauvegarde','g');};
$('clear').onclick=()=>{token='';$('t').value='';localStorage.removeItem('aham_admin_token');st('Token efface','');};
$('reload').onclick=()=>{token=$('t').value.trim();load();};
$('rows').onclick=async(ev)=>{const b=ev.target.closest('button[data-a]');if(!b)return;token=$('t').value.trim();if(!token){st('Token requis','r');return;}
const tr=b.closest('tr');const d=rowData(tr);try{if(b.dataset.a==='save'){await api('/api/admin/update',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)});}
if(b.dataset.a==='validate'){await api('/api/admin/validate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event_id:d.event_id})});}
if(b.dataset.a==='reject'){await api('/api/admin/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event_id:d.event_id})});}
await load();}catch(e){st('Erreur: '+e.message,'r');}};
if(token){load();}else{render([]);st('Saisis le token puis recharge','');}
</script></body></html>`;
}
