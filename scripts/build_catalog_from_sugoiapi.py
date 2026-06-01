#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
KagePlay - build_catalog_from_sugoiapi.py

Converte a estrutura M3U gerada pelo repositório kaykewf13/SUGOIAPI
para o formato data/catalog.json usado pelo KagePlay.

Fonte padrão:
  https://raw.githubusercontent.com/kaykewf13/SUGOIAPI/main/output/playlist_validada.m3u

Uso seguro recomendado:
  python scripts/build_catalog_from_sugoiapi.py --out data/catalog.json

Por segurança, URLs tokenizadas/privadas como oauth_token e api.put.io são
ignoradas por padrão. Para ambiente pessoal/controlado, habilite explicitamente:
  ALLOW_TOKENIZED_URLS=1 python scripts/build_catalog_from_sugoiapi.py --out data/catalog.json

Se existir uma playlist proxy pública, prefira usá-la:
  python scripts/build_catalog_from_sugoiapi.py --m3u-url URL_DA_PLAYLIST_PROXY --out data/catalog.json
"""

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

DEFAULT_M3U_URL = "https://raw.githubusercontent.com/kaykewf13/SUGOIAPI/main/output/playlist_validada.m3u"
PLACEHOLDER_COVER = "https://placehold.co/480x720/16161f/9a9aae?text={title}"
PLACEHOLDER_BANNER = "https://placehold.co/1280x420/0c0c14/e6c369?text={title}"

EXTINF_RE = re.compile(r"#EXTINF:[^,]*,(.+)$")
ATTR_RE = re.compile(r'(\w[\w-]*)="([^"]*)"')
SERIES_RE = re.compile(r"^(?P<title>.+?)\s+S(?P<season>\d{1,2})\s*E(?P<episode>\d{1,4})$", re.I)
SERIES_RE_COMPACT = re.compile(r"^(?P<title>.+?)\s+S(?P<season>\d{1,2})E(?P<episode>\d{1,4})$", re.I)

CATEGORY_MAP = {
    "Acao e Aventura": "Acao",
    "Ação e Aventura": "Acao",
    "Terror e Suspense": "Suspense",
    "Psicologico": "Psicologico",
    "Música e Idols": "Musica",
    "Musica e Idols": "Musica",
    "Clásicos": "Classicos",
    "Clasicos": "Classicos",
    "Geral": "Geral",
}


def norm(v: str) -> str:
    return (v or "").strip()


def slugify(text: str) -> str:
    text = norm(text).lower()
    repl = {
        "á": "a", "à": "a", "â": "a", "ã": "a", "ä": "a",
        "é": "e", "ê": "e", "è": "e", "ë": "e",
        "í": "i", "ì": "i", "î": "i", "ï": "i",
        "ó": "o", "ò": "o", "ô": "o", "õ": "o", "ö": "o",
        "ú": "u", "ù": "u", "û": "u", "ü": "u",
        "ç": "c", "ñ": "n",
    }
    for a, b in repl.items():
        text = text.replace(a, b)
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "titulo-sem-nome"


def is_tokenized_or_private(url: str) -> bool:
    u = url.lower()
    return "oauth_token=" in u or "api.put.io" in u or "token=" in u


def safe_title_for_placeholder(title: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "+", title).strip("+")[:60] or "KagePlay"


def fetch_text(path_or_url: str) -> str:
    if path_or_url.startswith(("http://", "https://")):
        req = urllib.request.Request(path_or_url, headers={"User-Agent": "KagePlay-SUGOIAPI-Importer/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8", errors="ignore")
    return Path(path_or_url).read_text(encoding="utf-8", errors="ignore")


def parse_attrs(line: str) -> dict:
    return {k: v for k, v in ATTR_RE.findall(line)}


def detect_kind(group_title: str, tvg_type: str, tvg_name: str) -> str:
    g = group_title.lower()
    t = tvg_type.lower()
    if "series" in g or t == "series":
        return "series"
    if "filmes" in g or "movies" in g or t == "movie":
        return "movie"
    return "live"


def parse_series_name(tvg_name: str, fallback: str):
    candidate = norm(tvg_name) or norm(fallback)
    m = SERIES_RE.match(candidate) or SERIES_RE_COMPACT.match(candidate)
    if not m:
        return None
    title = norm(m.group("title"))
    season = int(m.group("season"))
    episode = int(m.group("episode"))
    return title, season, episode


def infer_player_type(url: str) -> str:
    u = url.lower()
    if ".m3u8" in u or "/playlist.m3u8" in u or "/manifest" in u:
        return "hls"
    if ".webm" in u:
        return "webm"
    # Put.io / stream direto normalmente entrega vídeo por Content-Type.
    # O player nativo do navegador tentará executar como vídeo.
    return "mp4"


def parse_m3u(content: str, allow_tokenized: bool):
    items = []
    skipped_private = 0
    lines = content.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line.startswith("#EXTINF"):
            i += 1
            continue

        url = ""
        j = i + 1
        while j < len(lines):
            nxt = lines[j].strip()
            if nxt and not nxt.startswith("#"):
                url = nxt
                break
            j += 1

        if not url:
            i = j + 1
            continue

        if is_tokenized_or_private(url) and not allow_tokenized:
            skipped_private += 1
            i = j + 1
            continue

        attrs = parse_attrs(line)
        display = EXTINF_RE.search(line)
        display_name = norm(display.group(1)) if display else ""
        tvg_name = norm(attrs.get("tvg-name")) or display_name
        logo = norm(attrs.get("tvg-logo"))
        group_title = norm(attrs.get("group-title")) or "Geral"
        tvg_type = norm(attrs.get("tvg-type"))
        kind = detect_kind(group_title, tvg_type, tvg_name)
        parts = [p.strip() for p in group_title.split("|")]
        category = CATEGORY_MAP.get(parts[1], parts[1]) if len(parts) > 1 else "Geral"

        items.append({
            "kind": kind,
            "name": tvg_name,
            "display_name": display_name or tvg_name,
            "category": category,
            "logo": logo,
            "url": url,
            "group_title": group_title,
        })
        i = j + 1

    return items, skipped_private


def build_catalog(items, include_movies: bool):
    series = defaultdict(lambda: {
        "title": "",
        "category": "Geral",
        "logo": "",
        "episodes": {},
        "failovers": defaultdict(list),
    })

    movies = []

    for item in items:
        if item["kind"] == "series":
            parsed = parse_series_name(item["name"], item["display_name"])
            if not parsed:
                continue
            title, season, episode = parsed
            key = slugify(title)
            data = series[key]
            data["title"] = title
            data["category"] = item["category"] or "Geral"
            data["logo"] = item["logo"]
            ep_key = (season, episode)

            if ep_key not in data["episodes"]:
                data["episodes"][ep_key] = {
                    "season": season,
                    "episode": episode,
                    "title": item["display_name"] or f"Episodio {episode}",
                    "url": item["url"],
                    "logo": item["logo"],
                }
            else:
                data["failovers"][ep_key].append(item["url"])

        elif include_movies and item["kind"] == "movie":
            movies.append(item)

    animes = []
    for key, data in sorted(series.items(), key=lambda x: x[1]["title"].lower()):
        title = data["title"]
        ph = safe_title_for_placeholder(title)
        episodes = []
        for (season, ep), info in sorted(data["episodes"].items()):
            url = info["url"]
            ep_obj = {
                "temporada": season,
                "episodio_num": ep,
                "titulo_episodio": f"T{season:02d} E{ep:02d}",
                "url_video": url,
                "player_url": url,
                "fonte_url": url,
                "fonte_original": "SUGOIAPI playlist_validada.m3u",
                "tipo_player": infer_player_type(url),
                "modo_reproducao": "interno",
                "modo_visual": "video_nativo",
                "gratuito_autorizado": "Sim",
                "drm_paywall": "Nao",
                "publicar": "Sim",
                "status_link": "Ativo",
                "adulto_18": False,
            }
            failovers = data["failovers"].get((season, ep), [])
            if failovers:
                ep_obj["failover_urls"] = failovers
            episodes.append(ep_obj)

        animes.append({
            "anime_id": key,
            "titulo": title,
            "slug": key,
            "categoria_principal": data["category"] or "Geral",
            "categorias_secundarias": ["SUGOIAPI", "IPTV", "VOD", "Player Nativo"],
            "adulto_18": False,
            "status": "SUGOIAPI",
            "publicar": "Sim",
            "descricao": f"Catalogo importado automaticamente do SUGOIAPI. Fonte: playlist_validada.m3u.",
            "capa_url": data["logo"] or PLACEHOLDER_COVER.format(title=ph),
            "banner_url": PLACEHOLDER_BANNER.format(title=ph),
            "fonte_principal": "SUGOIAPI",
            "fonte_url": DEFAULT_M3U_URL,
            "episodios": episodes,
        })

    if include_movies:
        for item in movies:
            title = item["name"] or item["display_name"]
            key = slugify(f"filme-{title}")
            ph = safe_title_for_placeholder(title)
            url = item["url"]
            animes.append({
                "anime_id": key,
                "titulo": title,
                "slug": key,
                "categoria_principal": item["category"] or "Filmes",
                "categorias_secundarias": ["SUGOIAPI", "Filmes", "VOD", "Player Nativo"],
                "adulto_18": False,
                "status": "SUGOIAPI",
                "publicar": "Sim",
                "descricao": "Filme/VOD importado automaticamente do SUGOIAPI.",
                "capa_url": item["logo"] or PLACEHOLDER_COVER.format(title=ph),
                "banner_url": PLACEHOLDER_BANNER.format(title=ph),
                "fonte_principal": "SUGOIAPI",
                "fonte_url": DEFAULT_M3U_URL,
                "episodios": [{
                    "episodio_num": 1,
                    "titulo_episodio": "Filme",
                    "url_video": url,
                    "player_url": url,
                    "fonte_url": url,
                    "fonte_original": "SUGOIAPI playlist_validada.m3u",
                    "tipo_player": infer_player_type(url),
                    "modo_reproducao": "interno",
                    "modo_visual": "video_nativo",
                    "gratuito_autorizado": "Sim",
                    "drm_paywall": "Nao",
                    "publicar": "Sim",
                    "status_link": "Ativo",
                    "adulto_18": False,
                }],
            })

    return {
        "versao": "sugoiapi-1.0",
        "atualizado_em": str(dt.date.today()),
        "fonte_catalogo": "SUGOIAPI",
        "origem": DEFAULT_M3U_URL,
        "animes": animes,
    }


def main():
    ap = argparse.ArgumentParser(description="Gera catalog.json do KagePlay a partir do SUGOIAPI.")
    ap.add_argument("--m3u-url", default=os.getenv("SUGOIAPI_M3U_URL", DEFAULT_M3U_URL))
    ap.add_argument("--out", default="data/catalog.json")
    ap.add_argument("--include-movies", action="store_true", default=os.getenv("INCLUDE_MOVIES", "0") == "1")
    ap.add_argument("--allow-tokenized", action="store_true", default=os.getenv("ALLOW_TOKENIZED_URLS", "0") == "1")
    args = ap.parse_args()

    content = fetch_text(args.m3u_url)
    items, skipped_private = parse_m3u(content, allow_tokenized=args.allow_tokenized)
    catalog = build_catalog(items, include_movies=args.include_movies)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=" * 60)
    print("KagePlay ← SUGOIAPI catalog build OK")
    print(f"Fonte M3U          : {args.m3u_url}")
    print(f"Itens lidos        : {len(items)}")
    print(f"Privados ignorados : {skipped_private}")
    print(f"Titulos publicados : {len(catalog['animes'])}")
    print(f"Saida              : {out}")
    print("=" * 60)

    if skipped_private and not args.allow_tokenized:
        print("AVISO: URLs com token/api.put.io foram ignoradas. Use ALLOW_TOKENIZED_URLS=1 apenas em ambiente pessoal/controlado.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        sys.exit(1)
