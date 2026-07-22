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

// Qualquer form da página (inclusive os "Aplicar"/"Salvar tempos"/"Salvar PU"
// dentro dos modais de configuração) salva a posição de rolagem antes de
// submeter, senão o reload da página volta pro topo. Cobre o submit "nativo"
// (clique no botão); o submit via JS (form.submit() dos checkboxes de filtro,
// abaixo) não dispara o evento 'submit', por isso aquele salva manualmente.
document.querySelectorAll('form').forEach((form) => {
  form.addEventListener('submit', () => {
    sessionStorage.setItem(SCROLL_Y_KEY, String(window.scrollY));
  });
});

document.addEventListener('DOMContentLoaded', () => {
  const modais = [
    { modalId: 'config-modal', openId: 'config-open-btn', closeId: 'config-close-btn' },
    { modalId: 'instalacoes-upload-modal', openId: 'instalacoes-upload-open-btn', closeId: 'instalacoes-upload-close-btn' },
    { modalId: 'config-instalacoes-modal', openId: 'config-instalacoes-open-btn', closeId: 'config-instalacoes-close-btn' },
    { modalId: 'config-servicos-modal', openId: 'config-servicos-open-btn', closeId: 'config-servicos-close-btn' },
    { modalId: 'config-me-modal', openId: 'config-me-open-btn', closeId: 'config-me-close-btn' },
    { modalId: 'config-elos-modal', openId: 'config-elos-open-btn', closeId: 'config-elos-close-btn' },
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

  // Status "ao vivo" da raspagem, no modal "Credenciais do Elos" -- só fica
  // consultando (polling) o servidor enquanto o modal está aberto, pra não
  // bater a cada 3s à toa quando ninguém está olhando.
  const elosModal = document.getElementById('config-elos-modal');
  const elosOpenBtn = document.getElementById('config-elos-open-btn');
  const boxStatusRaspagem = document.getElementById('raspagem-status-box');
  const textoStatusRaspagem = document.getElementById('raspagem-status-texto');

  if (elosModal && elosOpenBtn && boxStatusRaspagem && textoStatusRaspagem) {
    let intervaloStatusRaspagem = null;

    // Miniaturas dos screenshots que a raspagem tira a cada etapa (login,
    // dashboard, exportação...) -- cada <img> só aparece se aquele arquivo
    // realmente existir agora (nem toda etapa é sempre alcançada). Query string
    // com timestamp evita servir uma imagem em cache de uma raspagem anterior.
    const atualizarScreenshotsRaspagem = () => {
      const agora = Date.now();
      document.querySelectorAll('#raspagem-screenshots img[data-nome]').forEach((img) => {
        img.onload = () => { img.style.display = ''; };
        img.onerror = () => { img.style.display = 'none'; };
        img.src = `/raspagem-screenshots/${img.dataset.nome}?t=${agora}`;
      });
    };

    const atualizarStatusRaspagem = async () => {
      try {
        const resposta = await fetch('/api/raspagem-status');
        const dados = await resposta.json();

        boxStatusRaspagem.classList.remove('alert', 'alert-ok', 'alert-erro');

        if (dados.etapa !== 'ocioso') {
          boxStatusRaspagem.classList.add('alert', 'alert-ok');
          textoStatusRaspagem.textContent = `Rodando agora: ${dados.mensagem}`;
        } else if (dados.ultimoResultado === 'erro') {
          boxStatusRaspagem.classList.add('alert', 'alert-erro');
          textoStatusRaspagem.textContent = `Última raspagem falhou em ${dados.ultimaExecucaoEm}: ${dados.ultimoErro}`;
        } else if (dados.ultimoResultado === 'sucesso') {
          boxStatusRaspagem.classList.add('alert', 'alert-ok');
          textoStatusRaspagem.textContent = dados.ultimasLinhas > 0
            ? `Última raspagem em ${dados.ultimaExecucaoEm}: ${dados.ultimasLinhas} linha(s) importada(s).`
            : `Última raspagem em ${dados.ultimaExecucaoEm}: sem dados novos no Elos.`;
        } else {
          textoStatusRaspagem.textContent = 'Nenhuma raspagem rodou ainda.';
        }
      } catch (err) {
        textoStatusRaspagem.textContent = 'Não foi possível consultar o status agora.';
      }
    };

    const atualizarTudoRaspagem = () => {
      atualizarStatusRaspagem();
      atualizarScreenshotsRaspagem();
    };

    elosOpenBtn.addEventListener('click', () => {
      atualizarTudoRaspagem();
      if (intervaloStatusRaspagem) clearInterval(intervaloStatusRaspagem);
      intervaloStatusRaspagem = setInterval(atualizarTudoRaspagem, 3000);
    });

    elosModal.addEventListener('close', () => {
      if (intervaloStatusRaspagem) {
        clearInterval(intervaloStatusRaspagem);
        intervaloStatusRaspagem = null;
      }
    });

    const btnExecutarAgora = document.getElementById('raspagem-executar-agora-btn');
    if (btnExecutarAgora) {
      btnExecutarAgora.addEventListener('click', async () => {
        const textoOriginal = btnExecutarAgora.textContent;
        btnExecutarAgora.disabled = true;
        btnExecutarAgora.textContent = 'Solicitado...';

        try {
          await fetch('/api/raspagem-executar-agora', { method: 'POST' });
        } catch (err) {
          // a raspagem em si roda em outro processo -- se o pedido falhar aqui,
          // o usuário só tenta de novo; não tem nada mais a fazer neste catch.
        }

        atualizarTudoRaspagem();

        // A raspagem confere o pedido a cada 5s (ver loop-instalacoes.js) --
        // dá uma folga maior que isso antes de deixar clicar de novo.
        setTimeout(() => {
          btnExecutarAgora.disabled = false;
          btnExecutarAgora.textContent = textoOriginal;
        }, 8000);
      });
    }
  }

  const clamp = (valor) => {
    if (Number.isNaN(valor)) return 0;
    return Math.min(100, Math.max(0, valor));
  };

  // Reparos: só 2 janelas, então o par é bidirecional (editar uma recalcula a outra).
  const parJanelaReparo = ['percentualJanela', 'percentualJanelaTarde'];
  const [manha, tarde] = parJanelaReparo.map(id => document.getElementById(id));
  if (manha && tarde) {
    manha.addEventListener('input', () => {
      tarde.value = 100 - clamp(Number(manha.value));
    });
    tarde.addEventListener('input', () => {
      manha.value = 100 - clamp(Number(tarde.value));
    });
  }

  // Instalações, Serviços e ME: 4 janelas — as 3 primeiras são editáveis
  // independentemente, a 4ª é sempre o restante (só exibida, não some bidirecional
  // com nenhuma das outras).
  const gruposJanela4 = [
    { editaveisIds: ['percentualJanela1Instalacao', 'percentualJanela2Instalacao', 'percentualJanela3Instalacao'], autoId: 'percentualJanela4Instalacao' },
    { editaveisIds: ['percentualJanela1Servico', 'percentualJanela2Servico', 'percentualJanela3Servico'], autoId: 'percentualJanela4Servico' },
    { editaveisIds: ['percentualJanela1Me', 'percentualJanela2Me', 'percentualJanela3Me'], autoId: 'percentualJanela4Me' },
  ];

  gruposJanela4.forEach(({ editaveisIds, autoId }) => {
    const editaveis = editaveisIds.map(id => document.getElementById(id)).filter(Boolean);
    const auto = document.getElementById(autoId);
    if (editaveis.length === 0 || !auto) return;

    const recalcularRestante = () => {
      const soma = editaveis.reduce((acc, el) => acc + clamp(Number(el.value)), 0);
      auto.value = Math.max(0, 100 - soma);
    };
    editaveis.forEach(el => el.addEventListener('input', recalcularRestante));
  });

  const formsComFiltroAutoSubmit = ['filtro-tecnologia-form', 'filtro-instalacoes-form', 'filtro-servicos-form', 'filtro-me-form'];
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
