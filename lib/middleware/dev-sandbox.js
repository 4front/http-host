var _ = require('lodash');
var jwt = require('jwt-simple');
var debug = require('debug')('4front:apphost:dev-sandbox');

require('simple-errors');

var defaultDevOptions = {
  port: '3000', // The localhost port
  buildType: 'debug',
  autoReload: '0'
};

module.exports = function(options) {
  options = _.defaults(options || {}, {
    cookieName: '_dev',
    queryParam: '_dev',
    sandboxFlashCookie: '_sandboxPage',
    showBanner: true
  });

  return function(req, res, next) {
    debug('executing');

    // Bypass simulator if the virtualEnv is not 'dev'
    if (req.ext.virtualEnv !== 'dev') return next();

    var token, devOptions;

    var devCookieName = (req.app.settings.cookiePrefix || '') + options.cookieName;

    // Special login path used to initialize the developer sandbox. Just copy
    // the query parameters to the _dev cookie and redirect to the root of the app.
    // Subsequent requests will read from the _dev cookie.
    if (req.path === '/__login') {
      debug('writing devOptions to cookie');

      // Clear the sandbox flash cookie
      res.clearCookie(req.app.settings.cookiePrefix + options.sandboxFlashCookie);

      devOptions = _.pick(req.query, _.keys(defaultDevOptions).concat('token'));

      token = validateDevToken(devOptions.token, req.app.settings.jwtTokenSecret);
      if (_.isError(token)) return next(token);

      res.cookie(devCookieName, devOptions, {httpOnly: true});
      return res.redirect('/');
    }

    // Load the dev options from the dev cookie
    var devCookie = req.cookies[devCookieName];

    if (!devCookie) {
      return next(Error.http(401, 'No ' + devCookieName + ' cookie set.', {
        help: 'Try running \'4front dev\' again.',
        code: 'missingDevCookie',
        bypassCustomErrorPage: true
      }));
    }

    // Load the developer's personal options from the _dev cookie
    // Apply the default dev options to the values from the cookie
    devOptions = _.extend(_.defaults({}, devCookie, defaultDevOptions), {
      cookieName: options.sandboxFlashCookie
    });

    token = validateDevToken(devOptions.token, req.app.settings.jwtTokenSecret);
    if (_.isError(token)) return next(token);

    // Store the 4front userId of the current developer
    req.ext.developerId = token.iss;
    req.ext.clientConfig.sandbox = true;

    // Get the app manifest from cache
    var manifestCacheKey = req.ext.developerId + '/' + req.ext.virtualApp.appId + '/_manifest';
    req.app.settings.cache.get(manifestCacheKey, function(err, manifestJson) {
      if (err) return next(err);

      var manifest = null;
      try {
        manifest = JSON.parse(manifestJson);
      } catch (jsonErr) {
        manifest = null;
      }

      if (manifest === null) {
        return next(Error.http(400, 'Invalid JSON manifest', {
          bypassCustomErrorPage: true,
          help: 'Try re-starting the dev sandbox with the command \'4front dev\'',
          code: 'invalidJsonManifest'
        }));
      }

      _.merge(req.ext, {
        // Specify custom middleware to handle loading the html page stream.
        // This will override the default behavior of loading from the
        // app.settings.storage object.
        devOptions: devOptions,
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
          autoReload: devOptions.autoReload === '1',
          // Run autoReload on the same port as the sandbox
          sandboxPort: devOptions.port,
          assetPath: '//localhost:' + devOptions.port,
          inject: {}
        }
      });

      next();
    });
  };

  // Validate the devOptions are valid
  function validateDevToken(encodedToken, tokenSecret) {
    // Validate the auth token
    if (_.isEmpty(encodedToken)) {
      return Error.http(401, 'Missing dev token.', {
        bypassCustomErrorPage: true,
        code: 'missingDevToken',
        help: 'Try re-starting the dev sandbox with \'4front dev\''
      });
    }

    var token;
    if (_.isEmpty(encodedToken) === false) {
      debug('decoding token %s', encodedToken);
      try {
        token = jwt.decode(encodedToken, tokenSecret);
      } catch (err) {
        return Error.http(401, 'Invalid dev token.', {
          bypassCustomErrorPage: true,
          code: 'invalidDevToken',
          help: 'Try re-starting the dev sandbox with \'4front dev\''
        });
      }
    }

    if (token.exp < Date.now()) {
      debug('token expired at %s', token.exp);

      return Error.http(401, 'Token expired', {
        bypassCustomErrorPage: true,
        code: 'expiredDevToken',
        help: 'Please re-start the dev sandbox with the `4front dev` command.'
      });
    }

    return token;
  }
};
