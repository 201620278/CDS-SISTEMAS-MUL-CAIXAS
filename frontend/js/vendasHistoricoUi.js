function escapeHtmlHistoricoVenda(text) {
    if (text === undefined || text === null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function historicoVendaModoFiscalAtivo() {
    return typeof isModoFiscalVisualizacaoAtivo === 'function' && isModoFiscalVisualizacaoAtivo();
}

function itemPossuiParteFiscalHistorico(item) {
    return Number(item?.quantidade_fiscal ?? 0) > 0 || Number(item?.valor_fiscal ?? 0) > 0;
}

function filtrarItensHistoricoVenda(venda) {
    const itens = Array.isArray(venda?.itens) ? venda.itens : [];
    if (!historicoVendaModoFiscalAtivo()) {
        return itens;
    }
    return itens.filter(itemPossuiParteFiscalHistorico);
}

function obterTotalExibicaoHistoricoVenda(venda, itensFiltrados = []) {
    if (historicoVendaModoFiscalAtivo()) {
        const valorFiscal = Number(venda?.valor_fiscal ?? 0);
        if (valorFiscal > 0) {
            return valorFiscal;
        }
        return itensFiltrados.reduce((total, item) => total + Number(item.valor_fiscal || 0), 0);
    }
    return Number(venda?.total || 0);
}

function exibirCupomNaoFiscalHistorico(venda) {
    if (historicoVendaModoFiscalAtivo()) {
        return false;
    }
    return typeof vendaPossuiCupomNaoFiscal === 'function' && vendaPossuiCupomNaoFiscal(venda);
}

function montarHtmlAcoesHistoricoVenda(venda, opcoes = {}) {
    const incluirDevolucao = opcoes.incluirDevolucao !== false;
    const id = Number(venda.id);
    const dropdownId = `acoesVenda${id}`;
    const cancelada = String(venda.status || '').toLowerCase() === 'cancelada';
    const modoFiscal = historicoVendaModoFiscalAtivo();

    const temFiscal = typeof vendaPossuiNfceAutorizada === 'function' && vendaPossuiNfceAutorizada(venda);
    const temNaoFiscal = !modoFiscal && typeof vendaPossuiCupomNaoFiscal === 'function' && vendaPossuiCupomNaoFiscal(venda);
    const nfceNumero = venda.nfce_numero ? ` #${venda.nfce_numero}` : '';

    const blocoImpressao = (temFiscal || temNaoFiscal) ? `
        <li><hr class="dropdown-divider my-1"></li>
        ${temFiscal ? `
        <li>
            <button type="button" class="dropdown-item py-2" onclick="reimprimirCupomFiscalHistorico(${id})">
                <i class="fas fa-print fa-fw me-2 text-muted"></i>Cupom fiscal${escapeHtmlHistoricoVenda(nfceNumero)}
            </button>
        </li>` : ''}
        ${temNaoFiscal ? `
        <li>
            <button type="button" class="dropdown-item py-2" onclick="reimprimirCupomNaoFiscalHistorico(${id})">
                <i class="fas fa-receipt fa-fw me-2 text-muted"></i>Cupom não fiscal
            </button>
        </li>` : ''}
    ` : '';

    const blocoOperacional = !cancelada ? `
        <li><hr class="dropdown-divider my-1"></li>
        ${incluirDevolucao ? `
        <li>
            <button type="button" class="dropdown-item py-2" onclick="abrirDevolucaoVenda(${id})">
                <i class="fas fa-undo fa-fw me-2 text-muted"></i>Devolução parcial
            </button>
        </li>` : ''}
        <li>
            <button type="button" class="dropdown-item py-2 text-danger" onclick="cancelarVendaNaoFiscal(${id})">
                <i class="fas fa-times fa-fw me-2"></i>Cancelar venda
            </button>
        </li>
    ` : '';

    return `
        <div class="historico-venda-acoes">
            <button
                type="button"
                class="btn btn-sm btn-outline-primary"
                onclick="viewVenda(${id})"
                title="Ver detalhes"
            >
                <i class="fas fa-eye"></i>
            </button>
            <div class="dropdown d-inline-block">
                <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary historico-venda-acoes-menu"
                    id="${dropdownId}"
                    data-bs-toggle="dropdown"
                    data-bs-boundary="viewport"
                    aria-expanded="false"
                    title="Mais ações"
                >
                    <i class="fas fa-ellipsis-v"></i>
                </button>
                <ul class="dropdown-menu dropdown-menu-end historico-venda-acoes-dropdown shadow-sm" aria-labelledby="${dropdownId}">
                    <li>
                        <button type="button" class="dropdown-item py-2" onclick="viewVenda(${id})">
                            <i class="fas fa-eye fa-fw me-2 text-muted"></i>Ver detalhes
                        </button>
                    </li>
                    ${blocoImpressao}
                    <li>
                        <button type="button" class="dropdown-item py-2" onclick="verResumoVendaFiscalTEF(${id})">
                            <i class="fas fa-file-alt fa-fw me-2 text-muted"></i>Resumo NFC-e / TEF
                        </button>
                    </li>
                    ${blocoOperacional}
                </ul>
            </div>
        </div>
    `;
}

window.montarHtmlAcoesHistoricoVenda = montarHtmlAcoesHistoricoVenda;
window.historicoVendaModoFiscalAtivo = historicoVendaModoFiscalAtivo;
window.filtrarItensHistoricoVenda = filtrarItensHistoricoVenda;
window.obterTotalExibicaoHistoricoVenda = obterTotalExibicaoHistoricoVenda;
window.exibirCupomNaoFiscalHistorico = exibirCupomNaoFiscalHistorico;
