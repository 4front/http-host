module.exports = exports = createAppHost;

function createAppHost() {

}

exports.virtualAppLoader = require('./middleware/app-loader');
exports.devSandbox = require('./middleware/dev-sandbox');
exports.htmlPageStream = require('./middleware/page-stream')
exports.trafficControl = require('./middleware/traffic-control');

