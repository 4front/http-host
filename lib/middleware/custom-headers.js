var _ = require('lodash');
var debug = require('debug')('4front:http-host:custom-headers');

module.exports = function(options) {
  return function(req, res, next) {
    var customHeaderPrefix = req.app.settings.customHttpHeaderPrefix;

    res.set(customHeaderPrefix + 'version-id',
      req.ext.virtualAppVersion.versionId);

    if (req.ext.webPagePath) {
      res.set(customHeaderPrefix + 'page-path', req.ext.webPagePath);
    }

    if (!_.isEmpty(req.ext.virtualAppVersion.name)) {
      res.set(customHeaderPrefix + 'version-name',
        req.ext.virtualAppVersion.name);
    }

    next();
  };
};
