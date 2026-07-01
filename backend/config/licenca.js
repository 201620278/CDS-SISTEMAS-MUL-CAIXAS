const { getLicenseMasterKey } = require('./secrets');

module.exports = {
  get CHAVE_MESTRE() {
    return getLicenseMasterKey();
  }
};
