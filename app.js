const $ = (s) => document.querySelector(s);
const state = { type: '', cat: '', q: '', formType: 'lost', photo: '' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (iso) => {
  const d = Math.floor((Date.now() - new Date(iso)) / 864e5);
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`;
};
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}
async function api(url, opts) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.errors && data.errors.join(', ')) || data.error || 'Something went wrong');
  return data;
}

/* ---------- list ---------- */
async function loadStats() {
  const s = await api('/api/stats');
  $('#stats').innerHTML =
    `<div class="stat"><b>${s.lost}</b><span>items lost</span></div>
     <div class="stat"><b>${s.found}</b><span>items found</span></div>
     <div class="stat"><b>${s.returned}</b><span>returned to owners</span></div>`;
}
async function loadItems() {
  const p = new URLSearchParams();
  if (state.type) p.set('type', state.type);
  if (state.cat) p.set('category', state.cat);
  if (state.q) p.set('q', state.q);
  const items = await api('/api/items?' + p);
  $('#empty').hidden = items.length > 0;
  $('#grid').innerHTML = items.map((i) => `
    <article class="tag ${i.type} ${i.status}" tabindex="0" data-id="${i.id}">
      <div class="pic" style="${i.photo ? `background-image:url('${i.photo}')` : ''}">${i.photo ? '' : 'No photo'}</div>
      <div class="body">
        <span class="badge">${i.status === 'returned' ? 'Returned' : i.type === 'lost' ? 'Lost' : 'Found'}</span>
        <h3>${esc(i.title)}</h3>
        <div class="meta">${esc(i.category)}, ${esc(i.location)}</div>
        <div class="meta">${ago(i.createdAt)}</div>
      </div>
    </article>`).join('');
}
const refresh = () => Promise.all([loadItems(), loadStats()]);

/* ---------- detail ---------- */
async function openItem(id) {
  const items = await api('/api/items');
  const i = items.find((x) => x.id === id);
  if (!i) return;
  const matches = i.status === 'open' ? await api(`/api/items/${id}/matches`) : [];
  $('#viewBody').innerHTML = `
    <span class="badge" style="background:var(--${i.type})">${i.type === 'lost' ? 'Lost' : 'Found'}</span>
    <h2>${esc(i.title)}</h2>
    ${i.photo ? `<img class="view-pic" src="${i.photo}" alt="${esc(i.title)}">` : ''}
    <p>${esc(i.description) || 'No extra details.'}</p>
    <div class="kv"><b>Category:</b> ${esc(i.category)}</div>
    <div class="kv"><b>Place:</b> ${esc(i.location)}, ${ago(i.createdAt)}</div>
    <div class="kv"><b>Contact:</b> ${esc(i.contactName)}, <a href="tel:${esc(i.contactPhone)}">${esc(i.contactPhone)}</a></div>
    ${matches.length ? `<div class="matches"><h4>Possible ${i.type === 'lost' ? 'found' : 'lost'} matches</h4>
      ${matches.map((m) => `<div class="m"><div><b>${esc(m.item.title)}</b><div class="meta">${esc(m.item.location)}, ${esc(m.item.contactName)} ${esc(m.item.contactPhone)}</div></div><span class="meta">${Math.min(99, m.score * 12)}% match</span></div>`).join('')}</div>` : ''}
    <div class="actions" style="margin-top:18px">
      <button class="btn danger small" id="delBtn">Delete</button>
      ${i.status === 'open' ? '<button class="btn primary small" id="resBtn">Mark as returned</button>' : ''}
      <button class="btn small" id="closeView">Close</button>
    </div>`;
  $('#viewDlg').showModal();
  $('#closeView').onclick = () => $('#viewDlg').close();
  const withPin = async (fn, okMsg) => {
    const pin = prompt('Enter the 4-digit PIN you set while posting:');
    if (!pin) return;
    try { await fn(pin); toast(okMsg); $('#viewDlg').close(); refresh(); }
    catch (e) { toast(e.message); }
  };
  $('#delBtn').onclick = () => withPin((pin) => api('/api/items/' + id, { method: 'DELETE', body: JSON.stringify({ pin }) }), 'Post deleted');
  const r = $('#resBtn');
  if (r) r.onclick = () => withPin((pin) => api(`/api/items/${id}/resolve`, { method: 'PATCH', body: JSON.stringify({ pin }) }), 'Marked as returned');
}

/* ---------- form ---------- */
function resizeImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 600, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = img.width * k; c.height = img.height * k;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.7));
    };
    img.src = URL.createObjectURL(file);
  });
}
$('#photo').onchange = async (e) => { state.photo = e.target.files[0] ? await resizeImage(e.target.files[0]) : ''; };
$('#openForm').onclick = () => $('#formDlg').showModal();
$('#cancelForm').onclick = () => $('#formDlg').close();
$('#formType').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.formType = b.dataset.type;
  [...$('#formType').children].forEach((x) => x.classList.toggle('on', x === b));
};
$('#form').onsubmit = async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  delete body.undefined;
  body.type = state.formType; body.photo = state.photo;
  try {
    await api('/api/items', { method: 'POST', body: JSON.stringify(body) });
    e.target.reset(); state.photo = ''; $('#formErr').textContent = '';
    $('#formDlg').close(); toast('Posted. Check matches by opening your item.'); refresh();
  } catch (err) { $('#formErr').textContent = err.message; }
};

/* ---------- filters ---------- */
$('#typeSeg').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.type = b.dataset.type;
  [...$('#typeSeg').children].forEach((x) => x.classList.toggle('on', x === b));
  loadItems();
};
$('#cat').onchange = (e) => { state.cat = e.target.value; loadItems(); };
let timer;
$('#q').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value; loadItems(); }, 250); };
$('#grid').onclick = (e) => { const a = e.target.closest('.tag'); if (a) openItem(a.dataset.id); };
$('#grid').onkeydown = (e) => { if (e.key === 'Enter') { const a = e.target.closest('.tag'); if (a) openItem(a.dataset.id); } };

(async function init() {
  const cats = await api('/api/categories');
  $('#cat').insertAdjacentHTML('beforeend', cats.map((c) => `<option>${c}</option>`).join(''));
  $('#formCat').innerHTML = cats.map((c) => `<option>${c}</option>`).join('');
  refresh();
})();
