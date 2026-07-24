// Camada de UX/feedback visual, carregada depois do main.js. Progressive
// enhancement: se o JS falhar, tudo continua funcionando (só sem os efeitos).
(function () {
  'use strict';

  const overlay = document.getElementById('app-loading-overlay');
  const overlayText = document.getElementById('app-loading-text');
  const progresso = document.getElementById('top-progress');
  const reduzirMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function mostrarOverlay(texto) {
    if (!overlay) return;
    if (overlayText && texto) overlayText.textContent = texto;
    overlay.hidden = false;
  }
  function esconderCarregando() {
    if (overlay) overlay.hidden = true;
    if (progresso) progresso.hidden = true;
  }
  function mostrarProgresso() {
    if (progresso) progresso.hidden = false;
  }

  // Volta do cache do navegador (botão Voltar) não dispara load normal — some com
  // o overlay/progresso pra não ficarem presos na tela.
  window.addEventListener('pageshow', esconderCarregando);

  // ---- Feedback em submits de formulário ---------------------------------
  // Captura na fase de captura pra rodar antes de handlers que naveguem.
  document.addEventListener('submit', function (event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    // Trava duplo-envio (clique duplo no "Enviar").
    if (form.dataset.enviando === 'true') { event.preventDefault(); return; }
    form.dataset.enviando = 'true';

    const botao = event.submitter;
    if (botao && botao.tagName === 'BUTTON') {
      botao.classList.add('is-loading');
      // desabilita só depois que o submit já capturou os dados do form.
      setTimeout(function () { botao.disabled = true; }, 0);
    }

    const texto = form.dataset.loading;
    if (texto) {
      // Se o form está dentro de um <dialog> aberto (ex.: modal de upload de
      // cotas), o dialog fica na "top layer" e taparia o overlay — fecha ele pra
      // a tela de carregamento aparecer inteira (o modal reabre com o resultado).
      const dialogo = form.closest('dialog[open]');
      if (dialogo) dialogo.close();
      mostrarOverlay(texto);
    } else {
      mostrarProgresso();
    }
  }, true);

  // ---- Progresso ao navegar por links internos ---------------------------
  document.addEventListener('click', function (event) {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target && link.target !== '_self') return;

    const href = link.getAttribute('href');
    if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) return;

    let url;
    try { url = new URL(href, window.location.href); } catch (e) { return; }
    if (url.origin !== window.location.origin) return;
    // Âncora dentro da mesma página não é "navegação".
    if (url.pathname === window.location.pathname && url.hash) return;

    mostrarProgresso();
  });

  // ---- Filtros: o checkbox submete via form.submit() (sem evento 'submit'),
  // então a barra de progresso é acionada aqui no 'change'. -----------------
  document.querySelectorAll(
    '.filtro-detalhes input[type="checkbox"], .filtro-tecnologia input[type="checkbox"]'
  ).forEach(function (cb) {
    cb.addEventListener('change', mostrarProgresso);
  });

  // ---- Destaca na navbar a página atual -----------------------------------
  const aqui = window.location.pathname;
  document.querySelectorAll('.topbar-nav-item').forEach(function (item) {
    const href = item.getAttribute('href') || '';
    let path;
    try { path = new URL(href, window.location.href).pathname; } catch (e) { return; }
    if (path === aqui && path !== '/') item.classList.add('is-active');
    if (path === '/' && aqui === '/') item.classList.add('is-active');
  });

  // ---- Alerts: ícone + botão fechar + auto-dismiss nos transitórios --------
  const ICONE_OK = '<svg class="alert-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>';
  const ICONE_ERRO = '<svg class="alert-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16h.01"/></svg>';
  const ICONE_AVISO = '<svg class="alert-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>';

  function fecharAlerta(alerta) {
    alerta.classList.add('saindo');
    setTimeout(function () { alerta.remove(); }, reduzirMovimento ? 0 : 300);
  }

  document.querySelectorAll('.alert').forEach(function (alerta) {
    // Move o conteúdo atual pra um wrapper, pra sobrar espaço pro ícone e o X.
    const corpo = document.createElement('div');
    corpo.className = 'alert-corpo';
    while (alerta.firstChild) corpo.appendChild(alerta.firstChild);

    let icone = '';
    if (alerta.classList.contains('alert-erro')) icone = ICONE_ERRO;
    else if (alerta.classList.contains('alert-aviso')) icone = ICONE_AVISO;
    else if (alerta.classList.contains('alert-ok')) icone = ICONE_OK;
    if (icone) alerta.insertAdjacentHTML('afterbegin', icone);
    alerta.appendChild(corpo);

    const fechar = document.createElement('button');
    fechar.type = 'button';
    fechar.className = 'alert-dismiss';
    fechar.setAttribute('aria-label', 'Fechar aviso');
    fechar.innerHTML = '&times;';
    fechar.addEventListener('click', function () { fecharAlerta(alerta); });
    alerta.appendChild(fechar);

    // Só some sozinho quem é resultado transitório (upload); avisos ficam.
    if (alerta.dataset.autoDismiss !== undefined) {
      setTimeout(function () { fecharAlerta(alerta); }, 6000);
    }
  });
})();
