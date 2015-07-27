var _ = require('lodash');
var path = require('path');
var urljoin = require('url-join');
var parseUrl = require('url').parse;
var htmlprep = require('htmlprep');
var debug = require('debug')('4front:apphost:webpage');
var helper = require('../helper');

require('simple-errors');

module.exports = function(options) {
  options = _.defaults(options || {}, {
    defaultPage: 'index.html',
    auth: false,
    clientConfigVar: '__4front__',
    canonicalRedirects: false,
    htmlprep: true,
    returnUrlCookie: 'returnUrl',
    contentType: 'text/html',
    pushState: false,
    defaultFileExtension: '.html'
  });

  return function(req, res, next) {
    debug('executing');
    req.ext.requestHandler = 'webpage';

    var error = helper.requiredOptionsError(req.ext, 'virtualApp', 'virtualAppVersion');
    if (error)
      return next(Error.http(400, error));

    // req.path returns the path that the route was mounted, which
    // for a value like '/*' will always return '/'. Need to look
    // instead at req.originalUrl.
    var actualUrl = parseUrl(req.originalUrl);

    if (options.contentType == 'text/html' && options.canonicalRedirects === true) {
      var canonicalPath = getCanonicalPath(actualUrl);
      if (canonicalPath)
        return res.redirect(301, canonicalPath + (actualUrl.search ? actualUrl.search : ''));
    }

    if (options.pushState === true || actualUrl.pathname === '/')
      req.ext.webPagePath = options.defaultPage;
    else
      req.ext.webPagePath = actualUrl.pathname;

    // Chop off the leading slash
    if (req.ext.webPagePath[0] === '/')
      req.ext.webPagePath = req.ext.webPagePath.slice(1);

    // If the path has a trailing slash, append the default page
    if (req.ext.webPagePath.slice(-1) === '/')
      req.ext.webPagePath = urljoin(req.ext.webPagePath, options.defaultPage);

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

      // If there is a noAuthPage render it as part of this
      // http request without redirecting to a different URL.
      // This is useful for single page apps where everything
      // is served off the base path '/'.
      if (_.isEmpty(options.noAuthPage) === false) {
        if (actualUrl.pathname === '/')
          req.ext.webPagePath = options.noAuthPage;
        else {
          // Set a cookie with the intended URL so that it can be used to go directly there
          // upon authenticating.
          res.cookie(options.returnUrlCookie, req.originalUrl, {httpOnly: true});
          return res.redirect('/');
        }
      }
      else if (options.noAuthUrl)
        return res.redirect(options.noAuthUrl);
      else
        return next(Error.http(401, "User is not authenticated."));
    }

    if (!_.isObject(req.app.settings.storage))
      return next(new Error("Expected object at req.app.settings.storage"));

    var versionId = req.ext.virtualAppVersion.versionId;
    var versionName = req.ext.virtualAppVersion.name;

    // Ensure there is a file extension
    if (path.extname(req.ext.webPagePath).length === 0)
      req.ext.webPagePath += options.defaultFileExtension;

    // Look for a custom createReadStream implementation on req.ext.
    // This is how the dev-sandbox forces the html page to be piped
    // from the private developer cache rather than from storage.
    if (_.isFunction(req.ext.loadPageMiddleware)) {
      req.ext.loadPageMiddleware(req, res, function(err) {
        if (_.isError(err)) return next(err);

        streamResponse();
      });
    }
    else {
      req.ext.webPageStream = req.app.settings.storage.readFileStream(
        urljoin(req.ext.virtualApp.appId,
          versionId,
          req.ext.webPagePath));

      streamResponse();
    }

    function streamResponse() {
      // http://www.bennadel.com/blog/2678-error-events-don-t-inherently-stop-streams-in-node-js.htm
      var missingEventFired = false;
      req.ext.webPageStream.on('missing', function() {
        missingEventFired = true;

        debug('missing event emitted by page stream');
        // If the requested page was not found, pass control through to the next
        // middleware.
        return next();
      })
      .on('error', function(err) {
        if (missingEventFired === true) return;
        return next(new Error("Could not read page " + req.ext.webPagePath + " from storage: " + err.stack));
      });

      res.set('Content-Type', options.contentType);
      res.set('Virtual-App-Version', versionId);
      res.set('Virtual-App-Page', req.ext.webPagePath);

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
    }
  };

  function buildHtmlOptions(req, versionId, versionName) {
    var htmlOptions;

    if (!req.ext.clientConfig)
      req.ext.clientConfig = {};

    var versionAssetPath = req.ext.versionAssetPath;
    if (!versionAssetPath) {
      versionAssetPath = urljoin(req.app.settings.deployedAssetsPath, req.ext.virtualApp.appId, versionId);

      // If the versionAssetPath does not have a protocol or does
      // not start with a leading slash (used when assets are hosted on the same
      // domain), prepend a double slash which the browser will translate into
      // an absolute url with the same protocol as the host page.
      if (!parseUrl(versionAssetPath).protocol && versionAssetPath[0] != '/')
        versionAssetPath = '//' + versionAssetPath;
    }

    _.extend(req.ext.clientConfig, {
      buildType:  req.ext.buildType || 'release',
      webPagePath: req.ext.webPagePath,
      user: req.ext.user,
      staticAssetPath: versionAssetPath,
      appId: req.ext.virtualApp.appId,
      appName: req.ext.virtualApp.name,
      virtualEnv: req.ext.virtualEnv
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
    }, _.pick(req.ext.htmlOptions || {}, 'liveReload', 'deployedAssetsPath'));

    // Merge up the head block making sure the __config__ declaration comes first
    var headBlock = '<script>' + options.clientConfigVar + '=' + JSON.stringify(req.ext.clientConfig || {}) + ';</script>';
    htmlOptions.inject.head = headBlock + (htmlOptions.inject.head || '');

    return htmlOptions;
  }

  function getCanonicalPath(actualUrl) {
    var canonicalPath;

    // Check trailing slash
    if (actualUrl.pathname.slice(-5) === '.html')
      canonicalPath = actualUrl.pathname.slice(0, -5).toLowerCase();
    else if (/[A-Z]/.test(actualUrl.pathname))
      canonicalPath = actualUrl.pathname.toLowerCase();

    return canonicalPath;
  }
};
