var _ = require('lodash');
var path = require('path');
var parseUrl = require('url').parse;
var htmlprep = require('htmlprep');
var debug = require('debug')('4front:html-page');
var helper = require('../helper');

require('simple-errors');

module.exports = function(options) {
  options = _.defaults(options || {}, {
    defaultPage: 'index.html',
    auth: false,
    clientConfigVar: '__config__',
    assetPath: '/static',
    canonicalRedirects: false,
    htmlprep: true
  });

  return function(req, res, next) {
    debug('executing');
    
    var error = helper.requiredOptionsError(req.ext, 'virtualApp');
    if (error)
      return next(Error.http(400, error));

    // req.path returns the path that the route was mounted, which
    // for a value like '/*' will always return '/'. Need to look 
    // instead at req.originalUrl.
    var actualUrl = parseUrl(req.originalUrl);

    if (options.canonicalRedirects === true) {
      debugger;
      var canonicalPath = getCanonicalPath(actualUrl);
      if (canonicalPath)
        return res.redirect(301, canonicalPath + (actualUrl.search ? actualUrl.search : ''));
    }

    if (options.pushState === true || actualUrl.pathname === '/')
      req.ext.pageName = options.defaultPage;
    else
      req.ext.pageName = actualUrl.pathname.substr(1) + '.html';

    var ensureAuthenticated;
    if (_.isFunction(options.auth))
      ensureAuthenticated = options.auth(req);
    else if (_.isBoolean(options.auth))
      ensureAuthenticated = options.auth;
    else 
      ensureAuthenticated = false;

    if (ensureAuthenticated && req.ext.isAuthenticated !== true) {
      debug("logging out user");
      if (req.session)
        req.session.destroy();

      if (options.noAuthPage)
        req.ext.pageName = options.noAuthPage;
      else if (options.noAuthUrl)
        return res.redirect(options.noAuthUrl);
      else
        return next(Error.http(401, "User is not authenticated."));
    }

    var assetStorage = req.ext.assetStorage || req.app.settings.assetStorage;
    if (!_.isObject(assetStorage))
      return next(new Error("Expected object at req.app.settings.storage"));

    var versionId, versionName;
    if (_.isObject(req.ext.virtualAppVersion)) {
      versionId = req.ext.virtualAppVersion.versionId;
      versionName = req.ext.virtualAppVersion.name;
    }
    else {
      versionId = 'latest';
      versionName = 'latest';
    }

    var pageStream = assetStorage.createReadStream(
      req.ext.virtualApp.appId, versionId, req.ext.pageName);

    // http://www.bennadel.com/blog/2678-error-events-don-t-inherently-stop-streams-in-node-js.htm
    var missingEventFired = false;
    pageStream.on('missing', function() {
      missingEventFired = true;

      debug('missing event emitted by page stream');
      // If the requested page was not found, set the status code
      // and advance to the next middleware. If the custom-errors
      // route is configured, it will handle returning the 
      // custom error page.
      return next(Error.http(404, 'Page ' + req.ext.pageName + ' not found'));
    })
    .on('error', function(err) {
      if (missingEventFired === true) return;
      return next(new Error("Could not read page " + req.ext.pageName + " from storage: " + err.stack));
    });

    var htmlOptions;
    if (options.htmlprep !== false) {
      htmlOptions = buildHtmlOptions(req, versionId, versionName);
    }

    res.set('Content-Type', 'text/html');
    res.set('Virtual-App-Version', versionId);
    res.set('Virtual-App-Page', req.ext.pageName);

    var cacheControl = null;
    if (options.maxAge)
      cacheControl = 'max-age=' + options.maxAge;
    else if (options.cacheControl)
      cacheControl = options.cacheControl;
    else
      cacheControl = 'no-cache';

    res.set('Cache-Control', cacheControl);

    if (htmlOptions) {
      debug("piping page stream through htmlprep");
      pageStream = pageStream.pipe(htmlprep(htmlOptions));
    }

    pageStream.pipe(res);
  };

  function buildHtmlOptions(req, versionId, versionName) {
    var htmlOptions;
    
    if (!req.ext.clientConfig)
      req.ext.clientConfig = {};

    var versionAssetPath = req.ext.versionAssetPath;
    if (!versionAssetPath) {
      if (options.assetPath.slice(0, 2) === '//')
        versionAssetPath = '/' + path.join(options.assetPath, req.ext.virtualApp.appId, versionId);
      else
        versionAssetPath = path.join(options.assetPath, versionId);
    }

    _.extend(req.ext.clientConfig, {
      versionId: versionId,
      versionName: versionName,
      buildType:  req.ext.buildType || 'release',
      pageName: req.ext.pageName,
      user: req.user,
      virtualEnv: req.ext.virtualEnv,
      assetPath: versionAssetPath
    });

    // Clone the options so that we aren't modifying shared state
    if (!_.isObject(options.htmlprep))
      htmlOptions = {};
    else
      htmlOptions = _.cloneDeep(options.htmlprep);

    _.defaults(htmlOptions, {
      inject: {}
    });

    _.extend(htmlOptions, {
      buildType: req.ext.buildType || 'release',
      assetPathPrefix: versionAssetPath
    }, _.pick(req.ext.htmlOptions || {}, 'liveReload', 'liveReloadPort', 'assetPath'));

    // Merge up the head block making sure the __config__ declaration comes first
    var headBlock = '<script>' + options.clientConfigVar + '=' + JSON.stringify(req.ext.clientConfig || {}) + ';</script>';
    if (htmlOptions.inject && htmlOptions.inject.head)
      headBlock += htmlOptions.inject.head;
    if (req.ext.htmlOptions && req.ext.htmlOptions.inject && req.ext.htmlOptions.inject.head)
      headBlock += req.ext.htmlOptions.inject.head;

    htmlOptions.inject.head = headBlock;
    
    return htmlOptions;
  }

  function getCanonicalPath(actualUrl) {
    var canonicalPath;

    // Check trailing slash
    if (actualUrl.pathname.slice(-1) === '/')
      canonicalPath = actualUrl.pathname.slice(0, -1).toLowerCase();
    else if (actualUrl.pathname.slice(-5) === '.html')
      canonicalPath = actualUrl.pathname.slice(0, -5).toLowerCase();
    else if (/[A-Z]/.test(actualUrl.pathname))
      canonicalPath = actualUrl.pathname.toLowerCase();

    return canonicalPath;
  }
};