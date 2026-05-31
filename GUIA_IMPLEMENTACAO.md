# KagePlay — Guia de Implementação

Plataforma pessoal de organização e reprodução de anime usando **apenas fontes gratuitas/autorizadas**. Este pacote contém a camada técnica completa, testada de ponta a ponta.

---

## 1. O que já está pronto (100% funcional)

| Camada | Arquivo | Status |
|---|---|---|
| Catálogo (home) | `index.html` + `assets/js/catalog.js` | OK — 5 títulos demo, busca, filtros |
| Player | `player.html` + `assets/js/player.js` | OK — mp4, hls, youtube, externo, gate 18+, bloqueio DRM |
| Dados | `data/*.json` + `playlist.m3u` | OK — gerados pela planilha |
| Planilha-mestre | `kageplay_planilha_mestre_v2.xlsx` | OK — 8 abas, fórmulas, validações |
| Automação build | `scripts/build.py` | OK — planilha → JSON/M3U |
| Deploy | `.github/workflows/deploy.yml` | OK — build + GitHub Pages |
| Páginas | `pages/*.html` + `docs/README.md` | OK |

**Regra de ouro do player** (já implementada): um episódio só toca dentro do site quando as TRÊS condições são verdadeiras — `gratuito_autorizado = Sim` **E** `drm_paywall = Nao` **E** `publicar = Sim`. O `status_link` (Inativo/Revisar) **não bloqueia** o player; gera apenas alerta operacional na planilha.

---

## 2. Como rodar localmente (no PC)

O player usa `fetch()`, então precisa de um servidor HTTP (não abra o `index.html` por duplo-clique):

```bash
cd kageplay_mvp_v2
python3 -m http.server 8000
# abrir http://localhost:8000
```

---

## 3. Fluxo de trabalho diário (a parte importante)

```
   PLANILHA (.xlsx)  →  build.py  →  data/*.json  →  site atualizado
   (você edita aqui)    (automático)   (gerado)        (publicado)
```

Você **só edita a planilha**. Nunca edita JSON na mão.

1. Abra `kageplay_planilha_mestre_v2.xlsx`
2. Na aba **02_Episodios**, adicione/edite linhas (anime, episódio, fonte, url, tipo_player, e as flags de regra)
3. As colunas `elegivel_player`, `bloqueio_planilha_link` e `motivo` se calculam sozinhas
4. Salve o .xlsx na raiz do repositório e suba pro GitHub
5. A GitHub Action roda `build.py` e publica sozinha

---

## 4. O que EU (Claude) consigo e NÃO consigo fazer

**Consigo (e já fiz):**
- Toda a camada técnica: player, catálogo, regras, planilha, script de build, workflow de deploy
- Validar o sistema de ponta a ponta (testei os 5 tipos de player + gate 18+ + bloqueio)

**NÃO consigo fazer sozinho (depende de você):**
- **Publicar no GitHub** — você sobe o ZIP pelo GitHub web UI (você já trabalha assim). Posso gerar os comandos git se preferir desktop.
- **Configurar domínio/subdomínio** (`app.seudominio.com`) — feito no painel do seu provedor de DNS + Settings>Pages do repo.
- **Criar a vitrine no Canva** — o Canva é a camada visual (capas, banners). É manual no app. **Mas:** você tem o conector **Canva** e o **Gamma** ligados nesta conta — posso gerar uma apresentação/estrutura visual inicial por lá se quiser. É só pedir.
- **Hospedar os vídeos** — o KagePlay nunca hospeda vídeo; ele aponta para fontes oficiais/livres (Internet Archive, embeds autorizados) ou manda pra fonte externa. Isso é proposital e mantém o projeto legal.

---

## 5. Opções de evolução

**v2 (rápido, alto valor):**
- Favoritos + "continuar assistindo" (localStorage)
- Busca global por gênero/fonte
- Marcação visual de episódios já vistos

**v3 (estrutural):**
- Painel admin web para editar o catálogo sem planilha
- Login simples (pra área 18+ e favoritos por usuário)
- API REST servindo o catálogo (em vez de JSON estático)

**Integração com seu fluxo SUGOIAPI:**
- O `build.py` pode passar a ler a saída do seu pipeline de IPTV (a playlist que você já gera) e converter direto em `catalog.json`, unificando os dois projetos. É a evolução mais natural — posso montar esse conversor quando quiser.

---

## 6. Conteúdo de demonstração incluído

Os 5 títulos são **todos legítimos** (domínio público ou embed oficial), pra você testar sem risco:
- Big Buck Bunny, Sintel, Tears of Steel (Blender, domínio público — Internet Archive)
- Demo YouTube (embed de canal oficial)
- Demo Fonte Externa (mostra o encaminhamento pra fonte oficial)

Troque-os pelos seus títulos reais editando a planilha.
