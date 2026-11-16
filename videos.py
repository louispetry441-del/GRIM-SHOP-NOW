# -*- coding: utf-8 -*-
"""
🎬 EXTRATOR DE CATÁLOGO — V4.3 (Playwright, robusto + SPA-ready)

USO:
    python videos.py "https://site.com/catalogo" nome_site
    python videos.py "https://site.com/catalogo" nome_site --headful
    python videos.py "https://site.com/catalogo" nome_site --debug
    python videos.py "https://site.com/catalogo" nome_site --inspecionar
    python videos.py "https://site.com/catalogo" nome_site --screenshots

MODOS:
    --headful      → abre o navegador visível (você vê o bot clicando)
    --debug        → salva HTML renderizado em debug/pagina_renderizada.html
    --inspecionar  → lista TODOS os botões/links da página e sai
    --screenshots  → tira print de cada modal aberto

MUDANÇAS DA V4.1:
    - Espera INTELIGENTE pro React/Vue renderizar (wait_for_function)
    - Aguarda o botão "Preview" + "$" aparecerem no DOM
    - Rola a página até o fim (força lazy-load dos cards)
    - Sleep de segurança pós-render
    - Mantém toda a robustez da V4
"""

import os
import re
import sys
import random
import logging
import time
from urllib.parse import urljoin, urlparse

from playwright.sync_api import sync_playwright

# ============================================================
# CONFIG
# ============================================================
PASTA_SAIDA = "saida"
PASTA_DEBUG = "debug"

logging.basicConfig(format="%(asctime)s | %(message)s", level=logging.INFO)
log = logging.getLogger(__name__)


# ============================================================
# CAMPOS FIXOS (iguais ao modelo do usuário)
# ============================================================
CHIPS_JS      = '["7GB+", "HOT", "2025"]'
BADGES_JS     = '[{ label: "🔥 HOT", cls: "hot" }, { label: "NEW", cls: "new" }]'
PROOF_JS      = '[]'   # sem proof
PROOF_CAPTION = ""
FREE_LINK     = ""


# ============================================================
# UTILITÁRIOS
# ============================================================
def limpar_texto(t):
    if not t:
        return ""
    return re.sub(r"\s+", " ", t).strip()


def escape_js(s):
    if s is None:
        return ""
    return s.replace("\\", "\\\\").replace('"', '\\"')


def extrair_preco(texto):
    m = re.search(r"[\$€£R]\s?\d+(?:[.,]\d{1,2})?", texto or "")
    return m.group(0) if m else ""


def limpar_url(url):
    """Corrige espaços, https duplicado, etc."""
    url = (url or "").strip().strip('"').strip("'")
    url = re.sub(r'^(https?://)\s*(https?://)', r'\1', url)
    url = re.sub(r'\s+', '', url)
    if not url.startswith("http"):
        url = "https://" + url
    return url


EXTS_VIDEO = (".mp4", ".m3u8", ".webm", ".mov", ".mkv", ".avi", ".flv", ".ts")
DOMINIOS_VIDEO = (
    "youtube.com", "youtu.be", "vimeo.com", "dailymotion.com",
    "streamable.com", "streamtape", "dood", "mixdrop", "vidoza",
    "filemoon", "vidhide", "catbox.moe", "pixeldrain", "gofile",
    "player", "stream", "embed", "watch", "preview",
)


def parece_video(url):
    if not url:
        return False
    u = url.lower()
    if any(ext in u for ext in EXTS_VIDEO):
        return True
    if any(d in u for d in DOMINIOS_VIDEO):
        return True
    return False


# ============================================================
# MARCAÇÃO DOS BOTÕES DE PREVIEW (robusta)
# ============================================================
def marcar_botoes_preview(page):
    js = r"""
    () => {
        document.querySelectorAll('[data-__preview-idx]').forEach(e =>
            e.removeAttribute('data-__preview-idx'));

        const PALAVRAS_TEXTO = [
            'preview','assistir','watch','play','ver','▶',
            'demo','sample','amostra','exibir','mostrar','abrir',
            'video','vídeo','clip','show','detail','ver más','ver mais'
        ];

        const PALAVRAS_CLASSE = [
            'preview','btn-preview','play','video','watch',
            'modal-btn','open-modal','btn-video','btn-play'
        ];

        const ATTRS_PREVIEW = [
            'data-toggle','data-target','data-bs-toggle','data-bs-target',
            'data-modal','data-preview','data-video','data-src'
        ];

        const todos = Array.from(document.querySelectorAll(
            'a, button, [role=button], [onclick], .btn, [class*="btn"]'
        ));

        const candidatos = [];

        for (const el of todos) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;

            const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
            const cls = (el.className || '').toString().toLowerCase();
            const onclick = (el.getAttribute('onclick') || '').toLowerCase();
            const href = (el.getAttribute('href') || '').toLowerCase();

            let bate = false;

            // 1) Texto — match EXATO preferido pra "preview"
            if (txt) {
                if (txt === 'preview' || txt === 'ver' || txt === 'ver video'
                    || txt === 'assistir' || txt === 'watch' || txt === 'play') {
                    bate = true;
                } else if (txt.length <= 40) {
                    if (PALAVRAS_TEXTO.some(p => txt.includes(p))) bate = true;
                }
            }

            // 2) Classe
            if (!bate && cls) {
                if (PALAVRAS_CLASSE.some(p => cls.includes(p))) bate = true;
            }

            // 3) Atributos de modal
            if (!bate) {
                for (const a of ATTRS_PREVIEW) {
                    const v = el.getAttribute(a);
                    if (v) {
                        const lv = v.toLowerCase();
                        if (lv.includes('modal') || lv.includes('preview') ||
                            lv.includes('video') || lv.includes('play')) {
                            bate = true;
                            break;
                        }
                    }
                }
            }

            // 4) onclick com função de modal
            if (!bate && onclick) {
                if (/showmodal|openmodal|abrirmodal|preview|playvideo|showvideo|mostrarvideo|openvideo/i.test(onclick)) {
                    bate = true;
                }
            }

            // 5) href âncora tipo #video, #preview, #modal
            if (!bate && href) {
                if (/^#(video|preview|modal|play)/.test(href)) {
                    bate = true;
                }
            }

            if (!bate) continue;

            // Evita pai/filho duplicado
            let filhoBate = false;
            for (const c of el.querySelectorAll('a, button, [role=button]')) {
                const ct = (c.innerText || '').trim().toLowerCase();
                const cc = (c.className || '').toString().toLowerCase();
                if ((ct && PALAVRAS_TEXTO.some(p => ct.includes(p))) ||
                    (cc && PALAVRAS_CLASSE.some(p => cc.includes(p)))) {
                    filhoBate = true;
                    break;
                }
            }
            if (filhoBate) continue;

            candidatos.push(el);
        }

        candidatos.forEach((el, i) =>
            el.setAttribute('data-__preview-idx', String(i)));

        return candidatos.length;
    }
    """
    return page.evaluate(js)



# ============================================================
# V4.3 — PLANO B: detecção por cartões + overlays + diagnóstico
# ============================================================
def dispensar_overlays(page):
    """Fecha avisos de idade/cookies/entrada que tapam o catálogo."""
    js = r"""
    () => {
        const re = /^(enter|enter site|entrar|sim|yes|i am 18\+?|i'm 18\+?|tenho 18.*|accept|accept all|aceitar|aceitar tudo|ok|okay|continue|continuar|agree|i agree|concordo|got it|entendi|let's go|start|come[cç]ar)$/i;
        for (const el of document.querySelectorAll('button, a, [role=button]')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const t = (el.innerText || '').trim();
            if (t.length > 30 || !re.test(t)) continue;
            el.click();
            return t;
        }
        return '';
    }
    """
    for _ in range(3):
        try:
            clicado = page.evaluate(js)
        except Exception:
            return
        if not clicado:
            return
        log.info(f"🚪 Fechei/entrei em overlay: '{clicado}'")
        time.sleep(1.5)


def marcar_por_cartoes(page):
    """Plano B: acha cada produto pelo PREÇO e escolhe o alvo do clique
    (botão com texto/aria/ícone de play, ou a miniatura, ou o próprio cartão)."""
    js = r"""
    () => {
        document.querySelectorAll('[data-__preview-idx]').forEach(e =>
            e.removeAttribute('data-__preview-idx'));
        const PRECO = /[$€£]\s?\d|\d\s?(usd|eur|mt|mzn|brl)\b|R\$\s?\d/gi;
        const visivel = el => {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            return r.width > 0 && r.height > 0 &&
                   st.display !== 'none' && st.visibility !== 'hidden';
        };
        const nPreco = el => ((el.innerText || '').match(PRECO) || []).length;
        const RAIZ = new Set(['BODY', 'HTML']);

        const cartoes = [];
        document.querySelectorAll('div, li, article, section, a').forEach(el => {
            if (!visivel(el) || RAIZ.has(el.tagName) || el.id === 'root') return;
            if (nPreco(el) !== 1) return;
            if ((el.innerText || '').length > 1500) return;
            const pai = el.parentElement;
            if (pai && !RAIZ.has(pai.tagName) && pai.id !== 'root' && nPreco(pai) === 1) return;
            cartoes.push(el);
        });

        const EXCLUI = /buy|comprar|checkout|cart|carrinho|pay|pagar|whatsapp|telegram|order|pedir/i;
        const PAL = /(\bpreview\b|\bassistir\b|\bwatch\b|\bplay\b|\bver\b|\bdemo\b|video|vídeo|sample|amostra)/i;
        const alvos = [];
        for (const card of cartoes) {
            const clic = Array.from(card.querySelectorAll(
                'button, a, [role=button], [onclick], [tabindex]')).filter(visivel);
            const desc = el => ((el.innerText || '') + ' ' +
                (el.getAttribute('aria-label') || '') + ' ' +
                (el.getAttribute('title') || '') + ' ' +
                (el.className || '').toString() + ' ' +
                (el.innerHTML.match(/lucide-[a-z-]+/g) || []).join(' ')).toLowerCase();
            let alvo = clic.find(el => !EXCLUI.test(el.innerText || '') &&
                (PAL.test(desc(el)) || /lucide-(play|eye|video|film)/.test(desc(el))));
            if (!alvo) {
                const midia = Array.from(card.querySelectorAll(
                    'img, video, [class*=thumb], [class*=cover]')).filter(visivel);
                alvo = midia.find(el => getComputedStyle(el).cursor === 'pointer') || midia[0];
            }
            if (!alvo) alvo = clic.find(el => !EXCLUI.test(el.innerText || ''));
            if (!alvo) alvo = card;
            if (!alvos.includes(alvo)) alvos.push(alvo);
        }
        alvos.forEach((el, i) => el.setAttribute('data-__preview-idx', String(i)));
        return alvos.length;
    }
    """
    return page.evaluate(js)


def diagnostico(page):
    """Mostra o que o bot está vendo quando não acha nada."""
    try:
        os.makedirs(PASTA_DEBUG, exist_ok=True)
        page.screenshot(path=os.path.join(PASTA_DEBUG, "pagina.png"), full_page=True)
        info = page.evaluate(r"""
        () => ({
            url: location.href,
            titulo: document.title,
            precos: ((document.body.innerText.match(/[$€£]\s?\d/g)) || []).length,
            videos: document.querySelectorAll('video').length,
            imgs: document.querySelectorAll('img').length,
            botoes: document.querySelectorAll('button, [role=button], a').length,
            iframes: document.querySelectorAll('iframe').length,
            texto: document.body.innerText.slice(0, 1200),
        })
        """)
        print("\n" + "=" * 60)
        print("🩺 DIAGNÓSTICO (o que o bot está vendo)")
        print("=" * 60)
        for k in ("url", "titulo", "precos", "videos", "imgs", "botoes", "iframes"):
            print(f"{k:8}: {info[k]}")
        print("--- texto visível (início) ---")
        print(info["texto"] or "(VAZIO — a página não renderizou ou está bloqueada)")
        print("=" * 60)
        print(f"📸 Screenshot: {PASTA_DEBUG}/pagina.png  (me manda esse print + este texto)\n")
    except Exception as e:
        log.warning(f"diagnóstico falhou: {e}")


# ============================================================
# EXTRAIR DADOS DO PRODUTO
# ============================================================
def extrair_dados_do_produto(page, idx):
    js = f"""
    () => {{
        const btn = document.querySelector('[data-__preview-idx="{idx}"]');
        if (!btn) return null;

        let node = btn;
        let container = null;
        for (let i = 0; i < 12 && node; i++) {{
            const t = (node.innerText || '');
            if (/[$€£R]\\s?\\d/.test(t) && t.length < 3000) {{
                container = node;
                break;
            }}
            node = node.parentElement;
        }}
        if (!container) container = btn.parentElement;

        const texto = (container.innerText || '')
            .split('\\n')
            .map(s => s.trim())
            .filter(Boolean);
        return {{ texto }};
    }}
    """
    return page.evaluate(js)


PALAVRAS_PREVIEW = (
    "preview", "assistir", "watch", "play", "▶", "ver",
    "demo", "sample", "video", "vídeo", "clip", "buy", "comprar",
)


def parse_produto_do_texto(linhas):
    if not linhas:
        return "", "", ""

    idx_preco = -1
    preco = ""
    for i, l in enumerate(linhas):
        p = extrair_preco(l)
        if p and idx_preco == -1:
            preco = p
            idx_preco = i

    if idx_preco == -1:
        titulo = linhas[0] if linhas else ""
        desc = " | ".join(linhas[1:4])
        return titulo, "", desc

    titulo = ""
    for l in reversed(linhas[:idx_preco]):
        if len(l) >= 3:
            titulo = l
            break

    desc_linhas = []
    for l in linhas[idx_preco + 1:]:
        low = l.lower()
        if any(p in low for p in PALAVRAS_PREVIEW):
            break
        if extrair_preco(l):
            continue
        if l == titulo:
            continue
        desc_linhas.append(l)

    descricao = " | ".join(desc_linhas[:3])
    return titulo, preco, descricao


# ============================================================
# INSPECIONAR
# ============================================================
def inspecionar_botoes(page):
    js = r"""
    () => {
        const out = [];
        const todos = document.querySelectorAll(
            'a, button, [role=button], [onclick], .btn, [class*="btn"]'
        );
        todos.forEach((el) => {
            const rect = el.getBoundingClientRect();
            const visivel = rect.width > 0 && rect.height > 0;
            const txt = (el.innerText || el.textContent || '').trim().slice(0, 60);
            const cls = (el.className || '').toString().slice(0, 100);
            const href = (el.getAttribute('href') || '').slice(0, 100);
            const onclick = (el.getAttribute('onclick') || '').slice(0, 100);
            const testid = el.getAttribute('data-testid') || '';
            const aria = el.getAttribute('aria-label') || '';
            out.push({ visivel, tag: el.tagName, txt, cls, href, onclick, testid, aria });
        });
        return out;
    }
    """
    return page.evaluate(js)


# ============================================================
# INTERCEPTAÇÃO DE REDE
# ============================================================
EXTS_MIDIA = (".mp4", ".m4v", ".webm", ".mov", ".mkv", ".avi", ".flv",
              ".m3u8", ".mpd", ".ts")
DOMINIOS_EMBED = (
    "youtube.com", "youtu.be", "vimeo.com", "dailymotion.com",
    "streamable.com", "streamtape", "dood", "mixdrop", "vidoza",
    "filemoon", "vidhide", "catbox.moe", "pixeldrain", "gofile",
)


def ext_midia(url):
    """True só se o CAMINHO da URL termina em extensão de vídeo (ignora ?query)."""
    try:
        return urlparse(url).path.lower().endswith(EXTS_MIDIA)
    except Exception:
        return False


def escolher_video(urls):
    """Escolhe a melhor URL: m3u8/mpd > mp4/webm/... > segmentos .ts."""
    uniq = list(dict.fromkeys(urls))
    if not uniq:
        return ""
    for ext in (".m3u8", ".mpd"):
        for u in reversed(uniq):
            if urlparse(u).path.lower().endswith(ext):
                return u
    for u in reversed(uniq):
        if not urlparse(u).path.lower().endswith(".ts"):
            return u
    return uniq[-1]


def instalar_interceptador(page, capturados):
    """Captura só mídia REAL: tipo 'media', content-type video/*, ou extensão no caminho.
    (A versão antiga pegava qualquer URL com 'preview'/'player'/'stream' — inclusive
    arquivos .js do modal — e isso escondia o vídeo verdadeiro.)"""
    def on_request(req):
        try:
            u = req.url
            if u.startswith(("data:", "blob:")):
                return
            if req.resource_type == "media" or ext_midia(u):
                capturados.append(u)
        except Exception:
            pass

    def on_response(resp):
        try:
            u = resp.url
            if u.startswith(("data:", "blob:")):
                return
            ct = (resp.headers.get("content-type") or "").lower()
            if (ct.startswith("video/") or "mpegurl" in ct
                    or "dash+xml" in ct or resp.request.resource_type == "media"):
                capturados.append(u)
        except Exception:
            pass

    page.on("request", on_request)
    page.on("response", on_response)


def forcar_play(page):
    """Alguns players só pedem o vídeo quando começam a tocar."""
    try:
        page.evaluate(
            "document.querySelectorAll('video').forEach(v => {"
            " v.muted = true; const p = v.play(); if (p && p.catch) p.catch(() => {}); })"
        )
    except Exception:
        pass


def esperar_video(page, capturados, max_s=8.0):
    inicio = time.time()
    forcou = False
    while time.time() - inicio < max_s:
        time.sleep(0.5)
        dec = time.time() - inicio
        if not forcou and dec > 1.5:
            forcar_play(page)
            forcou = True
        if capturados and dec > 1.0:
            return


def buscar_video_no_dom(page, n0=0):
    """Fallback: <video> visível (currentSrc), <source>, requisições novas
    (performance), iframes, shadow DOM e iframes de mesma origem."""
    js = r"""
    (n0) => {
        const ok = s => s && /^https?:/i.test(s);
        const visivel = el => {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            return r.width > 0 && r.height > 0 &&
                   st.display !== 'none' && st.visibility !== 'hidden';
        };
        const out = {visiveis: [], novos: [], outros: [], iframes: [], blobs: 0};
        const vasculhar = root => {
            root.querySelectorAll('video').forEach(v => {
                const srcs = [v.currentSrc, v.src, v.getAttribute('src'),
                              v.getAttribute('data-src')];
                v.querySelectorAll('source').forEach(s =>
                    srcs.push(s.src, s.getAttribute('src')));
                srcs.forEach(s => {
                    if (s && /^blob:/i.test(s)) out.blobs++;
                    if (ok(s)) (visivel(v) ? out.visiveis : out.outros).push(s);
                });
            });
            root.querySelectorAll('a[href]').forEach(a => {
                if (ok(a.href)) out.outros.push(a.href);
            });
            root.querySelectorAll('iframe').forEach(f => {
                if (ok(f.src)) out.iframes.push(f.src);
                try { if (f.contentDocument) vasculhar(f.contentDocument); } catch (e) {}
            });
            root.querySelectorAll('*').forEach(el => {
                if (el.shadowRoot) vasculhar(el.shadowRoot);
            });
        };
        vasculhar(document);
        performance.getEntriesByType('resource').slice(n0)
            .forEach(e => out.novos.push(e.name));
        return out;
    }
    """
    try:
        r = page.evaluate(js, n0)
    except Exception:
        return ""
    if r.get("visiveis"):
        return escolher_video(r["visiveis"])
    for grupo in ("novos", "outros"):
        cands = [u for u in r.get(grupo, []) if ext_midia(u)]
        if cands:
            return escolher_video(cands)
    for u in r.get("iframes", []):
        if any(d in u.lower() for d in DOMINIOS_EMBED):
            return u
    if r.get("blobs"):
        log.warning("    ⚠️  o player usa blob: — o link real tem que vir da rede (m3u8/mp4)")
    return ""


# ============================================================
# FECHAR MODAL
# ============================================================
def fechar_modal(page):
    try:
        page.keyboard.press("Escape")
        time.sleep(0.4)
    except Exception:
        pass

    sels = [
        'button[aria-label*="Close" i]',
        'button[aria-label*="Fechar" i]',
        'button[aria-label*="close" i]',
        '.modal-close', '.close', '.btn-close',
        'button:has-text("×")',
        'button:has-text("✕")',
        'button:has-text("Fechar")',
        'button:has-text("Close")',
    ]
    for sel in sels:
        try:
            el = page.query_selector(sel)
            if el and el.is_visible():
                el.click(timeout=1500, force=True)
                time.sleep(0.4)
                return
        except Exception:
            continue


# ============================================================
# ESPERA INTELIGENTE (SPA / React / Lovable)
# ============================================================
def esperar_renderizacao(page):
    """
    Aguarda a página React/Vue montar completamente.
    Estratégia em camadas:
      1) networkidle
      2) wait_for_function procurando 'Preview' + '$' no body
      3) sleep de segurança
      4) scroll até o fim (força lazy-load)
      5) wait_for_function procurando botão 'Preview' no DOM
    """
    log.info("⏳ Esperando renderização (SPA)…")

    # 1) Rede parar
    try:
        page.wait_for_load_state("networkidle", timeout=20000)
    except Exception:
        pass

    # 2) Espera aparecer "preview" + "$" no body
    try:
        page.wait_for_function(r"""
        () => {
            const t = document.body.innerText.toLowerCase();
            const temPreview = t.includes('preview')
                || t.includes('assistir')
                || t.includes('watch')
                || t.includes('play')
                || t.includes('ver ');
            const temPreco = /\$\s?\d/.test(document.body.innerText);
            return temPreco || (temPreview && document.body.innerText.length > 300);
        }
        """, timeout=20000)
        log.info("✅ Página renderizou ($ ou Preview detectados)")
    except Exception:
        log.warning("⚠️  Timeout esperando Preview+$ — continuando mesmo assim")

    # 3) Segurança
    time.sleep(3)

    # 4) Scroll total (força lazy-load)
    try:
        page.evaluate("""
        async () => {
            await new Promise(resolve => {
                let total = 0;
                const timer = setInterval(() => {
                    window.scrollBy(0, 800);
                    total += 800;
                    if (total >= document.body.scrollHeight + 800) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 180);
            });
        }
        """)
        time.sleep(2)
        page.evaluate("window.scrollTo(0, 0)")
        time.sleep(1)
    except Exception:
        pass

    # 5) Última espera: botão "Preview" no DOM
    try:
        page.wait_for_function(r"""
        () => {
            const btns = Array.from(document.querySelectorAll('button, a'));
            return btns.some(b => {
                const t = (b.innerText || b.textContent || '').trim().toLowerCase();
                return t === 'preview' || t.includes('preview');
            });
        }
        """, timeout=6000)
        log.info("✅ Botões 'Preview' no DOM")
    except Exception:
        log.warning("⚠️  Botões 'Preview' não apareceram — continuando")


# ============================================================
# FLUXO PRINCIPAL
# ============================================================
def extrair(url, headful=False, debug=False, inspecionar=False, screenshots=False,
           usar_chrome=False):
    url = limpar_url(url)

    produtos = []
    vistos = set()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=not headful,
            channel="chrome" if usar_chrome else None,  # Chrome real tem codec H.264
            args=["--autoplay-policy=no-user-gesture-required"],
        )
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0 Safari/537.36"
            ),
            viewport={"width": 1366, "height": 900},
            locale="pt-BR",
        )
        page = context.new_page()
        capturados_globais = []
        instalar_interceptador(page, capturados_globais)
        # se o Preview abrir em nova aba/popup, captura lá também
        context.on("page", lambda np_: instalar_interceptador(np_, capturados_globais))

        log.info(f"🌐 Abrindo {url}")
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
        except Exception as e:
            log.warning(f"⚠️  goto: {e}")

        # ============ ESPERA INTELIGENTE ============
        esperar_renderizacao(page)
        dispensar_overlays(page)

        # Debug: salva HTML
        if debug:
            os.makedirs(PASTA_DEBUG, exist_ok=True)
            with open(os.path.join(PASTA_DEBUG, "pagina_renderizada.html"),
                      "w", encoding="utf-8") as f:
                f.write(page.content())
            log.info(f"💾 HTML salvo em {PASTA_DEBUG}/pagina_renderizada.html")

        # Modo inspecionar
        if inspecionar:
            log.info("🔍 Modo inspeção — listando botões/links...")
            botoes = inspecionar_botoes(page)
            print("\n" + "=" * 75)
            print(f"ENCONTRADOS {len(botoes)} ELEMENTOS")
            print("=" * 75)
            for i, b in enumerate(botoes):
                flag = "✓" if b["visivel"] else "✗"
                print(f"[{i:3d}]{flag} <{b['tag']}>  txt='{b['txt']}'")
                if b["cls"]:     print(f"       class='{b['cls']}'")
                if b["href"]:    print(f"       href='{b['href']}'")
                if b["onclick"]: print(f"       onclick='{b['onclick']}'")
                if b["testid"]:  print(f"       data-testid='{b['testid']}'")
                if b["aria"]:    print(f"       aria-label='{b['aria']}'")
            print("=" * 75 + "\n")
            browser.close()
            return []

        # Marca botões
        total = marcar_botoes_preview(page)
        log.info(f"🔎 {total} botões de Preview encontrados")
        if total == 0:
            log.info("🔁 Plano B: procurando por cartões de produto (preço)…")
            total = marcar_por_cartoes(page)
            log.info(f"🔎 {total} produtos encontrados pelo preço")

        if total == 0:
            log.warning("⚠️  Nenhum botão de Preview encontrado.")
            diagnostico(page)
            log.warning("💡 Rode com --inspecionar pra ver os botões deste site.")
            browser.close()
            return []

        if screenshots:
            os.makedirs(os.path.join(PASTA_DEBUG, "screenshots"), exist_ok=True)

        for i in range(total):
            log.info(f"  → Produto {i+1}/{total}")

            dados = extrair_dados_do_produto(page, i)
            if not dados:
                continue
            titulo, preco, descricao = parse_produto_do_texto(dados["texto"])

            capturados_globais.clear()
            try:
                n0 = page.evaluate("performance.getEntriesByType('resource').length")
            except Exception:
                n0 = 0

            # Clica
            try:
                btn = page.query_selector(f'[data-__preview-idx="{i}"]')
                if not btn:
                    continue
                btn.scroll_into_view_if_needed()
                time.sleep(0.25)
                btn.click(timeout=5000, force=True)
                esperar_video(page, capturados_globais)
            except Exception as e:
                log.warning(f"    ⚠️  clique falhou: {e}")

            if screenshots:
                try:
                    page.screenshot(
                        path=os.path.join(PASTA_DEBUG, "screenshots", f"{i+1:02d}.png"),
                        full_page=False,
                    )
                except Exception:
                    pass

            # Vídeo: rede primeiro, depois popup, depois DOM
            video = escolher_video(capturados_globais)
            extras = [p for p in context.pages if p != page]
            if not video:
                for ex in extras:
                    if ext_midia(ex.url):
                        video = ex.url
                        break
            if not video:
                video = buscar_video_no_dom(page, n0)
            if not video:
                for ex in extras:
                    video = buscar_video_no_dom(ex, 0)
                    if video:
                        break
            if debug:
                log.info(f"    🧪 rede capturou: {capturados_globais[-5:]}")

            if video and not video.startswith("http"):
                video = urljoin(url, video)

            # Deduplicação
            titulo_norm = limpar_texto(titulo).lower()
            video_norm = (video or "").strip().lower()
            chave = (titulo_norm, video_norm)

            if titulo_norm and video_norm and chave in vistos:
                log.info(f"    ⏭️  duplicado (título+vídeo): {titulo}")
            elif not video and not titulo:
                log.info(f"    ⏭️  vazio")
            else:
                vistos.add(chave)
                produtos.append({
                    "title": titulo or "SEM TITULO",
                    "video": video,
                    "desc": descricao,
                })
                log.info(f"    ✅ {titulo} → {video or '(sem vídeo)'}")

            fechar_modal(page)
            for ex in [p for p in context.pages if p != page]:
                try:
                    ex.close()
                except Exception:
                    pass

        browser.close()

    # Deduplicação extra por vídeo
    vistos_video = set()
    final = []
    for p in produtos:
        v = (p["video"] or "").strip().lower()
        if v and v in vistos_video:
            log.info(f"    ⏭️  vídeo repetido: {p['title']}")
            continue
        if v:
            vistos_video.add(v)
        final.append(p)

    return final


# ============================================================
# VIEWS ALEATÓRIOS ÚNICOS
# ============================================================
def gerar_views_unicos(total, minimo=100, maximo=500):
    disponiveis = maximo - minimo + 1
    if total <= disponiveis:
        return random.sample(range(minimo, maximo + 1), total)
    return [random.randint(minimo, maximo) for _ in range(total)]


# ============================================================
# GERAR .js
# ============================================================
TEMPLATE = """  {{
    title: "{title}",
    video: "{video}",
    desc: "{desc}",
    chips: {chips},
    badges: {badges},
    proof: {proof},
    proofCaption: "{proof_caption}",
    freeLink: "{free_link}",
    // =====================================================
    // PRODUCT {idx} OF {total}
    // =====================================================
    views: {views},
  }},"""


def gerar_js(produtos, nome_site):
    total = len(produtos)
    views_lista = gerar_views_unicos(total)

    blocos = []
    for i, p in enumerate(produtos):
        blocos.append(TEMPLATE.format(
            title=escape_js(p["title"]),
            video=escape_js(p["video"]),
            desc=escape_js(p["desc"]),
            chips=CHIPS_JS,
            badges=BADGES_JS,
            proof=PROOF_JS,
            proof_caption=PROOF_CAPTION,
            free_link=FREE_LINK,
            idx=i + 1,
            total=total,
            views=views_lista[i],
        ))
    corpo = "\n".join(blocos)

    return f"""// =====================================================
// 🎬 CATÁLOGO GERADO AUTOMATICAMENTE
// Site: {nome_site}
// Total de produtos: {total}
// =====================================================

const products = [
{corpo}
];
"""


# ============================================================
# MAIN
# ============================================================
def main():
    if len(sys.argv) < 3:
        print("""
🎬 EXTRATOR DE CATÁLOGO — V4.1

Uso:
    python videos.py "https://site.com/catalogo" nome_site
    python videos.py "https://site.com/catalogo" nome_site --headful
    python videos.py "https://site.com/catalogo" nome_site --debug
    python videos.py "https://site.com/catalogo" nome_site --inspecionar
    python videos.py "https://site.com/catalogo" nome_site --screenshots

Flags:
    --headful      → mostra o navegador
    --debug        → salva HTML renderizado em debug/
    --inspecionar  → lista botões da página (pra descobrir padrão)
    --screenshots  → tira print de cada modal aberto
    --chrome       → usa o Google Chrome instalado (suporta mp4 H.264)
""")
        return

    url = sys.argv[1]
    nome_site = sys.argv[2]
    headful = "--headful" in sys.argv
    debug = "--debug" in sys.argv
    inspecionar = "--inspecionar" in sys.argv
    screenshots = "--screenshots" in sys.argv
    usar_chrome = "--chrome" in sys.argv

    os.makedirs(PASTA_SAIDA, exist_ok=True)

    produtos = extrair(
        url,
        headful=headful,
        debug=debug,
        inspecionar=inspecionar,
        screenshots=screenshots,
        usar_chrome=usar_chrome,
    )

    if inspecionar:
        return

    if not produtos:
        log.warning("⚠️  Nenhum produto extraído.")
        log.warning("💡 Dica: rode com --inspecionar --headful pra ver os botões.")
        return

    print("\n" + "=" * 60)
    for i, p in enumerate(produtos, 1):
        print(f"{i:2d}. {p['title']}")
        print(f"    desc: {p['desc'][:70]}")
        print(f"    video: {p['video']}")
    print("=" * 60 + "\n")
    print(f"📊 Total único: {len(produtos)} produtos\n")

    js = gerar_js(produtos, nome_site)
    caminho = os.path.join(PASTA_SAIDA, f"catalogo_{nome_site}.js")
    with open(caminho, "w", encoding="utf-8") as f:
        f.write(js)

    print(f"✅ Arquivo gerado: {caminho}")
    print(f"📋 Copie o conteúdo pra dentro do seu index.html\n")


if __name__ == "__main__":
    main()