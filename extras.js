// =====================================================
// extras.js  -  melhorias extra, independente do app.js
//  1) Video toca quando aparece no ecra (cada vez que a
//     pessoa desce ate ele) e pausa quando sai
//  2) Botao flutuante -> CANAL do Telegram (nao o DM)
//  3) Textos EN/PT (acompanha o seletor de idioma do site)
//  4) Barra de progresso, voltar ao topo, animacao ao rolar
//  5) Seccoes: Como comprar, FAQ e convite para o canal
//
// Inclui DEPOIS do prices.js no index.html:
//   <script src="extras.js"></script>
// =====================================================
(function () {
  'use strict';

  // ---------- CONFIGURACAO (muda so aqui) ----------
  var CHANNEL_URL = 'https://t.me/+HHcNHl1ezKBmMTVk';

  var I18N = {
    en: {
      fab: 'Join the Channel', channel_btn: 'Telegram Channel',
      how_eyebrow: 'Simple & fast', how_title: 'How to buy',
      s1t: 'Choose your folder', s1p: 'Browse the previews and pick the folder you want.',
      s2t: 'Message us on Telegram', s2p: 'Tap Buy Now. A message with the folder and price is ready to send.',
      s3t: 'Pay and get access', s3p: 'We guide you through the payment and send your access.',
      faq_eyebrow: 'Questions', faq_title: 'FAQ',
      f1q: 'How do I buy a folder?', f1a: 'Tap Buy Now on the folder you want. Telegram opens with the message ready; just send it and we will guide you.',
      f2q: 'How do I receive my folder?', f2a: 'After the payment is confirmed, we send you the access directly on Telegram.',
      f3q: 'Where can I see updates?', f3a: 'Join our Telegram channel to see new folders and updates first.',
      cta_title: 'Join our Telegram channel', cta_p: 'New folders and updates are posted there first.', cta_btn: 'Join the Channel'
    },
    pt: {
      fab: 'Entrar no Canal', channel_btn: 'Canal do Telegram',
      how_eyebrow: 'Simples e r\u00e1pido', how_title: 'Como comprar',
      s1t: 'Escolha a sua pasta', s1p: 'Veja as pr\u00e9vias e escolha a pasta que quer.',
      s2t: 'Fale connosco no Telegram', s2p: 'Toque em Buy Now. Uma mensagem com a pasta e o pre\u00e7o fica pronta para enviar.',
      s3t: 'Pague e receba o acesso', s3p: 'Guiamos o pagamento e enviamos o seu acesso.',
      faq_eyebrow: 'D\u00favidas', faq_title: 'Perguntas frequentes',
      f1q: 'Como compro uma pasta?', f1a: 'Toque em Buy Now na pasta que quer. O Telegram abre com a mensagem pronta; basta enviar e n\u00f3s guiamos.',
      f2q: 'Como recebo a minha pasta?', f2a: 'Depois de confirmado o pagamento, enviamos o acesso diretamente no Telegram.',
      f3q: 'Onde vejo as novidades?', f3a: 'Entre no nosso canal do Telegram para ver primeiro as novas pastas e atualiza\u00e7\u00f5es.',
      cta_title: 'Entre no nosso canal do Telegram', cta_p: 'As novas pastas e novidades saem primeiro l\u00e1.', cta_btn: 'Entrar no Canal'
    }
  };

  function currentLang() {
    var b = document.querySelector('.lang-btn.active');
    var l = b ? b.getAttribute('data-lang') : 'en';
    return I18N[l] ? l : 'en';
  }

  // so escreve se o texto for diferente (evita ciclos com o MutationObserver)
  function applyLang() {
    var d = I18N[currentLang()];
    document.querySelectorAll('[data-xt]').forEach(function (el) {
      var v = d[el.getAttribute('data-xt')];
      if (v !== undefined && el.textContent !== v) el.textContent = v;
    });
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.lang-btn')) setTimeout(applyLang, 60);
  });

  var TG_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>';

  function openChannel(e) {
    if (e) e.preventDefault();
    window.open(CHANNEL_URL, '_blank', 'noopener');
  }

  // =====================================================
  // 1) VIDEO TOCA AO APARECER NO ECRA
  // =====================================================
  var visible = [];
  var io = null;

  function playVideo(v) {
    try { v.currentTime = 0; } catch (e) {}
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
    if (v.parentElement) v.parentElement.classList.add('xt-playing');
  }
  function stopVideo(v) {
    try { v.pause(); } catch (e) {}
    if (v.parentElement) v.parentElement.classList.remove('xt-playing');
  }

  function setupVideos() {
    if (!('IntersectionObserver' in window)) return;
    if (!io) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var v = en.target;
          var i = visible.indexOf(v);
          if (en.isIntersecting) {
            if (i === -1) visible.push(v);
            if (!document.hidden) playVideo(v);
          } else {
            if (i > -1) visible.splice(i, 1);
            stopVideo(v);
          }
        });
      }, { threshold: 0.55 });
    }
    document.querySelectorAll('.product-video').forEach(function (v) {
      if (v._xt) return;
      v._xt = true;
      v.muted = true;
      v.setAttribute('muted', '');
      v.loop = true;
      v.setAttribute('loop', '');
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      if (!v.getAttribute('preload') || v.getAttribute('preload') === 'auto') v.setAttribute('preload', 'metadata');
      io.observe(v);
    });
  }

  document.addEventListener('visibilitychange', function () {
    visible.forEach(function (v) { document.hidden ? stopVideo(v) : playVideo(v); });
  });

  // =====================================================
  // 2) BOTAO FLUTUANTE + VOLTAR AO TOPO + PROGRESSO
  // =====================================================
  function setupFloating() {
    if (document.getElementById('xt-fab')) return;

    var fab = document.createElement('a');
    fab.id = 'xt-fab';
    fab.className = 'xt-fab';
    fab.href = CHANNEL_URL;
    fab.target = '_blank';
    fab.rel = 'noopener';
    fab.setAttribute('aria-label', 'Join our Telegram channel');
    fab.innerHTML = TG_SVG + '<span class="xt-fab-label" data-xt="fab">Join the Channel</span>';
    document.body.appendChild(fab);

    var top = document.createElement('button');
    top.id = 'xt-top';
    top.type = 'button';
    top.setAttribute('aria-label', 'Back to top');
    top.textContent = '\u2191';
    top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    document.body.appendChild(top);

    var bar = document.createElement('div');
    bar.id = 'xt-progress';
    document.body.appendChild(bar);

    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var h = document.documentElement.scrollHeight - window.innerHeight;
        var y = window.scrollY || document.documentElement.scrollTop;
        bar.style.width = (h > 0 ? Math.min(100, (y / h) * 100) : 0) + '%';
        top.classList.toggle('show', y > 600);
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // =====================================================
  // 5) SECCOES: COMO COMPRAR, FAQ, CONVITE AO CANAL
  // =====================================================
  function setupSections() {
    if (document.getElementById('xt-how')) return;
    var footer = document.querySelector('.site-footer');

    var wrap = document.createElement('div');
    wrap.id = 'xt-how';

    var steps = [1, 2, 3].map(function (i) {
      return '<div class="xt-step xt-reveal"><div class="xt-step-num">' + i + '</div>' +
             '<h3 data-xt="s' + i + 't"></h3><p data-xt="s' + i + 'p"></p></div>';
    }).join('');

    var faq = [1, 2, 3].map(function (i) {
      return '<details><summary><span data-xt="f' + i + 'q"></span></summary><p data-xt="f' + i + 'a"></p></details>';
    }).join('');

    wrap.innerHTML =
      '<section class="xt-section xt-reveal">' +
        '<div class="xt-eyebrow" data-xt="how_eyebrow"></div>' +
        '<h2 class="xt-title" data-xt="how_title"></h2>' +
        '<div class="xt-steps">' + steps + '</div>' +
      '</section>' +
      '<section class="xt-section xt-reveal">' +
        '<div class="xt-eyebrow" data-xt="faq_eyebrow"></div>' +
        '<h2 class="xt-title" data-xt="faq_title"></h2>' +
        '<div class="xt-faq">' + faq + '</div>' +
      '</section>' +
      '<section class="xt-cta xt-reveal">' +
        '<div class="xt-cta-box">' +
          '<h2 data-xt="cta_title"></h2>' +
          '<p data-xt="cta_p"></p>' +
          '<a class="xt-cta-btn" href="' + CHANNEL_URL + '" target="_blank" rel="noopener">' + TG_SVG + '<span data-xt="cta_btn"></span></a>' +
        '</div>' +
      '</section>';

    if (footer && footer.parentNode) footer.parentNode.insertBefore(wrap, footer);
    else document.body.appendChild(wrap);
  }

  // =====================================================
  // 4) ANIMACAO AO ROLAR
  // =====================================================
  var rio = null;
  function setupReveal() {
    var els = document.querySelectorAll('.xt-reveal:not(.in)');
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (e) { e.classList.add('in'); });
      return;
    }
    if (!rio) {
      rio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('in'); rio.unobserve(en.target); }
        });
      }, { threshold: 0.15 });
    }
    els.forEach(function (e) { if (!e._xr) { e._xr = true; rio.observe(e); } });
  }

  // =====================================================
  // REDE DE SEGURANCA: "a ver" sempre entre 100 e 500
  // (contador do cabecalho e views dos cards, mesmo que o
  //  app.js ainda gere numeros maiores)
  // =====================================================
  function randViews() { return 100 + Math.floor(Math.random() * 401); }

  function clampEl(el) {
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    while (w.nextNode()) {
      var n = w.currentNode;
      var m = n.nodeValue.match(/(\d[\d.,]*)(\s?[kKmM]\b)?/);
      if (!m) continue;
      var num = m[2] ? Infinity : parseInt(m[1].replace(/\D/g, ''), 10);
      if (num < 100 || num > 500) n.nodeValue = n.nodeValue.replace(m[0], String(randViews()));
      return;
    }
  }

  function clampViews() {
    document.querySelectorAll('#viewerCount, .vid-views, [id^="views-"]').forEach(clampEl);
  }

  // =====================================================
  // ARRANQUE + re-aplicar quando o app.js re-renderiza
  // =====================================================
  function run() {
    setupVideos();
    clampViews();
  }

  function init() {
    setupFloating();
    setupSections();
    setupReveal();
    applyLang();
    run();

    if (window.MutationObserver) {
      var pending = false;
      new MutationObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; run(); });
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  console.log('[extras.js] Carregado.');
})();
