var urljoin = require('url-join');
var parseUrl = require('url').parse;
var _ = require('lodash');
var htmlprep = require('htmlprep');
var debug = require('debug')('4front:apphost:pipe-html-response');

module.exports = function(options) {
  _.defaults(options, {
    htmlprep: true,
    contentType: 'text/html',
    clientConfigVar: '__4front__'
  });

  return function(req, res) {
    var versionId = req.ext.virtualAppVersion.versionId;
    var versionName = req.ext.virtualAppVersion.name;

    res.set('Content-Type', options.contentType);
    res.set('Virtual-App-Version', versionId);
    res.set('Virtual-App-Page', req.ext.webPagePath);
    res.set('Virtual-App-Version-Name', versionName);

    var cacheControl = null;
    if (options.maxAge)
      cacheControl = 'max-age=' + options.maxAge;
    else if (options.cacheControl)
      cacheControl = options.cacheControl;
    else
      cacheControl = 'no-cache';

    res.set('Cache-Control', cacheControl);

    var htmlOptions;
    if (options.contentType === 'text/html' && options.htmlprep !== false) {
      debug("piping page stream through htmlprep");

      htmlOptions = buildHtmlOptions(req, versionId, versionName);
      req.ext.webPageStream = req.ext.webPageStream.pipe(htmlprep(htmlOptions));
    }

    req.ext.webPageStream.pipe(res);
  };

  function buildHtmlOptions(req, versionId, versionName) {
    var htmlOptions;

    if (!req.ext.clientConfig)
      req.ext.clientConfig = {};

    var versionAssetPath = req.ext.versionAssetPath;
    if (!versionAssetPath) {
      versionAssetPath = urljoin(req.app.settings.deployedAssetsPath,
        req.ext.virtualApp.appId, versionId);

      // If the versionAssetPath does not have a protocol or does
      // not start with a leading slash (used when assets are hosted on the same
      // domain), prepend a double slash which the browser will translate into
      // an absolute url with the same protocol as the host page.
      if (!parseUrl(versionAssetPath).protocol && versionAssetPath[0] !== '/')
        versionAssetPath = '//' + versionAssetPath;
    }

    _.extend(req.ext.clientConfig, {
      buildType: req.ext.buildType || 'release',
      webPagePath: req.ext.webPagePath,
      // Only expose a subset of user properties to the client
      user: _.pick(req.ext.user, 'userId', 'username', 'avatar'),
      staticAssetPath: versionAssetPath,
      appId: req.ext.virtualApp.appId,
      appName: req.ext.virtualApp.name,
      virtualEnv: req.ext.virtualEnv,
      versionName: versionName
    });

    // Clone the options so that we aren't modifying shared state
    if (!_.isObject(options.htmlprep))
      htmlOptions = {};
    else
      htmlOptions = _.cloneDeep(options.htmlprep);

    _.defaults(htmlOptions, req.ext.htmlOptions, {
      inject: {}
    });

    _.extend(htmlOptions, {
      buildType: req.ext.buildType || 'release',
      assetPathPrefix: versionAssetPath
    }, _.pick(req.ext.htmlOptions || {}, 'deployedAssetsPath'));

    // Merge up the head block making sure the __config__ declaration comes first
    var headBlock = '<script>' +
      options.clientConfigVar + '=' + JSON.stringify(req.ext.clientConfig || {}) +
      ';</script>';

    htmlOptions.inject.head = headBlock + (htmlOptions.inject.head || '');

    // If autoReload is enabled, inject the client script at the end of the html body
    if (htmlOptions.autoReload === true) {
      var autoReloadPort = req.ext.htmlOptions.sandboxPort;
      var autoReloadUrl = "//localhost:" + autoReloadPort + "/static/autoreload.js";

      var autoReloadScript = "<script src='//localhost:" + autoReloadUrl + "'></script>" +
        "<script>window.__autoReload = new AutoReload({port:" + autoReloadPort + "});" +
        "window.__autoReload.watch();</script>";

      htmlOptions.inject.body = autoReloadScript + (htmlOptions.body || '');
    }

    return htmlOptions;
  }
};
