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
    { modalId: 'config-elos-modal', openId: 'config-elos-open-btn', closeId: 'config-elos-close-btn' },
    { modalId: 'cotas-upload-modal', openId: 'cotas-upload-open-btn', closeId: 'cotas-upload-close-btn' },
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
      // Reabre sozinho depois de um upload (o POST redireciona com ?cotasUpload=...),
      // pra mostrar o resultado e deixar seguir enviando os outros tipos sem reabrir.
      if (modal.dataset.abrirAutomatico === 'true') {
        modal.showModal();
      }
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

    // Clique numa miniatura abre ela ampliada num lightbox por cima do modal --
    // só liga uma vez (os <img> não são recriados, só o src muda a cada poll).
    const lightbox = document.getElementById('raspagem-screenshot-lightbox');
    const lightboxImg = document.getElementById('raspagem-screenshot-lightbox-img');
    const lightboxClose = document.getElementById('raspagem-screenshot-lightbox-close');

    if (lightbox && lightboxImg) {
      document.querySelectorAll('#raspagem-screenshots img[data-nome]').forEach((thumb) => {
        const abrirLightbox = () => {
          if (!thumb.src || thumb.style.display === 'none') return;
          lightboxImg.src = thumb.src;
          lightboxImg.alt = thumb.alt;
          lightbox.showModal();
        };
        thumb.addEventListener('click', abrirLightbox);
        thumb.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            abrirLightbox();
          }
        });
      });

      if (lightboxClose) {
        lightboxClose.addEventListener('click', () => lightbox.close());
      }
      lightbox.addEventListener('click', (event) => {
        if (event.target === lightbox) lightbox.close();
      });
    }
  }

  // Botão "Salvar planejamento" (sidebar da index): abre modal de confirmação
  // antes de chamar POST /api/snapshot-manual, para o usuário entender o que vai
  // acontecer (os valores atuais serão o Planej. de amanhã em Cotas Planejadas).
  const btnSnapshotManual = document.getElementById('snapshot-manual-btn');
  const snapshotModal = document.getElementById('snapshot-confirm-modal');
  const btnSnapshotConfirmOk = document.getElementById('snapshot-confirm-ok-btn');
  const btnSnapshotConfirmClose = document.getElementById('snapshot-confirm-close-btn');
  const btnSnapshotConfirmClose2 = document.getElementById('snapshot-confirm-close-btn-2');

  if (btnSnapshotManual && snapshotModal) {
    btnSnapshotManual.addEventListener('click', () => snapshotModal.showModal());

    const fecharModal = () => snapshotModal.close();
    if (btnSnapshotConfirmClose) btnSnapshotConfirmClose.addEventListener('click', fecharModal);
    if (btnSnapshotConfirmClose2) btnSnapshotConfirmClose2.addEventListener('click', fecharModal);
    snapshotModal.addEventListener('click', (e) => { if (e.target === snapshotModal) fecharModal(); });

    if (btnSnapshotConfirmOk) {
      btnSnapshotConfirmOk.addEventListener('click', async () => {
        const textoOriginal = btnSnapshotConfirmOk.textContent.trim();
        btnSnapshotConfirmOk.disabled = true;
        btnSnapshotConfirmClose2 && (btnSnapshotConfirmClose2.disabled = true);
        btnSnapshotConfirmOk.textContent = 'Salvando…';

        try {
          const resposta = await fetch('/api/snapshot-manual', { method: 'POST' });
          const dados = await resposta.json();

          if (dados.ok) {
            btnSnapshotConfirmOk.textContent = 'Salvo!';
            setTimeout(() => {
              snapshotModal.close();
              btnSnapshotConfirmOk.textContent = textoOriginal;
              btnSnapshotConfirmOk.disabled = false;
              btnSnapshotConfirmClose2 && (btnSnapshotConfirmClose2.disabled = false);
            }, 1200);
          } else {
            throw new Error(dados.erro || 'Erro desconhecido');
          }
        } catch (err) {
          btnSnapshotConfirmOk.textContent = 'Erro ao salvar';
          setTimeout(() => {
            btnSnapshotConfirmOk.textContent = textoOriginal;
            btnSnapshotConfirmOk.disabled = false;
            btnSnapshotConfirmClose2 && (btnSnapshotConfirmClose2.disabled = false);
          }, 3000);
        }
      });
    }
  }

  // Botões "Previsto (X%)" e "Sugestão" no cabeçalho de cada seção (home): abrem
  // um modal pequeno pra editar Previsto ou Carga sem precisar ir em
  // Configurações -- `data-campo` no botão escolhe qual dos dois campos é
  // (rótulo/min/max/step e a rota POST/config/rapido dependem dele).
  const configRapidoModal = document.getElementById('config-rapido-modal');
  if (configRapidoModal) {
    const rapidoTipoInput = document.getElementById('config-rapido-tipo');
    const rapidoCampoInput = document.getElementById('config-rapido-campo');
    const rapidoValorInput = document.getElementById('config-rapido-input');
    const rapidoTitulo = document.getElementById('config-rapido-titulo');
    const rapidoRotulo = document.getElementById('config-rapido-rotulo');
    const rapidoDica = document.getElementById('config-rapido-dica');
    const rapidoCloseBtn = document.getElementById('config-rapido-close-btn');
    const rapidoCancelBtn = document.getElementById('config-rapido-cancel-btn');

    const CONFIG_RAPIDO_CAMPOS = {
      previsto: {
        titulo: 'Editar Previsto',
        rotulo: 'Previsto (%)',
        min: 0, max: 100, step: 1,
        dica: 'Percentual do backlog desta seção considerado resolvível — o mesmo campo da página de Configurações.',
      },
      carga: {
        titulo: 'Editar Carga',
        rotulo: 'Carga',
        min: 0, max: null, step: 0.01,
        // Fração empilhada via CSS (sem lib de matemática) pra ficar com cara de
        // fórmula de verdade, não só texto corrido com ÷/×. `.formula-linha`/
        // `.fracao`/`.fracao-cima`/`.fracao-baixo` em style.css. O exemplo usa
        // dado REAL (Previsto do 1º bucket da seção + Previsto total, vindos do
        // botão via data-exemplo-*) simulado com a Carga atual, em vez de
        // números inventados.
        dica: (dataset) => {
          const bucketPrevisto = Number(dataset.exemploBucket) || 0;
          const total = Number(dataset.exemploTotal) || 0;
          const cargaAtual = Number(dataset.valor) || 0;
          const sugestao = total > 0 ? (bucketPrevisto / total) * cargaAtual : 0;
          const rotuloExemplo = dataset.exemploNome ? `Exemplo (${dataset.exemploNome}):` : 'Exemplo:';

          return '<span class="formula-linha">'
            + '<strong class="formula-destaque">Sugestão</strong> <span>=</span> '
            + '<span class="fracao"><span class="fracao-cima">Previsto do bucket</span><span class="fracao-baixo">Previsto total da seção</span></span> '
            + '<span>×</span> <strong class="formula-destaque">Carga</strong>'
            + '</span>'
            + '<span class="formula-linha formula-exemplo">'
            + `<span>${rotuloExemplo}</span> `
            + `<span class="fracao"><span class="fracao-cima">${bucketPrevisto}</span><span class="fracao-baixo">${total}</span></span> `
            + `<span>× ${cargaAtual} =</span> <strong class="formula-destaque">${sugestao.toFixed(1)}</strong>`
            + '</span>';
        },
      },
      metaPu: {
        titulo: 'Editar Meta de PU',
        rotulo: 'Meta de PU por técnico',
        min: 0.1, max: null, step: 0.1,
        // Mesma ideia do Carga (fração empilhada + exemplo com dado real), só
        // que aqui a fórmula é a da coluna Técnicos (PU ÷ Meta, arredondado pra
        // cima) -- é essa Meta que o botão "PU" do cabeçalho edita, não o peso
        // de PU em si (só Reparos tem 1 valor fixo pra isso; Instalação/Serviço/
        // ME usam PU por Specification Product, tabela própria).
        dica: (dataset) => {
          const puExemplo = dataset.exemploPu || '0';
          const metaAtual = dataset.valor || '0';
          const tecnicos = Number(metaAtual) > 0 ? Math.ceil(Number(puExemplo) / Number(metaAtual)) : 0;
          const rotuloExemplo = dataset.exemploNome ? `Exemplo (${dataset.exemploNome}):` : 'Exemplo:';

          return '<span class="formula-linha">'
            + '<strong class="formula-destaque">Técnicos</strong> <span>=</span> '
            + '<span class="fracao"><span class="fracao-cima">PU</span><span class="fracao-baixo">Meta de PU por técnico</span></span> '
            + '<span>(arredondado pra cima)</span>'
            + '</span>'
            + '<span class="formula-linha formula-exemplo">'
            + `<span>${rotuloExemplo}</span> `
            + `<span class="fracao"><span class="fracao-cima">${puExemplo}</span><span class="fracao-baixo">${metaAtual}</span></span> `
            + `<span>=</span> <strong class="formula-destaque">${tecnicos}</strong>`
            + '</span>';
        },
      },
    };

    document.querySelectorAll('.config-rapido-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cfg = CONFIG_RAPIDO_CAMPOS[btn.dataset.campo] || CONFIG_RAPIDO_CAMPOS.previsto;
        rapidoTipoInput.value = btn.dataset.tipo;
        rapidoCampoInput.value = btn.dataset.campo;
        rapidoValorInput.value = btn.dataset.valor;
        rapidoValorInput.min = cfg.min;
        if (cfg.max === null) rapidoValorInput.removeAttribute('max');
        else rapidoValorInput.max = cfg.max;
        rapidoValorInput.step = cfg.step;
        rapidoTitulo.textContent = `${cfg.titulo} — ${btn.dataset.label}`;
        rapidoRotulo.textContent = cfg.rotulo;
        rapidoDica.innerHTML = typeof cfg.dica === 'function' ? cfg.dica(btn.dataset) : cfg.dica;
        configRapidoModal.showModal();
        rapidoValorInput.focus();
        rapidoValorInput.select();
      });
    });

    const fecharConfigRapidoModal = () => configRapidoModal.close();
    if (rapidoCloseBtn) rapidoCloseBtn.addEventListener('click', fecharConfigRapidoModal);
    if (rapidoCancelBtn) rapidoCancelBtn.addEventListener('click', fecharConfigRapidoModal);
    configRapidoModal.addEventListener('click', (e) => { if (e.target === configRapidoModal) fecharConfigRapidoModal(); });
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

  // Botão "ORDENS" no cabeçalho de cada seção (home): abre um modal com as %
  // de janela daquela seção (as editáveis vêm em `data-janelas`, já incluindo
  // a última -- sempre o restante, só exibida/recalculada, nunca enviada).
  // Mesma ideia dos grupos acima (clamp/recalcularRestante), só que o modal é
  // 1 só pras 4 seções e os campos são montados na hora via JS, não fixos no HTML.
  const janelasModal = document.getElementById('janelas-edit-modal');
  if (janelasModal) {
    const janelasLabel = document.getElementById('janelas-edit-label');
    const janelasLista = document.getElementById('janelas-edit-lista');
    const janelasCloseBtn = document.getElementById('janelas-edit-close-btn');
    const janelasCancelBtn = document.getElementById('janelas-edit-cancel-btn');

    document.querySelectorAll('.ordens-editar-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        let itens;
        try { itens = JSON.parse(btn.dataset.janelas); } catch (e) { return; }
        if (!Array.isArray(itens) || itens.length === 0) return;

        janelasLabel.textContent = btn.dataset.label;
        janelasLista.innerHTML = '';

        const editaveis = [];
        let restante = null;

        itens.forEach((item, i) => {
          const linha = document.createElement('div');
          linha.className = 'field-row';

          const label = document.createElement('label');
          label.textContent = item.rotulo;
          label.htmlFor = `janelas-edit-input-${i}`;

          const input = document.createElement('input');
          input.type = 'number';
          input.id = `janelas-edit-input-${i}`;
          input.min = '0';
          input.max = '100';
          input.step = '1';
          input.value = item.valor;

          if (item.nome) {
            input.name = item.nome;
            editaveis.push(input);
          } else {
            input.readOnly = true;
            input.tabIndex = -1;
            restante = input;
          }

          linha.appendChild(label);
          linha.appendChild(input);
          janelasLista.appendChild(linha);
        });

        if (restante) {
          const recalcularRestante = () => {
            const soma = editaveis.reduce((acc, el) => acc + clamp(Number(el.value)), 0);
            restante.value = Math.max(0, 100 - soma);
          };
          editaveis.forEach(el => el.addEventListener('input', recalcularRestante));
        }

        janelasModal.showModal();
        if (editaveis[0]) { editaveis[0].focus(); editaveis[0].select(); }
      });
    });

    const fecharJanelasModal = () => janelasModal.close();
    if (janelasCloseBtn) janelasCloseBtn.addEventListener('click', fecharJanelasModal);
    if (janelasCancelBtn) janelasCancelBtn.addEventListener('click', fecharJanelasModal);
    janelasModal.addEventListener('click', (e) => { if (e.target === janelasModal) fecharJanelasModal(); });
  }

  // Abas de seção (Instalação / Serviços / ...) -- reaproveitado por Cotas
  // Planejadas e pela home (tabs no topo + atalhos na sidebar, ambos com a
  // classe .secao-aba). Todo o conteúdo já vem renderizado; a aba só
  // mostra/esconde o painel (e o cabeçalho, quando existir) correspondente
  // (troca instantânea, sem recarregar). A seção escolhida fica guardada na
  // sessão -- cada página usa sua própria chave (`data-storage-key` no
  // primeiro elemento com abas) pra não misturar a aba ativa de uma página
  // com a da outra.
  const abasDeSecao = document.querySelectorAll('.secao-aba');
  if (abasDeSecao.length > 0) {
    const elementoComChave = document.querySelector('[data-storage-key]');
    const SECAO_KEY = (elementoComChave && elementoComChave.dataset.storageKey) || 'calc_secao_cotas';

    const aplicarSecao = (id) => {
      document.querySelectorAll('.secao-painel[data-secao], .secao-cabecalho[data-secao]').forEach((el) => {
        el.hidden = el.dataset.secao !== id;
      });
      abasDeSecao.forEach((aba) => {
        const ativa = aba.dataset.secao === id;
        aba.classList.toggle('is-active', ativa);
        aba.setAttribute('aria-pressed', ativa ? 'true' : 'false');
      });
      sessionStorage.setItem(SECAO_KEY, id);
    };

    abasDeSecao.forEach((aba) => {
      aba.addEventListener('click', () => aplicarSecao(aba.dataset.secao));
    });

    const salva = sessionStorage.getItem(SECAO_KEY);
    const existe = Array.from(abasDeSecao).some((aba) => aba.dataset.secao === salva);
    aplicarSecao(existe ? salva : abasDeSecao[0].dataset.secao);
  }

  // Toggle "Minutos / Ordens" da tabela de Cotas Planejadas. Os dois valores já
  // vêm renderizados (spans .v-min e .v-qtd), então trocar é só uma classe -- sem
  // recarregar a página nem recalcular nada. A escolha fica guardada na sessão
  // pra não voltar pro padrão a cada reload.
  const botoesUnidade = document.querySelectorAll('.unidade-tab');
  const tabelaCotas = document.getElementById('cotas-tabela');
  if (botoesUnidade.length > 0 && tabelaCotas) {
    const UNIDADE_KEY = 'calc_unidade_cotas';

    const aplicarUnidade = (unidade) => {
      tabelaCotas.classList.toggle('mostrar-qtd', unidade === 'qtd');
      botoesUnidade.forEach((botao) => {
        const ativo = botao.dataset.unidade === unidade;
        botao.classList.toggle('is-active', ativo);
        botao.setAttribute('aria-pressed', ativo ? 'true' : 'false');
      });
      sessionStorage.setItem(UNIDADE_KEY, unidade);
    };

    botoesUnidade.forEach((botao) => {
      botao.addEventListener('click', () => aplicarUnidade(botao.dataset.unidade));
    });

    aplicarUnidade(sessionStorage.getItem(UNIDADE_KEY) === 'qtd' ? 'qtd' : 'min');
  }

  // Popover de detalhe por janela/bucket (Projeção D1-D7): passar o mouse (ou
  // focar via teclado) numa célula "n/total" (Parcial) mostra o status de cada
  // janela (linhas de bucket) ou de cada bucket (linha "Total geral") que formou
  // aquela soma. O popover é criado sob demanda e anexado no <body> -- não dá pra
  // ser filho da célula porque `.cotas-table td` tem overflow:hidden e cortaria.
  const celulasComDetalhe = document.querySelectorAll('[data-detalhe]');
  if (celulasComDetalhe.length > 0) {
    let popoverAtual = null;

    const fecharPopover = () => {
      if (popoverAtual) {
        popoverAtual.remove();
        popoverAtual = null;
      }
    };

    const abrirPopover = (celula) => {
      fecharPopover();
      let itens;
      try {
        itens = JSON.parse(celula.dataset.detalhe);
      } catch (e) {
        return;
      }
      if (!Array.isArray(itens) || itens.length === 0) return;

      // Tabela de verdade (não divs com grid): colunas alinhadas entre linhas são
      // exatamente o que <table> já faz sozinho -- uma grid por linha (uma div
      // independente por item) deixava cada linha com sua própria largura de
      // coluna, ficando torto quando um valor (ex. "Fechado") era mais largo que
      // os outros (ex. "Aberto").
      const popover = document.createElement('div');
      popover.className = 'status-detalhe-popover';
      const tabela = document.createElement('table');

      const linhaCabecalho = document.createElement('tr');
      linhaCabecalho.appendChild(document.createElement('th'));
      const thStatus = document.createElement('th');
      thStatus.textContent = 'Status';
      const thCota = document.createElement('th');
      thCota.textContent = 'Cota Aberta';
      linhaCabecalho.appendChild(thStatus);
      linhaCabecalho.appendChild(thCota);
      tabela.appendChild(linhaCabecalho);

      itens.forEach((item) => {
        const linha = document.createElement('tr');
        const rotulo = document.createElement('td');
        rotulo.textContent = item.rotulo;
        const status = document.createElement('td');
        status.textContent = item.status;
        // No popover do rodapé (por bucket), o próprio bucket pode ser Parcial
        // ("3/4") -- não é nem Aberto nem Fechado, então ganha a cor de alerta.
        let classeStatus = 'detalhe-status-fechado';
        if (item.status === 'Aberto') classeStatus = 'detalhe-status-aberto';
        else if (item.status.includes('/')) classeStatus = 'detalhe-status-parcial';
        status.className = classeStatus;
        const cota = document.createElement('td');
        cota.textContent = item.cotaAberta != null ? item.cotaAberta : '—';
        linha.appendChild(rotulo);
        linha.appendChild(status);
        linha.appendChild(cota);
        tabela.appendChild(linha);
      });
      popover.appendChild(tabela);
      document.body.appendChild(popover);

      const rectCelula = celula.getBoundingClientRect();
      const rectPopover = popover.getBoundingClientRect();
      let top = rectCelula.bottom + 6;
      if (top + rectPopover.height > window.innerHeight) top = rectCelula.top - rectPopover.height - 6;
      let left = rectCelula.left;
      if (left + rectPopover.width > window.innerWidth) left = window.innerWidth - rectPopover.width - 8;
      popover.style.top = `${Math.max(4, top)}px`;
      popover.style.left = `${Math.max(4, left)}px`;
      popoverAtual = popover;
    };

    celulasComDetalhe.forEach((celula) => {
      celula.addEventListener('mouseenter', () => abrirPopover(celula));
      celula.addEventListener('mouseleave', fecharPopover);
      celula.addEventListener('focus', () => abrirPopover(celula));
      celula.addEventListener('blur', fecharPopover);
    });
  }

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

  // Filtro de Aliada (views/partials/filtro-aliada-chips.ejs), presente nas 5
  // páginas -- na home vira 4 cópias (1 por cabeçalho de seção), por isso usa
  // classe + querySelectorAll em vez de id único (getElementById só pegaria a
  // 1ª cópia, deixando as outras mudas); nas outras páginas é só 1 cópia, mas o
  // mesmo mecanismo serve pra todas sem precisar de caso especial.
  document.querySelectorAll('.filtro-aliada-chips-form').forEach((form) => {
    form.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        sessionStorage.setItem(SCROLL_Y_KEY, String(window.scrollY));
        form.submit();
      });
    });
  });
});
