/* ============================================================
   KAGEPLAY — assets/js/player.js
   Motor do player: catalog.json + regras + player interno/sala externa
   com failover automático para links SUGOIAPI.
   ============================================================ */

const PL = { catalog: null, policy: null, anime: null, ep: null };

const TIPOS_VIDEO_NATIVO = new Set(["mp4", "webm", "hls"]);
const TIPOS_IFRAME_OFICIAL = new Set(["youtube", "vimeo", "archive"]);
const TIPOS_SALA_EXTERNA = new Set(["externo", "iframe", "embed", "site", "fonte", "fonte_externa", "externo_embed", "iframe_tentativa"]);
const MODOS_SALA_EXTERNA = new Set(["externo", "embed", "iframe", "iframe_tentativa", "sala_externa", "assistir_na_fonte", "player_only"]);

function norm(v) { return (v || "").toString().trim().toLowerCase(); }

function elegivel(ep) {
  return ep.gratuito_autorizado === "Sim" && ep.drm_paywall === "Nao" && ep.publicar === "Sim";
}

function getParams() {
  const p = new URLSearchParams(location.search);
  return { anime: p.get("anime"), ep: parseInt(p.get("ep") || "1", 10) };
}

function showState(id) {
  document.querySelectorAll(".state").forEach(s => s.classList.remove("show"));
  if (id) document.getElementById(id)?.classList.add("show");
}

function urlSegura(url) {
  try {
    const u = new URL(url, location.href);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch (e) { return ""; }
}

function urlPlayer(ep) {
  return urlSegura(ep.player_url || ep.embed_url || ep.url_player || ep.url_video || ep.fonte_url || "");
}

function urlFonte(ep) {
  return urlSegura(ep.fonte_original || ep.url_fonte_original || ep.fonte_url || ep.url_video || ep.player_url || "");
}

function failoverUrls(ep) {
  const raw = Array.isArray(ep.failover_urls) ? ep.failover_urls : [];
  return raw.map(urlSegura).filter(Boolean);
}

function mediaUrls(ep) {
  const urls = [urlPlayer(ep), ...failoverUrls(ep)].filter(Boolean);
  return [...new Set(urls)];
}

function usaSalaExterna(ep) {
  const tipo = norm(ep.tipo_player);
  const modo = norm(ep.modo_reproducao);
  return TIPOS_SALA_EXTERNA.has(tipo) || MODOS_SALA_EXTERNA.has(modo);
}

function usaPlayerOnly(ep) {
  return norm(ep.modo_visual) === "player_only" || norm(ep.player_view) === "player_only" || norm(ep.modo_reproducao) === "player_only";
}

function labelTipo(ep) {
  if (usaPlayerOnly(ep)) return "PLAYER EXTERNO";
  if (usaSalaExterna(ep)) return "SALA EXTERNA";
  return (ep.tipo_player || "externo").toUpperCase();
}

function perfilFonteExterna(src) {
  try {
    const host = new URL(src).hostname.replace(/^www\./, "");
    const mobile = window.innerWidth < 720;
    if (host.includes("animesonlineclub.net")) {
      return {
        nome: "AnimesOnlineClub",
        recorte: true,
        iframeStyle: mobile
          ? "width:180%;height:180%;border:0;display:block;transform:translate(-4%,-20%);transform-origin:top left;"
          : "width:145%;height:145%;border:0;display:block;transform:translate(-2.8%,-22.5%);transform-origin:top left;"
      };
    }
  } catch (e) {}
  return { nome: "Fonte externa", recorte: false, iframeStyle: "width:100%;height:100%;border:0;display:block;" };
}

function inferTipoByUrl(url, fallbackTipo) {
  const u = norm(url);
  if (u.includes(".m3u8") || u.includes("/playlist.m3u8") || u.includes("/manifest")) return "hls";
  if (u.includes(".webm")) return "webm";
  if (u.includes(".mp4") || u.includes("/stream") || u.includes("api.put.io")) return "mp4";
  return fallbackTipo;
}

function renderMedia(ep) {
  const mount = document.getElementById("media-mount");
  mount.innerHTML = "";
  mount.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";

  const tipo = norm(ep.tipo_player);
  const primary = urlPlayer(ep);

  if (TIPOS_VIDEO_NATIVO.has(tipo) || ["mp4", "webm", "hls"].includes(inferTipoByUrl(primary, tipo))) {
    const urls = mediaUrls(ep);
    if (!urls.length) return fallbackExterno(ep, "URL de vídeo inválida ou ausente.");
    return renderVideoNativo(ep, urls, 0);
  }

  if (TIPOS_IFRAME_OFICIAL.has(tipo)) return renderIframeOficial(ep);
  if (usaSalaExterna(ep)) return renderSalaExterna(ep);
  return fallbackExterno(ep);
}

function showPlayerNotice(msg) {
  let box = document.getElementById("player-notice");
  if (!box) {
    box = document.createElement("div");
    box.id = "player-notice";
    box.style.cssText = "position:absolute;left:14px;right:14px;bottom:14px;z-index:8;padding:10px 12px;border-radius:14px;background:rgba(12,12,20,.82);border:1px solid rgba(255,255,255,.14);color:#fff;font-size:.82rem;backdrop-filter:blur(10px);";
    document.getElementById("media-mount").appendChild(box);
  }
  box.textContent = msg;
  clearTimeout(box._t);
  box._t = setTimeout(() => box.remove(), 4500);
}

function renderVideoNativo(ep, urls, index) {
  const mount = document.getElementById("media-mount");
  mount.innerHTML = "";

  const src = urls[index];
  const tipo = inferTipoByUrl(src, norm(ep.tipo_player));
  const v = document.createElement("video");
  v.controls = true;
  v.autoplay = false;
  v.playsInline = true;
  v.preload = "metadata";
  v.style.cssText = "width:100%;height:100%;display:block;background:#000;";
  mount.appendChild(v);
  attachTracking(v, ep);

  const tryNext = () => {
    if (index + 1 < urls.length) {
      showPlayerNotice(`Link principal falhou. Tentando fonte alternativa ${index + 2}/${urls.length}...`);
      return renderVideoNativo(ep, urls, index + 1);
    }
    return fallbackExterno(ep, "Nenhum link de vídeo disponível conseguiu iniciar neste navegador.");
  };

  v.addEventListener("error", tryNext, { once: true });
  v.addEventListener("stalled", () => showPlayerNotice("Conexão lenta ou fonte instável. O player tentará continuar."), { once: true });

  if (tipo === "hls") {
    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = src;
    } else if (window.Hls && window.Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hls.loadSource(src);
      hls.attachMedia(v);
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data?.fatal) {
          try { hls.destroy(); } catch (e) {}
          tryNext();
        }
      });
    } else {
      tryNext();
    }
  } else {
    v.src = src;
  }
}

function renderIframeOficial(ep) {
  const mount = document.getElementById("media-mount");
  const src = urlPlayer(ep);
  if (!src) return fallbackExterno(ep, "URL de incorporação inválida ou ausente.");
  const f = document.createElement("iframe");
  f.src = src;
  f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen";
  f.allowFullscreen = true;
  f.loading = "lazy";
  f.referrerPolicy = "no-referrer";
  mount.appendChild(f);
}

function renderSalaExterna(ep) {
  const mount = document.getElementById("media-mount");
  const src = urlPlayer(ep);
  const original = urlFonte(ep) || src;
  if (!src) return fallbackExterno(ep, "URL da fonte inválida ou ausente.");

  const playerOnly = usaPlayerOnly(ep);
  const perfil = perfilFonteExterna(src);

  const room = document.createElement("div");
  room.className = playerOnly ? "source-room player-only-room" : "source-room";
  room.style.cssText = "position:relative;width:100%;height:100%;background:#050508;overflow:hidden;";

  const f = document.createElement("iframe");
  f.className = "source-frame";
  f.src = src;
  f.loading = "lazy";
  f.referrerPolicy = "no-referrer";
  f.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
  f.allowFullscreen = true;
  f.sandbox = "allow-scripts allow-same-origin allow-forms allow-popups allow-presentation";
  f.style.cssText = playerOnly && perfil.recorte ? perfil.iframeStyle : "width:100%;height:100%;border:0;display:block;";
  room.appendChild(f);

  if (playerOnly) {
    const mini = document.createElement("a");
    mini.href = original;
    mini.target = "_blank";
    mini.rel = "noopener";
    mini.title = "Abrir fonte original";
    mini.textContent = "↗";
    mini.style.cssText = "position:absolute;right:10px;top:10px;z-index:4;width:34px;height:34px;border-radius:999px;display:flex;align-items:center;justify-content:center;background:rgba(12,12,20,.58);border:1px solid rgba(255,255,255,.18);color:#fff;text-decoration:none;font-weight:800;opacity:.45;backdrop-filter:blur(8px);";
    mini.onmouseenter = () => mini.style.opacity = "1";
    mini.onmouseleave = () => mini.style.opacity = ".45";
    room.appendChild(mini);
  } else {
    const toolbar = document.createElement("div");
    toolbar.className = "source-toolbar";
    toolbar.style.cssText = "position:absolute;left:14px;right:14px;bottom:14px;z-index:3;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(12,12,20,.86);backdrop-filter:blur(12px);";
    toolbar.innerHTML = `<div><b style="display:block;font-size:.9rem;color:var(--ink);">Fonte externa dentro do KagePlay</b><span style="display:block;margin-top:2px;font-size:.78rem;color:var(--ink-soft);">O player está sendo carregado na mesma página. Se a fonte bloquear, use o botão ao lado.</span></div><a class="btn btn-primary" style="white-space:nowrap;padding:9px 13px;" href="${original}" target="_blank" rel="noopener">Abrir fonte ↗</a>`;
    room.appendChild(toolbar);
  }
  mount.appendChild(room);
}

function attachTracking(v, ep) {
  const aId = PL.anime.anime_id, n = ep.episodio_num;
  const prog = KPStore.getProgresso(aId, n);
  if (prog && prog.t > 5 && prog.pct < 0.95) {
    const resume = () => { try { v.currentTime = prog.t; } catch (e) {} v.removeEventListener("loadedmetadata", resume); };
    v.addEventListener("loadedmetadata", resume);
  }
  let last = 0;
  v.addEventListener("timeupdate", () => {
    if (!v.duration) return;
    if (v.currentTime - last >= 5 || v.currentTime < last) {
      last = v.currentTime;
      KPStore.setProgresso(aId, n, v.currentTime, v.duration);
      atualizaBotaoVisto();
    }
    if (v.currentTime / v.duration >= 0.9 && !KPStore.isVisto(aId, n)) {
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
  const href = urlFonte(ep) || urlPlayer(ep) || "#";
  document.getElementById("ext-url").href = href;
  document.getElementById("ext-motivo").textContent = motivo || "Esta fonte não permite reprodução dentro do KagePlay. Use o botão abaixo para abrir a fonte oficial/autorizada.";
  showState("state-externo");
}

function renderInfo() {
  const a = PL.anime, ep = PL.ep;
  document.getElementById("ep-title").textContent = `${a.titulo} — Ep. ${ep.episodio_num}`;
  document.getElementById("ep-sub").textContent = ep.titulo_episodio || "";
  document.getElementById("ep-desc").textContent = a.descricao || "";

  const pills = [];
  pills.push(`<span class="pill">${labelTipo(ep)}</span>`);
  pills.push(`<span class="pill">${a.fonte_principal}</span>`);
  pills.push(`<span class="pill ok">gratuito/autorizado</span>`);
  if (ep.failover_urls?.length) pills.push(`<span class="pill warn">${ep.failover_urls.length} failover(s)</span>`);
  if (usaPlayerOnly(ep)) pills.push(`<span class="pill warn">player limpo</span>`);
  else if (usaSalaExterna(ep)) pills.push(`<span class="pill warn">tentativa de embed</span>`);
  if (ep.status_link !== "Ativo") pills.push(`<span class="pill warn">link: ${ep.status_link}</span>`);
  if (a.adulto_18) pills.push(`<span class="pill" style="color:var(--magenta)">18+</span>`);
  document.getElementById("ep-pills").innerHTML = pills.join("");

  renderAcoes();
  renderEplist();
}

function renderAcoes() {
  const a = PL.anime, ep = PL.ep;
  let bar = document.getElementById("ep-acoes");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "ep-acoes"; bar.className = "ep-acoes";
    document.getElementById("ep-pills").insertAdjacentElement("afterend", bar);
  }
  const fav = KPStore.isFavorito(a.anime_id);
  bar.innerHTML = `<button class="abtn ${fav ? 'on' : ''}" id="btn-fav">${fav ? '★ Favoritado' : '☆ Favoritar'}</button><button class="abtn" id="btn-visto"></button>`;
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
    const status = visto ? "✓" : (el ? "▶" : "⛔");
    return `<a class="ep ${cur} ${visto ? 'seen' : ''}" href="${href}"><span class="n">${e.episodio_num}</span><span class="t">${e.titulo_episodio || 'Episodio ' + e.episodio_num}</span><span class="st">${status}</span></a>`;
  }).join("");
}

function gate18(onConfirm) {
  if (sessionStorage.getItem("kp_age_ok") === "1") return onConfirm();
  showState("state-age");
  document.getElementById("age-yes").onclick = () => { sessionStorage.setItem("kp_age_ok", "1"); showState(null); onConfirm(); };
  document.getElementById("age-no").onclick = () => { location.href = "./index.html"; };
}

async function start() {
  const { anime, ep } = getParams();
  if (!anime) return fatal("Nenhum anime informado na URL.");

  const [cat, pol] = await Promise.all([
    fetch("./data/catalog.json?cb=" + Date.now()).then(r => r.json()),
    fetch("./data/playback-policy.json?cb=" + Date.now()).then(r => r.json()).catch(() => ({}))
  ]);
  PL.catalog = cat; PL.policy = pol;
  PL.anime = cat.animes.find(a => a.anime_id === anime);
  if (!PL.anime) return fatal("Anime não encontrado no catálogo.");
  PL.ep = PL.anime.episodios.find(e => Number(e.episodio_num) === Number(ep));
  if (!PL.ep) return fatal("Episódio não encontrado.");

  renderInfo();
  if (!elegivel(PL.ep)) return blockReproducao(PL.ep);

  const play = () => { showState(null); renderMedia(PL.ep); };
  if (PL.anime.adulto_18 || PL.ep.adulto_18) gate18(play); else play();
}

function blockReproducao(ep) {
  const motivos = [];
  if (ep.gratuito_autorizado !== "Sim") motivos.push("fonte não é gratuita/autorizada");
  if (ep.drm_paywall !== "Nao") motivos.push("conteúdo com DRM ou paywall");
  if (ep.publicar !== "Sim") motivos.push("episódio não publicado");
  document.getElementById("block-motivo").textContent = "Motivo: " + (motivos.join("; ") || "não elegível") + ".";
  showState("state-block");
}

function fatal(msg) {
  document.getElementById("fatal-msg").textContent = msg;
  showState("state-fatal");
}

start().catch(err => fatal("Erro ao iniciar o player: " + err.message));
