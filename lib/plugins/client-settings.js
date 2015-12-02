// Append client settings to req.ext.clientConfig
module.exports = function(options) {
  return function(req, res, next) {
    if (!req.ext) req.ext = {};
    if (!req.ext.clientConfig) req.ext.clientConfig = {};

    req.ext.clientConfig.settings = options;
    next();
  };
};
