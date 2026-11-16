// scrape-products-v2.js
// Extrai produtos do site e gera o array products[] para o app.js
// NÃO baixa nada — coloca os links directos dos vídeos/imagens
// Uso: node scrape-products-v2.js <URL> [PASTA_OUTPUT]

const puppeteer = require('puppeteer-core');
const axios     = require('axios');
const fs        = require('fs').promises;
const path      = require('path');

// ============================================================
// CONFIG
// ============================================================
const CFG = {
    chromeApi   : 'http://localhost:9222/json/version',
    maxWaitMs   : 35000,
    pollMs      : 800,
    stableRounds: 3,
    scrollPause : 400,
    postScroll  : 3000,
    UA: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

// Badge pool — cada card recebe badges diferentes e variadas
const BADGE_POOL = [
    [{ label: "🔥 HOT",        cls: "hot"       }, { label: "NEW",          cls: "new"        }],
    [{ label: "⭐ TOP SELLER", cls: "bestseller" }, { label: "💎 PREMIUM",   cls: "premium"    }],
    [{ label: "🚀 TRENDING",   cls: "hot"       }, { label: "✅ VERIFIED",   cls: "new"        }],
    [{ label: "💥 EXCLUSIVE",  cls: "hot"       }, { label: "🔑 VIP",        cls: "premium"    }],
    [{ label: "⚡ INSTANT",    cls: "new"       }, { label: "🏆 BEST VALUE", cls: "bestseller" }],
    [{ label: "🌟 FEATURED",   cls: "premium"   }, { label: "🔥 HOT",        cls: "hot"        }],
    [{ label: "💎 VIP",        cls: "premium"   }, { label: "🚀 NEW DROP",   cls: "new"        }],
    [{ label: "🎯 POPULAR",    cls: "bestseller"}, { label: "⚡ FAST",        cls: "hot"        }],
];

// Chip pool — cada card recebe chips diferentes
const CHIP_POOL = [
    ["7GB+",  "HOT",      "2025"],
    ["15GB+", "PREMIUM",  "VIP"],
    ["10GB+", "NOVO",     "EXCLUSIVO"],
    ["20GB+", "TOP",      "2026"],
    ["5GB+",  "TRENDING", "FRESH"],
    ["8GB+",  "VERIFIED", "INSTANT"],
    ["12GB+", "FEATURED", "BEST"],
    ["25GB+", "VIP",      "POPULAR"],
];

// ============================================================
// LOG
// ============================================================
const C = { r:'\x1b[0m', c:'\x1b[36m', g:'\x1b[32m', e:'\x1b[31m', y:'\x1b[33m', b:'\x1b[34m', m:'\x1b[35m' };
function log(msg, t='info') {
    const M = { info:[C.c,'ℹ️ '], success:[C.g,'✅ '], error:[C.e,'❌ '], warn:[C.y,'⚠️ '], found:[C.m,'🎯 '] };
    const [col, ic] = M[t] || M.info;
    console.log(`${col}${ic}${msg}${C.r}`);
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function fmt(b) { const k=1024,s=['B','KB','MB','GB'],i=Math.floor(Math.log(b||1)/Math.log(k)); return(b/Math.pow(k,i)).toFixed(1)+' '+s[i]; }

// ============================================================
// CHROME
// ============================================================
async function connectChrome() {
    log('Conectando ao Chrome...');
    try {
        const r = await axios.get(CFG.chromeApi, { timeout: 5000 });
        const ws = r.data.webSocketDebuggerUrl;
        if (!ws) throw new Error('WebSocket URL não encontrada');
        log('Chrome conectado!', 'success');
        return ws;
    } catch (e) {
        log(`Chrome não responde: ${e.message}`, 'error');
        console.log('\n  start "" "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\\chrome-bot"\n');
        process.exit(1);
    }
}

// ============================================================
// NAVEGAR
// ============================================================
async function navigatePage(page, url) {
    log(`Navegando para ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    log('Aguardando conteúdo...');
    let finalUrl = page.url(), htmlSize = 0, stable = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < CFG.maxWaitMs) {
        await delay(CFG.pollMs);
        const curUrl  = page.url();
        const curHtml = await page.content();
        const curSize = curHtml.length;
        if (curUrl !== finalUrl) { log(`Redirect → ${curUrl}`); finalUrl = curUrl; stable = 0; htmlSize = curSize; continue; }
        if (curSize > htmlSize + 500) { htmlSize = curSize; stable = 0; continue; }
        if (curSize > 5000) { stable++; if (stable >= CFG.stableRounds) { log(`Página estável (${fmt(curSize)})`, 'success'); break; } }
    }

    // Scroll para activar lazy-load
    log('Scroll para lazy-load...');
    await page.evaluate(async (pause) => {
        await new Promise(res => {
            let y = 0;
            const iv = setInterval(() => {
                window.scrollBy(0, 300); y += 300;
                if (y >= document.body.scrollHeight) { clearInterval(iv); window.scrollTo(0,0); res(); }
            }, pause);
        });
    }, CFG.scrollPause);
    await delay(CFG.postScroll);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(800);

    return page.url();
}

// ============================================================
// EXTRAIR PRODUTOS — pega links directos, não baixa nada
// ============================================================
async function extractProducts(page, baseUrl) {
    log('Extraindo produtos...');

    const raw = await page.evaluate((base) => {

        function absUrl(src) {
            if (!src) return '';
            src = src.trim();
            if (src.startsWith('data:') || src.startsWith('blob:')) return '';
            if (src.startsWith('//')) return 'https:' + src;
            try { return new URL(src, base).href; } catch { return src; }
        }

        function cleanText(txt) {
            if (!txt) return '';
            return txt.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        }

        // Normaliza texto para comparação (minúsculas, sem pontuação/espaços extra)
        function normalize(txt) {
            return cleanText(txt).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
        }

        // ── Pega o link directo do vídeo (URL completa) ──
        function getVideoUrl(el) {
            const vid = el.querySelector('video');
            if (vid) {
                const src = vid.getAttribute('src') || vid.currentSrc;
                if (src && !src.startsWith('blob:') && !src.startsWith('data:')) return absUrl(src);
                const source = vid.querySelector('source[src]');
                if (source) { const s = source.getAttribute('src'); if (s && !s.startsWith('blob:')) return absUrl(s); }
            }

            const videoAttrs = ['data-src','data-video','data-url','data-file','data-mp4','data-source'];
            const allEls = el.querySelectorAll('*');
            for (const e of allEls) {
                for (const attr of videoAttrs) {
                    const v = e.getAttribute(attr) || '';
                    if (v && /\.(mp4|webm|ogg|m4v|mov)/i.test(v)) return absUrl(v);
                }
                for (const attr of e.attributes || []) {
                    if (/\.(mp4|webm|ogg|m4v|mov)/i.test(attr.value || '')) return absUrl(attr.value);
                }
            }

            const html = el.innerHTML || '';
            const mp4Match = html.match(/https?:\/\/[^\s"'<>]+\.(mp4|webm|ogg|m4v|mov)[^\s"'<>]*/i);
            if (mp4Match) return mp4Match[0].split('"')[0].split("'")[0];

            return '';
        }

        // ── Pega o link directo da imagem ──
        function getImageUrl(el) {
            const imgs = el.querySelectorAll('img');
            for (const img of imgs) {
                const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy') || img.getAttribute('data-original');
                if (!src || src.startsWith('data:')) continue;
                const abs = absUrl(src);
                if (/icon|logo|avatar|spinner|loading|placeholder/i.test(abs)) continue;
                if (img.naturalWidth > 0 && img.naturalWidth < 30) continue;
                return abs;
            }
            const allEls = el.querySelectorAll('*');
            for (const e of allEls) {
                const style = window.getComputedStyle(e).backgroundImage || e.getAttribute('style') || '';
                const m = style.match(/url\(['"]?(https?[^'"()]+)['"]?\)/);
                if (m && m[1] && !/icon|logo|placeholder/i.test(m[1])) return m[1];
            }
            return '';
        }

        // ── Título do card ──
        // Guarda também o elemento DOM que gerou o título, para poder
        // excluí-lo explicitamente na procura da descrição.
        function getTitle(el) {
            const sels = [
                '.card-title','.product-title','.item-title','.title',
                '[class*="card-title"]','[class*="product-title"]','[class*="item-title"]',
                'h1','h2','h3','h4',
                '[class*="title"]','[class*="heading"]','[class*="name"]',
            ];
            for (const s of sels) {
                const t = el.querySelector(s);
                if (t) {
                    const txt = cleanText(t.textContent);
                    if (txt.length >= 2) return { text: txt, node: t };
                }
            }
            return { text: '', node: null };
        }

        // ── Descrição formatada com <br> ──
        // titleInfo = { text, node } vindo de getTitle, usado para NUNCA
        // devolver o próprio título como se fosse descrição.
        function getDesc(el, titleInfo) {
            const titleNorm = normalize(titleInfo.text);

            // Helper: um candidato só é válido se:
            //  - não é o mesmo nó do título
            //  - não está contido dentro do nó do título (nem o contém)
            //  - o texto normalizado não é igual/quase igual ao título
            //  - tem um mínimo de "substância" (várias palavras ou várias linhas)
            function isValidDescNode(node, txt) {
                if (!node || !txt) return false;
                if (titleInfo.node) {
                    if (node === titleInfo.node) return false;
                    if (titleInfo.node.contains(node)) return false;
                    if (node.contains(titleInfo.node)) return false;
                }
                const norm = normalize(txt);
                if (!norm) return false;
                if (norm === titleNorm) return false;
                // Se o candidato é basicamente o título com 1-2 chars a mais/menos, rejeita
                if (titleNorm && (norm.includes(titleNorm) && norm.length < titleNorm.length + 6)) return false;
                // Precisa de "cara" de descrição: pelo menos 3 palavras OU 2+ linhas
                const wordCount = cleanText(txt).split(/\s+/).filter(Boolean).length;
                const lineCount = (node.innerHTML || '').split(/<br\s*\/?>|<li[^>]*>/i).filter(l => cleanText(l).length > 1).length;
                if (wordCount < 3 && lineCount < 2) return false;
                return true;
            }

            function htmlToDescFormat(node) {
                let html = node.innerHTML || '';
                html = html.replace(/<li[^>]*>/gi, '* ').replace(/<\/li>/gi, '<br>');
                html = html.replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '<br>');
                html = html.replace(/<(?!br\s*\/?)[^>]+>/gi, '');
                html = html.replace(/&nbsp;/gi, ' ').replace(/\s*<br\s*\/?>\s*/gi, '<br>').trim();
                html = html.replace(/^(<br>)+|(<br>)+$/gi, '').trim();
                return html;
            }

            // 1. Selectores explícitos de descrição — o caso mais fiável
            const sels = [
                '.card-desc','.product-desc','.description','.desc',
                '[class*="card-desc"]','[class*="product-desc"]',
                '[class*="desc"]','[class*="detail"]','[class*="info"]',
                '[class*="feature"]','[class*="content-list"]',
            ];
            for (const s of sels) {
                const candidates = el.querySelectorAll(s);
                for (const d of candidates) {
                    const rawTxt = cleanText(d.innerText || d.textContent || '');
                    if (!isValidDescNode(d, rawTxt)) continue;
                    const formatted = htmlToDescFormat(d);
                    if (formatted.length > 3) return formatted;
                }
            }

            // 2. Fallback: procura <p>, <ul>, <ol> dentro do card, mas
            //    validando cada um contra o título — nunca aceita o primeiro
            //    às cegas.
            const fallbackEls = el.querySelectorAll('p, ul, ol');
            for (const node of fallbackEls) {
                const rawTxt = cleanText(node.innerText || node.textContent || '');
                if (!isValidDescNode(node, rawTxt)) continue;
                if (node.tagName === 'UL' || node.tagName === 'OL') {
                    const items = Array.from(node.querySelectorAll('li'))
                        .map(li => cleanText(li.textContent))
                        .filter(Boolean);
                    if (items.length > 0) return items.map(i => '* ' + i).join('<br>');
                }
                return rawTxt.split('\n').filter(Boolean).map(l => '* ' + cleanText(l)).join('<br>');
            }

            // 3. Nada de válido encontrado — devolve vazio para o caller
            //    decidir o fallback genérico (NUNCA o título).
            return '';
        }

        // ── Free link ──
        function getFreeLink(el) {
            const btns = el.querySelectorAll('a[href], button[data-href]');
            for (const b of btns) {
                const txt = cleanText(b.textContent).toLowerCase();
                if (!/(free|grát|gratis|folder|pasta)/i.test(txt)) continue;
                const href = b.getAttribute('href') || b.getAttribute('data-href') || '';
                if (href && href !== '#' && !href.includes('t.me') && !href.includes('telegram')) return absUrl(href);
            }
            return '';
        }

        // ── Views ──
        function getViews(el) {
            const sels = ['[id*="views-"]','[class*="views"]','[class*="view-count"]','[class*="watch"]'];
            for (const s of sels) {
                const v = el.querySelector(s);
                if (v) { const n = parseInt((v.textContent||'').replace(/\D/g,''),10); if (n>0) return n; }
            }
            return 100 + Math.floor(Math.random() * 401); // 100-500
        }

        // ── Encontrar cards ──
        const CARD_SELS = [
            '.product-card','[class*="product-card"]',
            '.card','[class*="item-card"]',
            '[class*="folder-card"]','[class*="video-card"]',
            'article',
        ];
        let cards = [];
        for (const sel of CARD_SELS) {
            const found = document.querySelectorAll(sel);
            if (found.length > 0) { cards = Array.from(found); break; }
        }
        if (cards.length === 0) {
            document.querySelectorAll('video').forEach(v => {
                let p = v.parentElement;
                for (let i=0; i<6 && p; i++, p=p.parentElement) {
                    if (p.querySelectorAll('button, a').length >= 1) { cards.push(p); break; }
                }
            });
        }

        // ── Tenta ler o array products[] global da página (se o app.js o definir) ──
        let globalProducts = null;
        try { if (window.products && Array.isArray(window.products) && window.products.length > 0) globalProducts = window.products; } catch {}

        if (globalProducts) {
            return globalProducts.map(p => ({
                title    : p.title || '',
                video    : p.video ? absUrl(p.video) : '',
                img      : p.img   ? absUrl(p.img)   : '',
                desc     : (p.desc || '').replace(/&nbsp;/gi,' ').replace(/<(?!br\s*\/?)[^>]+>/gi,'').trim(),
                freeLink : p.freeLink || '',
                views    : p.views   || 100 + Math.floor(Math.random()*401),
                _fromGlobal: true,
            }));
        }

        // Extracção pelo DOM
        return cards.map((card, idx) => {
            const titleInfo = getTitle(card);
            return {
                title    : titleInfo.text,
                video    : getVideoUrl(card),
                img      : getImageUrl(card),
                desc     : getDesc(card, titleInfo),
                freeLink : getFreeLink(card),
                views    : getViews(card),
            };
        }).filter(p => p.title || p.video || p.img);

    }, baseUrl);

    log(`${raw.length} produto(s) encontrado(s)`, 'found');
    if (raw.length > 0 && raw[0]._fromGlobal) log('Dados lidos directamente do array products[] global da página', 'success');

    // Aviso extra no terminal para qualquer produto cuja desc ficou vazia
    // (vai cair no fallback genérico do buildProductsArray, nunca no título)
    raw.forEach((p, i) => {
        if (!p.desc || p.desc.trim().length < 3) {
            log(`Produto [${i+1}] "${p.title}" sem descrição própria — vai usar texto genérico de fallback`, 'warn');
        }
    });

    return raw;
}

// ============================================================
// GERAR ARRAY products[] FORMATADO
// ============================================================
function buildProductsArray(rawProducts) {
    return rawProducts.map((p, idx) => {

        const badges = BADGE_POOL[idx % BADGE_POOL.length];

        const chips = p.chips && p.chips.length > 0
            ? p.chips
            : CHIP_POOL[idx % CHIP_POOL.length];

        // Desc: garante formato "* item<br>* item".
        // IMPORTANTE: nunca usa o título como descrição — se p.desc veio
        // vazio da extracção (getDesc devolveu '' explicitamente), usa
        // sempre o texto genérico, nunca p.title.
        let desc = (p.desc || '').trim();
        if (!desc || desc.replace(/<br>/gi,'').trim().length < 3) {
            desc = `* Premium quality content<br>* Instant access for the best experience!<br>* Well-organized files`;
        }
        if (!desc.startsWith('*') && !desc.includes('<br>')) {
            desc = '* ' + desc.replace(/\n/g, '<br>* ');
        }

        // views sempre entre 100 e 500
        const views = (p.views >= 100 && p.views <= 500)
            ? p.views
            : 100 + Math.floor(Math.random() * 401);

        return {
            title      : p.title || `Product ${idx + 1}`,
            video      : p.video || '',
            img        : (!p.video && p.img) ? p.img : undefined,
            desc,
            chips,
            badges,
            proof: [],
            proofCaption: '',
            freeLink   : p.freeLink || '',
            views      : views,
        };
    });
}

// ============================================================
// SERIALIZAR EM FORMATO EXACTO DO app.js
// ============================================================
function serialize(products) {
    const lines = ['const products = ['];

    products.forEach((p, idx) => {
        lines.push(`  {`);
        lines.push(`    title: ${JSON.stringify(p.title)},`);

        if (p.video) {
            lines.push(`    video: ${JSON.stringify(p.video)},`);
        } else if (p.img) {
            lines.push(`    img: ${JSON.stringify(p.img)},`);
        }

        lines.push(`    desc: ${JSON.stringify(p.desc)},`);

        lines.push(`    chips: [${p.chips.map(c => JSON.stringify(c)).join(', ')}],`);

        const badgesStr = p.badges.map(b => `{ label: ${JSON.stringify(b.label)}, cls: ${JSON.stringify(b.cls)} }`).join(', ');
        lines.push(`    badges: [${badgesStr}],`);

        lines.push(`    proof: [],`);
        lines.push(`    proofCaption: "",`);
        lines.push(`    freeLink: "",`);

        lines.push(`    // =====================================================`);
        lines.push(`    // PRODUCT ${idx + 1} OF ${products.length}`);
        lines.push(`    // =====================================================`);

        lines.push(`    views: ${p.views},`);
        lines.push(`  }${idx < products.length - 1 ? ',' : ''}`);
        lines.push('');
    });

    lines.push('];');
    return lines.join('\n');
}

// ============================================================
// MAIN
// ============================================================
async function main() {
    const args   = process.argv.slice(2);
    const URL    = args[0];
    const FOLDER = args[1] || 'extracted';

    if (!URL) {
        console.log('\n❌ USO: node scrape-products-v2.js <URL> [PASTA_OUTPUT]');
        console.log('   node scrape-products-v2.js "https://meusite.com" "minha-pasta"\n');
        process.exit(1);
    }

    const DEST = path.join(process.cwd(), FOLDER);
    await fs.mkdir(DEST, { recursive: true });

    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║  🎯 Scraper de Produtos → app.js  v2    ║');
    console.log('╚══════════════════════════════════════════╝\n');
    log(`URL:   ${URL}`);
    log(`Pasta: ${DEST}`);

    const ws = await connectChrome();
    let browser, page;

    try {
        browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
        page    = await browser.newPage();
        await page.setUserAgent(CFG.UA);

        const finalUrl = await navigatePage(page, URL);
        const raw      = await extractProducts(page, finalUrl);

        if (raw.length === 0) {
            log('Nenhum produto encontrado. Guardando HTML para debug...', 'warn');
            await fs.writeFile(path.join(DEST, 'debug.html'), await page.content());
            log('Abre debug.html no browser e diz qual a classe dos cards', 'warn');
            return;
        }

        const products = buildProductsArray(raw);
        const code = serialize(products);

        console.log('\n' + '─'.repeat(55));
        console.log('📋 RESULTADO — cola no teu app.js:\n');
        console.log(code);
        console.log('─'.repeat(55) + '\n');

        const outFile = path.join(DEST, 'products-gerados.js');
        await fs.writeFile(outFile, `// Gerado em: ${new Date().toLocaleString('pt-BR')}\n// Site: ${URL}\n\n${code}\n`);
        log(`Guardado em: ${outFile}`, 'success');

        const appPath = path.join(DEST, 'app.js');
        let appExists = false;
        try { await fs.access(appPath); appExists = true; } catch {}

        if (appExists) {
            let appContent = await fs.readFile(appPath, 'utf8');
            const updated = appContent.replace(/const products\s*=\s*\[[\s\S]*?\];/, code);
            if (updated !== appContent) {
                await fs.writeFile(appPath, updated);
                log('app.js actualizado directamente!', 'success');
            }
        }

        console.log(`\n✅ ${products.length} produto(s) extraído(s):\n`);
        products.forEach((p, i) => {
            console.log(`  [${i+1}] ${p.title}`);
            console.log(`       vídeo: ${p.video || '(sem vídeo)'}`);
            console.log(`       desc:  ${p.desc.slice(0, 60)}${p.desc.length > 60 ? '...' : ''}`);
            console.log(`       chips: ${p.chips.join(', ')}`);
            console.log(`       badges: ${p.badges.map(b=>b.label).join(', ')}`);
            console.log(`       views: ${p.views}\n`);
        });

    } catch (e) {
        log(`Erro: ${e.message}`, 'error');
        console.error(e);
    } finally {
        if (browser) await browser.disconnect();
    }
}

main().catch(e => { log(`Erro fatal: ${e.message}`, 'error'); process.exit(1); });