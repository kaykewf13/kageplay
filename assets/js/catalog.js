/* ============================================================
   KAGEPLAY — assets/js/catalog.js
   Home: catalogo + busca + filtros + (v2) favoritos,
   continuar assistindo e episodios vistos.
   ============================================================ */

const KP = {
  catalog: null,
  categories: null,
  policy: null,
  state: { query: "", cat: "todos", soFavoritos: false }
};

function epElegivel(ep) {
  return ep.gratuito_autorizado === "Sim"
      && ep.drm_paywall === "Nao"
      && ep.publicar === "Sim";
}
function animePublicavel(a) { return a.publicar === "Sim"; }

async function loadData() {
  const [cat, cats, pol] = await Promise.all([
    fetch("./data/catalog.json").then(r => r.json()),
    fetch("./data/categories.json").then(r => r.json()),
    fetch("./data/playback-policy.json").then(r => r.json())
  ]);
  KP.catalog = cat; KP.categories = cats; KP.policy = pol;
}

function animeById(id) {
  return KP.catalog.animes.find(a => a.anime_id === id);
}

/* ---------- Card ---------- */
function cardHTML(a) {
  const ep1 = a.episodios?.[0];
  const elegivel = ep1 && epElegivel(ep1);
  const externo = ep1?.tipo_player === "externo";
  const tags = [a.categoria_principal, ...(a.categorias_secundarias || [])].slice(0, 3).join(" • ");

  let badge = "";
  if (a.adulto_18) badge = `<span class="badge adult">18+</span>`;
  else if (externo) badge = `<span class="badge ext">Fonte oficial</span>`;
  else badge = `<span class="badge">${a.status}</span>`;

  const playUrl = `./player.html?anime=${encodeURIComponent(a.anime_id)}&ep=${ep1?.episodio_num || 1}`;
  const playLabel = externo ? "Abrir fonte" : "Assistir";

  // v2: estado pessoal
  const fav = KPStore.isFavorito(a.anime_id);
  const prog = ep1 ? KPStore.getProgresso(a.anime_id, ep1.episodio_num) : null;
  const vistosCount = KPStore.vistosDoAnime(a.anime_id);
  const totalEps = a.episodios?.length || 0;

  const progBar = (prog && prog.pct > 0.02 && prog.pct < 0.95)
    ? `<div class="cardprog"><span style="width:${Math.round(prog.pct*100)}%"></span></div>` : "";
  const vistoTag = vistosCount > 0
    ? `<span class="seen-tag" title="${vistosCount} de ${totalEps} vistos">✓ ${vistosCount}/${totalEps}</span>` : "";

  return `
    <article class="card" data-id="${a.anime_id}">
      <div class="thumb">
        ${badge}
        <button class="fav ${fav ? 'on' : ''}" data-fav="${a.anime_id}"
                title="${fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}"
                aria-label="favorito">${fav ? '★' : '☆'}</button>
        <img src="${a.capa_url}" alt="${a.titulo}" loading="lazy"
             onerror="this.src='https://placehold.co/480x720/16161f/9a9aae?text=KagePlay'">
        ${progBar}
      </div>
      <div class="body">
        <h3>${a.titulo}</h3>
        <div class="tags">${tags}</div>
        <div class="meta">
          <span class="dot" style="background:${elegivel ? 'var(--ok)' : 'var(--warn)'}"></span>
          ${a.fonte_principal} ${vistoTag}
        </div>
        <a class="play" href="${playUrl}">${playLabel}</a>
      </div>
    </article>`;
}

/* ---------- Filtros ---------- */
function applyFilters(list) {
  const q = KP.state.query.toLowerCase().trim();
  const cat = KP.state.cat;
  return list.filter(a => {
    if (!animePublicavel(a)) return false;
    if (a.adulto_18) return false;
    if (KP.state.soFavoritos && !KPStore.isFavorito(a.anime_id)) return false;
    if (cat !== "todos") {
      const all = [a.categoria_principal, ...(a.categorias_secundarias || [])].map(c => c.toLowerCase());
      if (!all.includes(cat.toLowerCase())) return false;
    }
    if (q) {
      const hay = (a.titulo + " " + a.descricao + " " + a.categoria_principal).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderGrid() {
  const grid = document.getElementById("grid");
  const list = applyFilters(KP.catalog.animes);
  if (!list.length) {
    const msg = KP.state.soFavoritos
      ? "Voce ainda nao favoritou nenhum titulo. Toque na estrela ☆ de um card."
      : "Nenhum titulo encontrado com esses filtros.";
    grid.innerHTML = `<div class="empty">${msg}</div>`;
    return;
  }
  grid.innerHTML = list.map(cardHTML).join("");
}

/* ---------- Secao: Continuar assistindo ---------- */
function renderContinuar() {
  const wrap = document.getElementById("continuar");
  if (!wrap) return;
  const itens = KPStore.continuarAssistindo()
    .map(p => ({ p, a: animeById(p.anime) }))
    .filter(x => x.a && !x.a.adulto_18 && !KPStore.isVisto(x.p.anime, x.p.ep))
    .slice(0, 12);

  if (!itens.length) { wrap.innerHTML = ""; wrap.style.display = "none"; return; }
  wrap.style.display = "";

  const cards = itens.map(({ p, a }) => {
    const pct = Math.round(p.pct * 100);
    const href = `./player.html?anime=${encodeURIComponent(a.anime_id)}&ep=${p.ep}`;
    return `
      <a class="rcard" href="${href}">
        <div class="rthumb">
          <img src="${a.capa_url}" alt="${a.titulo}" loading="lazy"
               onerror="this.src='https://placehold.co/300x170/16161f/9a9aae?text=KagePlay'">
          <div class="cardprog"><span style="width:${pct}%"></span></div>
          <span class="rplay">▶</span>
        </div>
        <div class="rmeta"><b>${a.titulo}</b><span>Ep. ${p.ep} • ${pct}%</span></div>
      </a>`;
  }).join("");

  wrap.innerHTML = `
    <div class="sec-head"><h2>Continuar assistindo</h2>
      <button class="linkbtn" id="limpar-continuar">limpar</button></div>
    <div class="rrow">${cards}</div>`;

  const btn = document.getElementById("limpar-continuar");
  if (btn) btn.onclick = () => {
    itens.forEach(({ p }) => KPStore.limparProgresso(p.anime, p.ep));
    renderContinuar();
  };
}

/* ---------- Chips ---------- */
function renderChips() {
  const box = document.getElementById("chips");
  const menuCats = KP.categories.categorias
    .filter(c => c.mostrar_menu && c.grupo === "Genero")
    .map(c => c.categoria);
  const all = ["todos", ...menuCats];
  box.innerHTML =
    `<button class="chip fav-chip" data-fav-filter="1">★ Favoritos</button>` +
    all.map(c =>
      `<button class="chip ${c === 'todos' ? 'active' : ''}" data-cat="${c}">${c === 'todos' ? 'Todos' : c}</button>`
    ).join("");

  box.querySelectorAll(".chip[data-cat]").forEach(ch => {
    ch.addEventListener("click", () => {
      KP.state.soFavoritos = false;
      box.querySelectorAll(".chip").forEach(x => x.classList.remove("active"));
      ch.classList.add("active");
      KP.state.cat = ch.dataset.cat;
      renderGrid();
    });
  });
  const favChip = box.querySelector(".fav-chip");
  favChip.addEventListener("click", () => {
    KP.state.soFavoritos = !KP.state.soFavoritos;
    box.querySelectorAll(".chip").forEach(x => x.classList.remove("active"));
    if (KP.state.soFavoritos) { favChip.classList.add("active"); KP.state.cat = "todos"; }
    else { box.querySelector('[data-cat="todos"]').classList.add("active"); }
    renderGrid();
  });
}

function bindSearch() {
  const input = document.getElementById("search");
  if (!input) return;
  input.addEventListener("input", e => { KP.state.query = e.target.value; renderGrid(); });
}

/* clique no coracao (event delegation, pois o grid e re-renderizado) */
function bindFavClicks() {
  const grid = document.getElementById("grid");
  grid.addEventListener("click", e => {
    const btn = e.target.closest("[data-fav]");
    if (!btn) return;
    e.preventDefault();
    const on = KPStore.toggleFavorito(btn.dataset.fav);
    btn.classList.toggle("on", on);
    btn.textContent = on ? "★" : "☆";
    // se estiver no filtro de favoritos, re-renderiza para sumir o card removido
    if (KP.state.soFavoritos) renderGrid();
  });
}

async function initHome() {
  try {
    await loadData();
    renderChips();
    bindSearch();
    bindFavClicks();
    renderContinuar();
    renderGrid();
    const total = KP.catalog.animes.filter(animePublicavel).filter(a => !a.adulto_18).length;
    const counter = document.getElementById("counter");
    if (counter) counter.textContent = `${total} titulos publicados`;
  } catch (err) {
    document.getElementById("grid").innerHTML =
      `<div class="empty">Erro ao carregar o catalogo.<br><small>${err.message}</small></div>`;
  }
}

if (document.getElementById("grid")) initHome();
