async function cancelarFiscal(
    transacaoId,
    motivo
) {

    const tefManager =
        require('./TefManager');

    return await tefManager.cancelar(
        transacaoId,
        motivo
    );

}

module.exports = {
    cancelarFiscal
};
