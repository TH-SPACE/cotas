// Restaura o quanto antes (antes do DOMContentLoaded, direto no fim do body)
// o que um filtro precisa lembrar entre reloads de página: posição de rolagem
// (senão o clique num checkbox "pula" pro topo) e se o painel de filtro estava
// aberto (senão ele fecha sozinho a cada clique).
const SCROLL_Y_KEY = 'calc_scroll_y';
const scrollSalvo = sessionStorage.getItem(SCROLL_Y_KEY);
if (scrollSalvo !== null) {
  window.scrollTo(0, parseInt(scrollSalvo, 10));
  sessionStorage.removeItem(SCROLL_Y_KEY);
}

document.querySelectorAll('details.filtro-detalhes[id]').forEach((details) => {
  if (sessionStorage.getItem(`calc_filtro_aberto_${details.id}`) === '1') {
    details.open = true;
  }
  details.addEventListener('toggle', () => {
    sessionStorage.setItem(`calc_filtro_aberto_${details.id}`, details.open ? '1' : '0');
  });
});

document.addEventListener('DOMContentLoaded', () => {
  const modais = [
    { modalId: 'config-modal', openId: 'config-open-btn', closeId: 'config-close-btn' },
    { modalId: 'instalacoes-upload-modal', openId: 'instalacoes-upload-open-btn', closeId: 'instalacoes-upload-close-btn' },
    { modalId: 'config-instalacoes-modal', openId: 'config-instalacoes-open-btn', closeId: 'config-instalacoes-close-btn' },
  ];

  modais.forEach(({ modalId, openId, closeId }) => {
    const modal = document.getElementById(modalId);
    const openBtn = document.getElementById(openId);
    const closeBtn = document.getElementById(closeId);

    if (openBtn && modal) {
      openBtn.addEventListener('click', () => modal.showModal());
    }
    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => modal.close());
    }
    if (modal) {
      modal.addEventListener('click', (event) => {
        if (event.target === modal) modal.close();
      });
    }
  });

  const clamp = (valor) => {
    if (Number.isNaN(valor)) return 0;
    return Math.min(100, Math.max(0, valor));
  };

  const paresJanela = [
    ['percentualJanela', 'percentualJanelaTarde'],
    ['percentualJanelaInstalacao', 'percentualJanelaTardeInstalacao'],
  ];

  paresJanela.forEach(([manhaId, tardeId]) => {
    const manha = document.getElementById(manhaId);
    const tarde = document.getElementById(tardeId);

    if (manha && tarde) {
      manha.addEventListener('input', () => {
        tarde.value = 100 - clamp(Number(manha.value));
      });
      tarde.addEventListener('input', () => {
        manha.value = 100 - clamp(Number(tarde.value));
      });
    }
  });

  const formsComFiltroAutoSubmit = ['filtro-tecnologia-form', 'filtro-instalacoes-form'];
  formsComFiltroAutoSubmit.forEach((formId) => {
    const form = document.getElementById(formId);
    if (!form) return;
    form.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        sessionStorage.setItem(SCROLL_Y_KEY, String(window.scrollY));
        form.submit();
      });
    });
  });
});
