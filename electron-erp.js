const { iniciarAplicacaoElectron } = require('./electron-common');

process.env.CDS_APP_MODULO = process.env.CDS_APP_MODULO || 'erp';

iniciarAplicacaoElectron({
  tituloJanela: 'CDS ERP',
  modulo: 'erp'
});
