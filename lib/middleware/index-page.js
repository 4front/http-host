var _ = require('lodash');
var debug = require('debug')('4front:apphost:index-page');
var htmlprep = require('htmlprep');

require('simple-errors');

exports = module.exports = function(options) {
  options = _.defaults(options || {}, {
    clientConfigVar: '__config__',  // Name of the global config variable 
    htmlprep: {}
  });

  var requiredOptions = ['readPageStream'];
  for (var i=0;i<requiredOptions.length;i++) {
    if (_.isUndefined(options[requiredOptions[i]]))
      throw new Error("Required option " + requiredOptions[i] + " not provided");
  }

  return function(req, res, next) {
    debug("htmlPageRenderer middleware");

    if (!req.ext.virtualApp)
      return next(Error.http(404, "There is no req.ext.virtualApp defined"));

    if (_.isObject(req.ext.virtualAppVersion) === false)
      return next(Error.http(404, "There is not req.ext.virtualAppVersion defined"));

    var virtualApp = req.ext.virtualApp;
    
    debug('index page middleware executing');

    _.defaults(req.ext, {
      clientConfig: {},
      htmlPageName: 'index'
    });

    // Lookup the indexPage from storage
    var stream = options.readPageStream(req.ext.virtualApp, req.ext.virtualAppVersion, req.ext.htmlPageName, next);

    // If no static asset host provided, use the 
    if (!options.assetHost)
      options.assetHost = req.hostname + '/_p/asset';

    // The URL path for the static assets for this version are fingerprinted with the appId and versionId.
    // This allows for very aggressive cache headers as every new version results in new URLs
    var versionAssetPath;
    if (options.assetHost)
      versionAssetPath = '//' + options.assetHost;
    else
      versionAssetPath = '//' + req.hostname + '/_p/asset';

    versionAssetPath += '/' + virtualApp.appId + '/' + req.ext.virtualAppVersion.versionId;

    _.extend(req.ext.clientConfig, {
      versionId: req.ext.virtualAppVersion.versionId,
      versionName: req.ext.virtualAppVersion.name,
      buildType: 'release',
      pageName: req.ext.htmlPageName,
      assetPath: versionAssetPath,
      assetHost: options.assetHost
    });

    _.extend(options.htmlprep, {
      buildType: 'release',
      assetPathPrefix: versionAssetPath
    });

    if (_.isObject(options.htmlprep.inject) === false)
      options.htmlprep.inject = {};

    // Inject a __config__ block into the head of the page with the client configuration settings.
    var headBlock = '<script>' + options.clientConfigVar + '=' + JSON.stringify(req.ext.clientConfig) + ';</script>';

    // Force the headScript to come before anything already specified in htmlprep.inject.head.
    if (options.htmlprep.inject.head)
      options.htmlprep.inject.head = (headBlock + options.htmlprep.inject.head);
    else
      options.htmlprep.inject.head = headBlock;

    res.set('Content-Type', 'text/html');
    stream
      .pipe(htmlprep(options.htmlprep))
      .pipe(res);
  };
};