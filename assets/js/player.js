/* ============================================================
   KAGEPLAY — assets/js/player.js
   Motor do player: le catalog.json, valida regras (secao 6 do TXT)
   e reproduz internamente quando permitido.
   ============================================================ */

const PL = { catalog: null, policy: null, anime: null, ep: null };

function elegivel(ep) {
  return ep.gratuito_autorizado === "Sim"
      && ep.drm_paywall === "Nao"
      && ep.publicar === "Sim";
}

function getParams() {
  const p = new URLSearchParams(location.search);
  return { anime: p.get("anime"), ep: parseInt(p.get("ep") || "1", 10) };
}

function showState(id) {
  document.querySelectorAll(".state").forEach(s => s.classList.remove("show"));
  if (id) document.getElementById(id).classList.add("show");
}

/* --- Renderizacao do video conforme tipo_player --- */
function renderMedia(ep) {
  const mount = document.getElementById("media-mount");
  mount.innerHTML = "";
  const tipo = ep.tipo_player;

  if (tipo === "mp4" || tipo === "webm") {
    const v = document.createElement("video");
    v.controls = true; v.autoplay = false; v.playsInline = true;
    v.src = ep.url_video;
    mount.appendChild(v);
    attachTracking(v, ep);

  } else if (tipo === "hls") {
    const v = document.createElement("video");
    v.controls = true; v.playsInline = true;
    mount.appendChild(v);
    attachTracking(v, ep);
    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = ep.url_video;                       // Safari nativo
    } else if (window.Hls && window.Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(ep.url_video);
      hls.attachMedia(v);
    } else {
      return fallbackExterno(ep, "Seu navegador nao suporta HLS.");
    }

  } else if (tipo === "youtube" || tipo === "vimeo" || tipo === "archive") {
    const f = document.createElement("iframe");
    f.src = ep.url_video;
    f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    f.allowFullscreen = true;
    mount.appendChild(f);

  } else { // externo ou desconhecido
    return fallbackExterno(ep);
  }
}

/* --- v2: rastrear progresso de video nativo (mp4/webm/hls) --- */
function attachTracking(v, ep) {
  const aId = PL.anime.anime_id, n = ep.episodio_num;

  // retomar de onde parou
  const prog = KPStore.getProgresso(aId, n);
  if (prog && prog.t > 5 && prog.pct < 0.95) {
    const resume = () => {
      try { v.currentTime = prog.t; } catch (e) {}
      v.removeEventListener("loadedmetadata", resume);
    };
    v.addEventListener("loadedmetadata", resume);
  }

  // salvar progresso a cada ~5s
  let last = 0;
  v.addEventListener("timeupdate", () => {
    if (!v.duration) return;
    if (v.currentTime - last >= 5 || v.currentTime < last) {
      last = v.currentTime;
      KPStore.setProgresso(aId, n, v.currentTime, v.duration);
      atualizaBotaoVisto();
    }
  });

  // marcar visto automaticamente ao chegar perto do fim
  v.addEventListener("timeupdate", () => {
    if (v.duration && v.currentTime / v.duration >= 0.9 && !KPStore.isVisto(aId, n)) {
      KPStore.marcarVisto(aId, n, true);
      KPStore.limparProgresso(aId, n);
      atualizaBotaoVisto();
      renderEplist();
    }
  });
  v.addEventListener("ended", () => {
    KPStore.marcarVisto(aId, n, true);
    KPStore.limparProgresso(aId, n);
    atualizaBotaoVisto();
    renderEplist();
  });
}

function fallbackExterno(ep, motivo) {
  document.getElementById("ext-url").href = ep.url_video;
  document.getElementById("ext-motivo").textContent =
    motivo || "Esta fonte nao permite reproducao dentro do site. Use o botao abaixo para abrir a fonte oficial/autorizada.";
  showState("state-externo");
}

/* --- Preenche painel de informacoes + lista de episodios --- */
function renderInfo() {
  const a = PL.anime, ep = PL.ep;
  document.getElementById("ep-title").textContent =
    `${a.titulo} — Ep. ${ep.episodio_num}`;
  document.getElementById("ep-sub").textContent = ep.titulo_episodio || "";
  document.getElementById("ep-desc").textContent = a.descricao || "";

  const pills = [];
  pills.push(`<span class="pill">${ep.tipo_player.toUpperCase()}</span>`);
  pills.push(`<span class="pill">${a.fonte_principal}</span>`);
  pills.push(`<span class="pill ok">gratuito/autorizado</span>`);
  if (ep.status_link !== "Ativo")
    pills.push(`<span class="pill warn">link: ${ep.status_link} (alerta operacional)</span>`);
  if (a.adulto_18) pills.push(`<span class="pill" style="color:var(--magenta)">18+</span>`);
  document.getElementById("ep-pills").innerHTML = pills.join("");

  renderAcoes();
  renderEplist();
}

/* v2: botoes de favorito + marcar visto */
function renderAcoes() {
  const a = PL.anime, ep = PL.ep;
  let bar = document.getElementById("ep-acoes");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "ep-acoes"; bar.className = "ep-acoes";
    document.getElementById("ep-pills").insertAdjacentElement("afterend", bar);
  }
  const fav = KPStore.isFavorito(a.anime_id);
  bar.innerHTML = `
    <button class="abtn ${fav ? 'on' : ''}" id="btn-fav">${fav ? '★ Favoritado' : '☆ Favoritar'}</button>
    <button class="abtn" id="btn-visto"></button>`;
  document.getElementById("btn-fav").onclick = () => {
    const on = KPStore.toggleFavorito(a.anime_id);
    const b = document.getElementById("btn-fav");
    b.classList.toggle("on", on); b.textContent = on ? "★ Favoritado" : "☆ Favoritar";
  };
  document.getElementById("btn-visto").onclick = () => {
    const novo = !KPStore.isVisto(a.anime_id, ep.episodio_num);
    KPStore.marcarVisto(a.anime_id, ep.episodio_num, novo);
    if (!novo) KPStore.limparProgresso(a.anime_id, ep.episodio_num);
    atualizaBotaoVisto(); renderEplist();
  };
  atualizaBotaoVisto();
}

function atualizaBotaoVisto() {
  const b = document.getElementById("btn-visto");
  if (!b) return;
  const visto = KPStore.isVisto(PL.anime.anime_id, PL.ep.episodio_num);
  b.classList.toggle("on", visto);
  b.textContent = visto ? "✓ Visto" : "Marcar como visto";
}

function renderEplist() {
  const a = PL.anime, ep = PL.ep;
  const box = document.getElementById("eplist");
  box.innerHTML = `<h3>Episodios</h3>` + a.episodios.map(e => {
    const el = elegivel(e);
    const cur = e.episodio_num === ep.episodio_num ? "current" : "";
    const visto = KPStore.isVisto(a.anime_id, e.episodio_num);
    const href = `./player.html?anime=${a.anime_id}&ep=${e.episodio_num}`;
    return `<a class="ep ${cur} ${visto ? 'seen' : ''}" href="${href}">
        <span class="n">${e.episodio_num}</span>
        <span class="t">${e.titulo_episodio || 'Episodio ' + e.episodio_num}</span>
        <span class="st">${visto ? '✓' : (el ? '▶' : '⛔')}</span>
      </a>`;
  }).join("");
}

/* --- Confirmacao 18+ --- */
function gate18(onConfirm) {
  // sessao: ja confirmou antes?
  if (sessionStorage.getItem("kp_age_ok") === "1") return onConfirm();
  showState("state-age");
  document.getElementById("age-yes").onclick = () => {
    sessionStorage.setItem("kp_age_ok", "1");
    showState(null);
    onConfirm();
  };
  document.getElementById("age-no").onclick = () => { location.href = "./index.html"; };
}

/* --- Fluxo principal (segue a ordem da secao 6) --- */
async function start() {
  const { anime, ep } = getParams();
  if (!anime) return fatal("Nenhum anime informado na URL.");

  const [cat, pol] = await Promise.all([
    fetch("./data/catalog.json").then(r => r.json()),
    fetch("./data/playback-policy.json").then(r => r.json())
  ]);
  PL.catalog = cat; PL.policy = pol;

  // 2. buscar anime
  PL.anime = cat.animes.find(a => a.anime_id === anime);
  if (!PL.anime) return fatal("Anime nao encontrado no catalogo.");

  // 3. buscar episodio
  PL.ep = PL.anime.episodios.find(e => e.episodio_num === ep);
  if (!PL.ep) return fatal("Episodio nao encontrado.");

  renderInfo();

  // 4-6. regras de elegibilidade
  if (!elegivel(PL.ep)) {
    return blockReproducao(PL.ep);
  }

  // 7-8. conteudo adulto -> confirmacao de idade
  const play = () => {
    showState(null);
    if (PL.ep.tipo_player === "externo") fallbackExterno(PL.ep);
    else renderMedia(PL.ep);
  };

  if (PL.anime.adulto_18 || PL.ep.adulto_18) {
    gate18(play);
  } else {
    play();
  }
}

function blockReproducao(ep) {
  const motivos = [];
  if (ep.gratuito_autorizado !== "Sim") motivos.push("fonte nao e gratuita/autorizada");
  if (ep.drm_paywall !== "Nao") motivos.push("conteudo com DRM ou paywall");
  if (ep.publicar !== "Sim") motivos.push("episodio nao publicado");
  document.getElementById("block-motivo").textContent =
    "Motivo: " + (motivos.join("; ") || "nao elegivel") + ".";
  showState("state-block");
}

function fatal(msg) {
  document.getElementById("fatal-msg").textContent = msg;
  showState("state-fatal");
}

start().catch(err => fatal("Erro ao iniciar o player: " + err.message));
