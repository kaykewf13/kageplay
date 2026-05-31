/* ============================================================
   KAGEPLAY — assets/js/store.js
   Camada de persistencia local (localStorage) para a v2:
   - Favoritos
   - Continuar assistindo (progresso de reproducao)
   - Episodios vistos
   Tudo client-side, por dispositivo. Nenhum dado sai do navegador.
   ============================================================ */

const KPStore = (() => {
  const K_FAV  = "kp_favoritos";
  const K_PROG = "kp_progresso";
  const K_VIST = "kp_vistos";

  function _get(key, def) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? def; }
    catch { return def; }
  }
  function _set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* modo privado etc */ }
  }

  const epKey = (animeId, ep) => `${animeId}:${ep}`;

  /* ---------- FAVORITOS (array de anime_id) ---------- */
  function getFavoritos() { return _get(K_FAV, []); }
  function isFavorito(id) { return getFavoritos().includes(id); }
  function toggleFavorito(id) {
    const f = getFavoritos();
    const i = f.indexOf(id);
    if (i >= 0) f.splice(i, 1); else f.push(id);
    _set(K_FAV, f);
    return f.includes(id);
  }

  /* ---------- PROGRESSO (map epKey -> {anime, ep, t, d, pct, updated}) ---------- */
  function getProgressoAll() { return _get(K_PROG, {}); }
  function getProgresso(animeId, ep) { return getProgressoAll()[epKey(animeId, ep)] || null; }
  function setProgresso(animeId, ep, t, d) {
    if (!d || d <= 0 || !isFinite(d)) return;
    const all = getProgressoAll();
    const pct = Math.min(1, Math.max(0, t / d));
    all[epKey(animeId, ep)] = { anime: animeId, ep, t, d, pct, updated: Date.now() };
    _set(K_PROG, all);
  }
  function limparProgresso(animeId, ep) {
    const all = getProgressoAll();
    delete all[epKey(animeId, ep)];
    _set(K_PROG, all);
  }
  /* lista para "continuar assistindo": iniciados mas nao concluidos, mais recentes primeiro */
  function continuarAssistindo() {
    return Object.values(getProgressoAll())
      .filter(p => p.pct > 0.02 && p.pct < 0.95)
      .sort((a, b) => b.updated - a.updated);
  }

  /* ---------- VISTOS (array de epKey) ---------- */
  function getVistos() { return _get(K_VIST, []); }
  function isVisto(animeId, ep) { return getVistos().includes(epKey(animeId, ep)); }
  function marcarVisto(animeId, ep, visto = true) {
    const v = getVistos();
    const k = epKey(animeId, ep);
    const i = v.indexOf(k);
    if (visto && i < 0) v.push(k);
    if (!visto && i >= 0) v.splice(i, 1);
    _set(K_VIST, v);
    return v.includes(k);
  }
  function vistosDoAnime(animeId) {
    return getVistos().filter(k => k.startsWith(animeId + ":")).length;
  }

  return {
    epKey,
    getFavoritos, isFavorito, toggleFavorito,
    getProgresso, setProgresso, limparProgresso, continuarAssistindo,
    getVistos, isVisto, marcarVisto, vistosDoAnime
  };
})();
