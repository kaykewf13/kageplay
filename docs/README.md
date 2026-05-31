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
