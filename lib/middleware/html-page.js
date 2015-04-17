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
    htmlprep: true,
    returnUrlCookie: 'returnUrl'
  });

  return function(req, res, next) {
    debug('executing');
    req.ext.requestHandler = 'html-page';

    var error = helper.requiredOptionsError(req.ext, 'virtualApp', 'virtualAppVersion');
    if (error)
      return next(Error.http(400, error));

    // req.path returns the path that the route was mounted, which
    // for a value like '/*' will always return '/'. Need to look
    // instead at req.originalUrl.
    var actualUrl = parseUrl(req.originalUrl);

    if (options.canonicalRedirects === true) {
      var canonicalPath = getCanonicalPath(actualUrl);
      if (canonicalPath)
        return res.redirect(301, canonicalPath + (actualUrl.search ? actualUrl.search : ''));
    }

    if (options.pushState === true || actualUrl.pathname === '/')
      req.ext.htmlPagePath = options.defaultPage;
    else
      req.ext.htmlPagePath = actualUrl.pathname.substr(1); // chop off leading slash

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

      if (options.noAuthPage) {
        if (actualUrl.pathname === '/')
          req.ext.htmlPagePath = options.noAuthPage;
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

    if (!_.isObject(req.app.settings.deployments))
      return next(new Error("Expected object at req.app.settings.deployments"));

    var versionId = req.ext.virtualAppVersion.versionId;
    var versionName = req.ext.virtualAppVersion.name;

    // Ensure the page path is .html
    if (path.extname(req.ext.htmlPagePath).length === 0)
      req.ext.htmlPagePath += '.html';

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
      req.ext.htmlPageStream = req.app.settings.deployments.readFileStream(
        req.ext.virtualApp.appId,
        versionId,
        req.ext.htmlPagePath);

      streamResponse();
    }

    function streamResponse() {
      // http://www.bennadel.com/blog/2678-error-events-don-t-inherently-stop-streams-in-node-js.htm
      var missingEventFired = false;
      req.ext.htmlPageStream.on('missing', function() {
        missingEventFired = true;

        debug('missing event emitted by page stream');
        // If the requested page was not found, set the status code
        // and advance to the next middleware. If the custom-errors
        // route is configured, it will handle returning the
        // custom error page.
        return next(Error.http(404, 'Page ' + req.ext.pagePath + ' not found', {code: 'pageNotFound'}));
      })
      .on('error', function(err) {
        if (missingEventFired === true) return;
        return next(new Error("Could not read page " + req.ext.pagePath + " from storage: " + err.stack));
      });

      var htmlOptions;
      if (options.htmlprep !== false) {
        htmlOptions = buildHtmlOptions(req, versionId, versionName);
      }

      res.set('Content-Type', 'text/html');
      res.set('Virtual-App-Version', versionId);
      res.set('Virtual-App-Page', req.ext.htmlPagePath);

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
        req.ext.htmlPageStream = req.ext.htmlPageStream.pipe(htmlprep(htmlOptions));
      }

      req.ext.htmlPageStream.pipe(res);
    }
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
      buildType:  req.ext.buildType || 'release',
      pagePath: req.ext.htmlPagePath,
      user: req.user,
      assetPath: versionAssetPath,
      appId: req.ext.virtualApp.appId,
      appName: req.ext.virtualApp.name,
      virtualEnv: req.ext.virtualEnv
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
