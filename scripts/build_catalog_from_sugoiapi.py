#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
KagePlay - build_catalog_from_sugoiapi.py

Converte o output M3U do kaykewf13/SUGOIAPI para o formato data/catalog.json do KagePlay.

Melhorias desta versão:
- Separa temporadas corretamente quando o título traz S2, S3, 2nd Season, 3rd Season etc.
- Valida URLs antes de publicar quando VALIDATE_LINKS=1.
- Gera data/catalog-health.json com resumo de links válidos, inválidos e ignorados.
- Aceita URLs tokenizadas apenas quando ALLOW_TOKENIZED_URLS=1.

Uso:
  python scripts/build_catalog_from_sugoiapi.py --out data/catalog.json

Uso completo, ambiente pessoal/controlado:
  ALLOW_TOKENIZED_URLS=1 INCLUDE_MOVIES=1 VALIDATE_LINKS=1 \
  python scripts/build_catalog_from_sugoiapi.py --out data/catalog.json
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse

DEFAULT_M3U_URL = "https://raw.githubusercontent.com/kaykewf13/SUGOIAPI/main/output/playlist_validada.m3u"
PLACEHOLDER_COVER = "https://placehold.co/480x720/16161f/9a9aae?text={title}"
PLACEHOLDER_BANNER = "https://placehold.co/1280x420/0c0c14/e6c369?text={title}"

EXTINF_RE = re.compile(r"#EXTINF:[^,]*,(.+)$")
ATTR_RE = re.compile(r'(\w[\w-]*)="([^"]*)"')
SERIES_RE = re.compile(r"^(?P<title>.+?)\s+S(?P<season>\d{1,2})\s*E(?P<episode>\d{1,4})$", re.I)
SERIES_RE_COMPACT = re.compile(r"^(?P<title>.+?)\s+S(?P<season>\d{1,2})E(?P<episode>\d{1,4})$", re.I)

SEASON_HINT_PATTERNS = [
    re.compile(r"\bS(?P<season>\d{1,2})\b\s*$", re.I),
    re.compile(r"\bSeason\s*(?P<season>\d{1,2})\b\s*$", re.I),
    re.compile(r"\b(?P<season>\d{1,2})(?:st|nd|rd|th)\s+Season\b\s*$", re.I),
    re.compile(r"\b(?P<season>\d{1,2})a\s+Temporada\b\s*$", re.I),
]

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

MEDIA_EXTENSIONS = (".mp4", ".mkv", ".webm", ".m3u8", ".ts")


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
        req = urllib.request.Request(path_or_url, headers={"User-Agent": "KagePlay-SUGOIAPI-Importer/1.1"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8", errors="ignore")
    return Path(path_or_url).read_text(encoding="utf-8", errors="ignore")


def parse_attrs(line: str) -> dict:
    return {k: v for k, v in ATTR_RE.findall(line)}


def detect_kind(group_title: str, tvg_type: str, tvg_name: str) -> str:
    g = group_title.lower()
    t = tvg_type.lower()
    name = tvg_name.lower()
    if "series" in g or t == "series" or SERIES_RE.search(tvg_name) or SERIES_RE_COMPACT.search(tvg_name):
        return "series"
    if "filmes" in g or "movies" in g or t == "movie":
        return "movie"
    if any(ext in name for ext in MEDIA_EXTENSIONS):
        return "movie"
    return "live"


def normalize_title_and_season(title_part: str, parsed_season: int):
    title = norm(title_part)
    season = parsed_season

    # Ex: "Arifureta ... S3 S01 E05" -> título base + temporada 3
    # Ex: "Himouto! Umaru-chan 2nd Season S01 E01" -> título base + temporada 2
    for pat in SEASON_HINT_PATTERNS:
        m = pat.search(title)
        if m:
            try:
                season = int(m.group("season"))
                title = pat.sub("", title).strip(" -_.")
                break
            except Exception:
                pass

    # Limpezas comuns que não devem fazer parte do nome base.
    title = re.sub(r"\s+-\s*$", "", title).strip(" -_.")
    title = re.sub(r"\s+\bS\d{1,2}\b$", "", title, flags=re.I).strip(" -_.")
    return title, season


def parse_series_name(tvg_name: str, fallback: str):
    candidate = norm(tvg_name) or norm(fallback)
    m = SERIES_RE.match(candidate) or SERIES_RE_COMPACT.match(candidate)
    if not m:
        return None
    raw_title = norm(m.group("title"))
    parsed_season = int(m.group("season"))
    episode = int(m.group("episode"))
    title, season = normalize_title_and_season(raw_title, parsed_season)
    if not title or len(title) < 2:
        return None
    return title, season, episode


def infer_player_type(url: str) -> str:
    u = url.lower()
    if ".m3u8" in u or "/playlist.m3u8" in u or "/manifest" in u:
        return "hls"
    if ".webm" in u:
        return "webm"
    return "mp4"


def is_probably_media_url(url: str) -> bool:
    u = url.lower()
    return any(ext in u for ext in MEDIA_EXTENSIONS) or "/stream" in u or "api.put.io" in u


def validate_url(url: str, timeout: int = 12) -> dict:
    """Validação pragmática: HEAD primeiro, depois GET com Range. Não baixa o vídeo completo."""
    if not url.startswith(("http://", "https://")):
        return {"ok": False, "status": None, "reason": "URL sem http/https"}

    headers = {
        "User-Agent": "Mozilla/5.0 (KagePlay link validator)",
        "Accept": "*/*",
    }

    # Alguns CDNs não gostam de HEAD. Ainda assim, tentamos por velocidade.
    for method in ("HEAD", "GET"):
        try:
            req_headers = dict(headers)
            if method == "GET":
                req_headers["Range"] = "bytes=0-2047"
            req = urllib.request.Request(url, method=method, headers=req_headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                status = getattr(resp, "status", 200)
                ctype = resp.headers.get("Content-Type", "")
                if 200 <= status < 400:
                    return {"ok": True, "status": status, "content_type": ctype, "method": method}
                return {"ok": False, "status": status, "reason": f"HTTP {status}", "method": method}
        except urllib.error.HTTPError as e:
            # 405/403 em HEAD não encerra: tenta GET.
            if method == "HEAD" and e.code in (403, 405, 406):
                continue
            return {"ok": False, "status": e.code, "reason": f"HTTPError {e.code}", "method": method}
        except Exception as e:
            if method == "HEAD":
                continue
            return {"ok": False, "status": None, "reason": str(e)[:180], "method": method}

    return {"ok": False, "status": None, "reason": "Falha desconhecida"}


def parse_m3u(content: str, allow_tokenized: bool):
    items = []
    counters = {"private_skipped": 0, "non_media_skipped": 0, "live_skipped": 0}
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
            counters["private_skipped"] += 1
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

        if kind == "live":
            counters["live_skipped"] += 1
            i = j + 1
            continue

        if not is_probably_media_url(url):
            counters["non_media_skipped"] += 1
            i = j + 1
            continue

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

    return items, counters


def validate_items(items, max_workers: int):
    results = {}
    unique_urls = sorted({i["url"] for i in items})
    if not unique_urls:
        return results

    print(f"Validando {len(unique_urls)} URLs de mídia...")
    started = time.time()
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futs = {ex.submit(validate_url, url): url for url in unique_urls}
        for n, fut in enumerate(as_completed(futs), 1):
            url = futs[fut]
            try:
                results[url] = fut.result()
            except Exception as e:
                results[url] = {"ok": False, "status": None, "reason": str(e)[:180]}
            if n % 50 == 0:
                print(f"  {n}/{len(unique_urls)} URLs verificadas...")
    elapsed = round(time.time() - started, 1)
    ok_count = sum(1 for r in results.values() if r.get("ok"))
    print(f"Validação finalizada: {ok_count}/{len(unique_urls)} válidas em {elapsed}s")
    return results


def build_catalog(items, include_movies: bool, validation: dict, validate_links: bool):
    series = defaultdict(lambda: {
        "title": "",
        "category": "Geral",
        "logo": "",
        "episodes": {},
        "failovers": defaultdict(list),
        "invalid": [],
    })
    movies = []
    invalid_items = []

    for item in items:
        val = validation.get(item["url"], {"ok": True})
        if validate_links and not val.get("ok"):
            invalid_items.append({"name": item["name"], "url": item["url"], "validation": val})
            continue

        if item["kind"] == "series":
            parsed = parse_series_name(item["name"], item["display_name"])
            if not parsed:
                invalid_items.append({"name": item["name"], "url": item["url"], "validation": {"ok": False, "reason": "Não foi possível detectar série/episódio"}})
                continue
            title, season, episode = parsed
            key = slugify(title)
            data = series[key]
            data["title"] = title
            data["category"] = item["category"] or "Geral"
            data["logo"] = item["logo"] or data["logo"]
            ep_key = (season, episode)

            if ep_key not in data["episodes"]:
                data["episodes"][ep_key] = {
                    "season": season,
                    "episode": episode,
                    "title": item["display_name"] or f"T{season:02d} E{episode:02d}",
                    "url": item["url"],
                    "logo": item["logo"],
                    "validation": val,
                }
            else:
                data["failovers"][ep_key].append(item["url"])

        elif include_movies and item["kind"] == "movie":
            movies.append({**item, "validation": val})

    animes = []
    for key, data in sorted(series.items(), key=lambda x: x[1]["title"].lower()):
        if not data["episodes"]:
            continue
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
                "status_link": "Ativo" if not validate_links or info.get("validation", {}).get("ok") else "Falha validacao",
                "adulto_18": False,
            }
            failovers = data["failovers"].get((season, ep), [])
            # Mantém failovers somente se válidos quando validação está ativa.
            if validate_links:
                failovers = [u for u in failovers if validation.get(u, {}).get("ok")]
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
            "descricao": "Catálogo importado automaticamente do SUGOIAPI, com links de mídia validados pelo pipeline do KagePlay.",
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
                "descricao": "Filme/VOD importado automaticamente do SUGOIAPI, com link validado pelo pipeline do KagePlay.",
                "capa_url": item["logo"] or PLACEHOLDER_COVER.format(title=ph),
                "banner_url": PLACEHOLDER_BANNER.format(title=ph),
                "fonte_principal": "SUGOIAPI",
                "fonte_url": DEFAULT_M3U_URL,
                "episodios": [{
                    "temporada": 1,
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
        "versao": "sugoiapi-1.1",
        "atualizado_em": str(dt.date.today()),
        "fonte_catalogo": "SUGOIAPI",
        "origem": DEFAULT_M3U_URL,
        "animes": animes,
    }, invalid_items


def main():
    ap = argparse.ArgumentParser(description="Gera catalog.json do KagePlay a partir do SUGOIAPI.")
    ap.add_argument("--m3u-url", default=os.getenv("SUGOIAPI_M3U_URL", DEFAULT_M3U_URL))
    ap.add_argument("--out", default="data/catalog.json")
    ap.add_argument("--health-out", default="data/catalog-health.json")
    ap.add_argument("--include-movies", action="store_true", default=os.getenv("INCLUDE_MOVIES", "0") == "1")
    ap.add_argument("--allow-tokenized", action="store_true", default=os.getenv("ALLOW_TOKENIZED_URLS", "0") == "1")
    ap.add_argument("--validate-links", action="store_true", default=os.getenv("VALIDATE_LINKS", "1") == "1")
    ap.add_argument("--validation-workers", type=int, default=int(os.getenv("VALIDATION_WORKERS", "24")))
    args = ap.parse_args()

    content = fetch_text(args.m3u_url)
    items, counters = parse_m3u(content, allow_tokenized=args.allow_tokenized)

    validation = validate_items(items, args.validation_workers) if args.validate_links else {}
    catalog, invalid_items = build_catalog(items, args.include_movies, validation, args.validate_links)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")

    health = {
        "versao": "1.1",
        "atualizado_em": str(dt.datetime.utcnow()) + "Z",
        "m3u_url": args.m3u_url,
        "allow_tokenized_urls": bool(args.allow_tokenized),
        "include_movies": bool(args.include_movies),
        "validate_links": bool(args.validate_links),
        "itens_lidos": len(items),
        "titulos_publicados": len(catalog["animes"]),
        "episodios_publicados": sum(len(a.get("episodios", [])) for a in catalog["animes"]),
        "contadores": counters,
        "validacao": {
            "urls_verificadas": len(validation),
            "urls_validas": sum(1 for v in validation.values() if v.get("ok")),
            "urls_invalidas": sum(1 for v in validation.values() if not v.get("ok")),
        },
        "invalidos_amostra": invalid_items[:50],
    }
    health_out = Path(args.health_out)
    health_out.parent.mkdir(parents=True, exist_ok=True)
    health_out.write_text(json.dumps(health, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=" * 60)
    print("KagePlay ← SUGOIAPI catalog build OK")
    print(f"Fonte M3U              : {args.m3u_url}")
    print(f"Itens candidatos        : {len(items)}")
    print(f"Titulos publicados      : {len(catalog['animes'])}")
    print(f"Episodios publicados    : {health['episodios_publicados']}")
    print(f"Privados ignorados      : {counters['private_skipped']}")
    print(f"Live ignorados          : {counters['live_skipped']}")
    print(f"Links inválidos         : {health['validacao']['urls_invalidas']}")
    print(f"Saida catalog           : {out}")
    print(f"Saida health            : {health_out}")
    print("=" * 60)

    if counters["private_skipped"] and not args.allow_tokenized:
        print("AVISO: URLs com token/api.put.io foram ignoradas. Execute com ALLOW_TOKENIZED_URLS=1 para catálogo completo em ambiente pessoal/controlado.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        sys.exit(1)
