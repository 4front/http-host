module.exports = exports = createAppHost;

function createAppHost() {

}

exports.virtualAppLoader = require('./middleware/app-loader');
exports.devSandbox = require('./middleware/dev-sandbox');
exports.indexPage = require('./middleware/index-page');
exports.htmlPage = require('./middleware/html-page');
exports.trafficControl = require('./middleware/traffic-control');
exports.logout = require('./middleware/logout');
exports.authenticated = require('./middleware/authenticated');