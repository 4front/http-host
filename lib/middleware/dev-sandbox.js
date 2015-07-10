var _ = require('lodash');
var querystring = require('querystring');
var url = require('url');
var stream = require('stream');
var jwt = require('jwt-simple');
var cookieParser = require('cookie-parser');
var debug = require('debug')('4front:apphost:dev-sandbox');
var helper = require('../helper');
var isStaticAsset = require('../is-static-asset');

require('simple-errors');

var defaultDevOptions = {
  port: '3000', // The localhost port
  buildType: 'debug',
  liveReload: '1'
};

// TODO: This should move to the dev-sandbox-page if possible
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

    // Special login path used to initialize the developer sandbox. Just copy
    // the query parameters to the _dev cookie and redirect to the root of the app.
    // Subsequent requests will read from the _dev cookie.
    if (req.path === '/__login') {
      debug("writing devOptions to cookie");
      var devOptions = _.pick(req.query, _.keys(defaultDevOptions).concat('token'));

      var token = validateDevToken(devOptions.token, req.app.settings.jwtTokenSecret);
      if (_.isError(token))
        return next(token);

      res.cookie(options.cookieName, devOptions, {httpOnly: true});
      return res.redirect('/');
    }

    // Load the dev options from the dev cookie
    var devCookie = req.cookies[options.cookieName];

    if (!devCookie) {
      return next(Error.http(401, "No " + options.cookieName + " cookie set. Try running '4front dev' again.", {
        code: "missingDevCookie",
        bypassCustomErrorPage: true
      }));
    }

    // Load the developer's personal options from the _dev cookie
    // Apply the default dev options to the values from the cookie
    var devOptions = _.defaults({}, devCookie, defaultDevOptions);

    var token = validateDevToken(devOptions.token, req.app.settings.jwtTokenSecret);
    if (_.isError(token))
      return next(token);

    // Put a minimal user object on req.ext to be consistent with how
    // it is configured other places like the api.
    req.ext.user = {
      userId: token.iss
    };

    // If this is a request for a static asset or an XHR request for an .html file, redirect back to localhost.
    if (isStaticAsset.anyExceptHtml(req) || isStaticAsset.htmlXhr(req)) {
      return res.redirect((req.secure ? 'https' : 'http') + "://localhost:" + devOptions.port + req.path);
    }

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
        // app.settings.storage object.
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

  // Validate the devOptions are valid
  function validateDevToken(encodedToken, tokenSecret) {
    // Validate the auth token
    if (_.isEmpty(encodedToken)) {
      return Error.http(401, "Missing dev token.", {
        bypassCustomErrorPage: true,
        code: "missingDevToken",
        help: "Try re-starting the dev sandbox with '4front dev'"
      });
    }

    var token;
    if (_.isEmpty(encodedToken) === false) {
      debug("decoding token %s", encodedToken);
      try {
        token = jwt.decode(encodedToken, tokenSecret);
      }
      catch (err) {
        return Error.http(401, "Invalid dev token.", {
          bypassCustomErrorPage: true,
          code: "invalidDevToken",
          help: "Try re-starting the dev sandbox with '4front dev'"
        });
      }
    }

    if (token.exp < Date.now()) {
      debug("token expired at %s", token.exp);

      return Error.http(401, "Token expired", {
        bypassCustomErrorPage: true,
        code: "expiredDevToken",
        help: "Please re-start the dev sandbox with the `4front dev` command."
      });
    }

    return token;
  }
};
