document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('config-modal');
  const openBtn = document.getElementById('config-open-btn');
  const closeBtn = document.getElementById('config-close-btn');

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

  const manha = document.getElementById('percentualJanela');
  const tarde = document.getElementById('percentualJanelaTarde');

  const clamp = (valor) => {
    if (Number.isNaN(valor)) return 0;
    return Math.min(100, Math.max(0, valor));
  };

  if (manha && tarde) {
    manha.addEventListener('input', () => {
      tarde.value = 100 - clamp(Number(manha.value));
    });
    tarde.addEventListener('input', () => {
      manha.value = 100 - clamp(Number(tarde.value));
    });
  }
});
