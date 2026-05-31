# KagePlay — MVP v2 (App/Player)

Camada técnica do KagePlay: o **motor** que lê os dados e reproduz anime a partir de
fontes gratuitas/autorizadas, com player interno sempre que tecnicamente permitido.

## Estrutura

```
kageplay_mvp_v2/
├── index.html              # catálogo do app
├── player.html             # player com validação de regras
├── data/
│   ├── catalog.json        # animes + episódios (gerado pela planilha)
│   ├── categories.json     # categorias
│   ├── playback-policy.json# regras de reprodução
│   └── playlist.m3u        # playlist p/ players IPTV (só elegíveis mp4/webm/hls)
├── assets/css/             # style.css + player.css
├── assets/js/              # catalog.js + player.js
├── pages/                  # como-funciona, fontes-oficiais, adulto-18
├── scripts/build.py        # gera JSON/M3U a partir da planilha .xlsx
└── .github/workflows/      # deploy automático (GitHub Actions)
```

## Regra central do player

Um episódio só toca dentro do site quando **as três** condições são verdadeiras:

| Campo | Valor exigido |
|---|---|
| `gratuito_autorizado` | Sim |
| `drm_paywall` | Não |
| `publicar` | Sim |

`status_link` **não** bloqueia o player — gera apenas alerta operacional na planilha.

## Como rodar localmente

```bash
cd kageplay_mvp_v2
python3 -m http.server 8000
# abra http://localhost:8000/index.html
```
> Precisa de servidor HTTP (os `fetch` de JSON não funcionam abrindo o arquivo direto).

## Como atualizar o catálogo a partir da planilha

```bash
pip install openpyxl
python scripts/build.py --xlsx kageplay_planilha_mestre.xlsx --out data
```
O script gera `catalog.json`, `categories.json`, `playlist.m3u` e imprime um relatório
de erros (episódios órfãos) e alertas (links inativos).

## Publicação

1. Suba a pasta num repositório GitHub.
2. Ative o GitHub Pages (branch `main`, raiz).
3. A Action em `.github/workflows/deploy.yml` reconstrói o catálogo e publica a cada push.
4. Configure o subdomínio `app.seudominio.com` apontando para o Pages.

## URL do player

```
player.html?anime=ANIME_ID&ep=NUMERO
ex: player.html?anime=anime-demo-01&ep=1
```

## O que o KagePlay nunca faz
Burlar DRM · remover paywall · capturar stream · forçar iframe bloqueado · usar fonte pirata.

---

## v2 — Recursos pessoais (adicionados)

Persistencia local (localStorage, por dispositivo) em `assets/js/store.js`:
- **Favoritos** — estrela nos cards e no player; chip "★ Favoritos" filtra o catalogo.
- **Continuar assistindo** — o player salva o ponto de parada (video mp4/webm/hls) e a home mostra um carrossel para retomar.
- **Episodios vistos** — marcacao automatica ao atingir 90% (ou manual no player); aparece na lista de episodios e no card.

Nenhum dado sai do navegador. Para zerar: limpar os dados do site no navegador.

## Vitrine

`vitrine/index.html` — landing page de apresentacao (camada "Vitrine" do projeto).
No deploy final, a vitrine vai no dominio principal e o app no subdominio `app.`.
Localmente, os botoes da vitrine apontam para `./index.html` (o app).

## Catálogo via AniList (v3)

O catálogo principal agora é gerado da **AniList** (metadados oficiais), cobrindo
todas as categorias por popularidade/nota. ~4.5 mil títulos.

- `scripts/fetch_anilist.py` — coleta paginada (respeita rate limit 30/min), salva raw.
- `scripts/build_from_anilist.py` — transforma o raw em `catalog.json`.

Cada título entra como player **externo**, com link para a **fonte oficial de streaming**
(Crunchyroll, Netflix, etc.) ou para a página do AniList. Nenhuma fonte pirata é usada.
Títulos Ecchi/adultos vão para a área 18+ separada (ocultos do catálogo principal).

Para regerar/atualizar:
```bash
python scripts/fetch_anilist.py 90        # coleta (ajuste o nº de páginas)
python scripts/build_from_anilist.py      # gera catalog.json
```

O front-end usa renderização paginada (scroll infinito, lotes de 60) para
aguentar milhares de títulos sem travar no celular.

## Idioma — Dublado / Legendado (v3.1)

A AniList nao informa de forma confiavel se um titulo tem dublagem PT-BR.
Por isso o idioma e curado em `data/idiomas.json`:
- `padrao`: idioma de quem nao esta marcado (Legendados).
- `dublados_termos`: lista de termos de titulo que marcam Dublados (PT-BR). Edite a vontade.
- `dublados_ids`: ids especificos (al-XXXX) marcados como Dublados.

O `build_from_anilist.py` aplica essa curadoria e a automacao semanal a preserva.
O site ganha um filtro "Idioma: Dublados / Legendados" na home.

## Atualizacao automatica semanal (GitHub Actions)

`.github/workflows/atualizar-catalogo.yml` roda toda semana (domingo 06:00 UTC) e
tambem manualmente (aba Actions > Run workflow). Ele coleta do AniList, regera o
catalogo (preservando a curadoria de idioma) e commita. O commit dispara o deploy
do Pages automaticamente. Nenhuma acao manual recorrente e necessaria.

## Catálogo unificado (v3.2)

A antiga "área 18+ separada" foi removida. Agora há **uma estrutura só**:
títulos adultos (Ecchi/sugestivos) aparecem no catálogo principal, com suas
categorias visíveis no menu (Ecchi 18+, Adulto 18+, Romance Adulto 18+).

Como o site é público, há **uma confirmação de idade única na entrada**
(salva por sessão no navegador) — não é uma seção separada, apenas um aviso.

Observação: o pipeline continua **não** coletando hentai/pornografia explícita
(filtro `isAdult:false` no AniList). O conteúdo "adulto" do catálogo é
material sugestivo de plataformas mainstream, não pornográfico.
