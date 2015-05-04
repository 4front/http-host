var _ = require('lodash');
var querystring = require('querystring');
var url = require('url');
var stream = require('stream');
var jwt = require('jwt-simple');
var cookieParser = require('cookie-parser');
var debug = require('debug')('4front:apphost:dev-sandbox');
var helper = require('../helper');

require('simple-errors');

var defaultDevOptions = {
  port: '3000', // The localhost port
  buildType: 'debug',
  liveReload: '1'
};

var simulatorBannerCss = '<style>body::after{background-image:url(//dbk9m70a68ku7.cloudfront.net/simulator.gif);position: fixed;right:0px;top:0px;width:150px;height:150px;z-index:10000;content:""}</style>';

module.exports = function(options) {
  options = _.defaults(options || {}, {
    cookieName: '_dev',
    queryParam: '_dev',
    showBanner: true
  });

  return function(req, res, next) {
    debug("dev-simulator middleware");

    // Bypass simulator if the virtualEnv is not 'dev'
    if (req.ext.virtualEnv !== 'dev')
      return next();

    // Load the developer's personal options from the _dev cookie
    var devOptions = req.cookies[options.cookieName] || {};

    // Check if this request has a file extension like .jpg, .js, .css, etc. These requests should be
    // redirected back to localhost.
    var reqHasFileExtension = /\.[a-z]{2,4}$/.test(req.path);
    if (reqHasFileExtension) {
      return res.redirect((req.secure ? 'https' : 'http') + "://localhost:" + (devOptions.port || defaultDevOptions.port) + req.path);
    }

    // Check if the userId and appId are present in the querystring
    // If so, store them in a cookie and redirect to the same url
    // with the dev params stripped off. Need to do this so that we keep a
    // pristine querystring. Trying to maintain the querystring as the
    // developer navigates around the app interferes with client JS routers.

    if (_.isEmpty(req.query[options.queryParam]) === false) {
      devOptions = querystring.parse(decodeURIComponent(req.query[options.queryParam]));

      // Set a cookie with the devParams
      debug("writing devOptions to cookie and redirecting to url: %s", JSON.stringify(devOptions));
      res.cookie(options.cookieName, devOptions, {httpOnly: true});

      var originalUrl = url.parse(req.originalUrl, false);
      originalUrl.search = null;

      var redirectUrl = originalUrl.pathname;

      var remainingQuery = _.omit(req.query, options.queryParam);
      if (_.isEmpty(remainingQuery) === false)
        redirectUrl += '?' + querystring.stringify(remainingQuery);

      return res.redirect(redirectUrl);
    }

    var token;
    if (_.isEmpty(devOptions.token) === false) {
      try {
        token = jwt.decode(devOptions.token, req.app.settings.jwtTokenSecret);
      }
      catch (err) {
        debug("could not decode jwt");
      }
    }

    if (!token) {
      return next(Error.http(400, "Invalid " + options.cookieName + " cookie.", {
        bypassCustomErrorPage: true,
        help: "Try re-starting the dev sandbox with '4front dev'"
      }));
    }

    if (token.exp < Date.now()) {
      return next(Error.http(401, "Token expired", {
        bypassCustomErrorPage: true,
        help: "Please re-start the dev sandbox with the `4front dev` command."
      }));
    }

    // Put a minimal user object on req.ext to be consistent with how
    // it is configured other places like the api.
    req.ext.user = {
      userId: token.iss
    };

    // Apply the default dev options to the values from the cookie
    _.defaults(devOptions, defaultDevOptions);

    req.ext.clientConfig.sandbox = true;

    // Get the app manifest from cache
    req.app.settings.cache.get(req.ext.user.userId + '/' + req.ext.virtualApp.appId + '/_manifest', function(err, manifestJson) {
      if (err) return next(err);

      var manifest;
      try {
        manifest = JSON.parse(manifestJson);
      }
      catch (err) {
        return next(Error.http(400, "Invalid JSON manifest", {
          bypassCustomErrorPage: true,
          help: "Try re-starting the dev sandbox with the command '4front dev'",
          code: 'invalidJsonManifest'
        }));
      }

      _.merge(req.ext, {
        // Specify custom middleware to handle loading the html page stream.
        // This will override the default behavior of loading from the
        // app.settings.deployments object.
        loadPageMiddleware: require('./dev-sandbox-page')(devOptions),
        virtualAppVersion: {
          versionId: 'sandbox',
          name: 'sandbox',
          manifest: manifest
        },
        versionAssetPath: '//localhost:' + devOptions.port,
        buildType: devOptions.buildType,
        // Override the cache-control. We never want to cache pages served by the dev sandbox
        cacheControl: 'no-cache',
        htmlOptions: {
          liveReload: devOptions.liveReload === '1',
          assetPath: '//localhost:' + devOptions.port,
          inject: {}
        }
      });
      
      if (options.showBanner === true) {
        debug("add simulator banner to headCssBlocks");
        req.ext.htmlOptions.inject.head = simulatorBannerCss;
      }

      next();
    });
  };
};
