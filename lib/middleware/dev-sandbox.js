var _ = require('lodash');
var querystring = require('querystring');
var url = require('url');
var stream = require('stream');
var cookieParser = require('cookie-parser');
var debug = require('debug')('4front:dev-sandbox');
var helper = require('../helper');

require('simple-errors');

var defaultDevOptions = { 
  port: '3000', // The localhost port
  buildType: 'debug',
  liveReload: '1'
};

var simulatorBannerCss = '<style>body::after{background-image:url(//dbk9m70a68ku7.cloudfront.net/simulator.gif);position: fixed;right:0px;top:0px;width:150px;height:150px;z-index:10000;content:""}</style>';

exports = module.exports = function(options) {
  options = _.defaults(options || {}, {
    cookieName: '_dev',
    queryParam: '_dev',
    showBanner: true,
    cache: null
  });

  helper.ensureRequiredOptions(options, 'cache');

  return function(req, res, next) {
    debug("dev-simulator middleware");

    // Bypass simulator if the virtualEnv is not 'dev'
    if (req.ext.virtualEnv !== 'dev')
      return next();

    // Ensure required attributes exist on the extended request.
    var error = helper.requiredOptionsError(req.ext, 'virtualApp', 'virtualEnv');
    if (error)
      return next(error);

    if (req.query.sim === '1')
      return next(new Error('The URL convention for running the simulator has changed. Please update to the latest version of yoke with "npm update -g yoke-cli"'));

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

    if (_.isEmpty(devOptions.user))
      return next(Error.http(400, "No user parameter found in the found in the " + options.cookieName + " cookie. Please restart the dev simulator."));

    // Apply the default dev options to the values from the cookie
    _.defaults(devOptions, defaultDevOptions);

    req.ext.clientConfig.simulator = true;

    req.ext.htmlOptions 
    
    _.extend(req.ext, {
      virtualAppVersion: {
        versionId: 'sandbox',
        name: 'sandbox'
      },
      assetStorage: {
        createReadStream: function(appId, versionId, pageName) {
          var cacheKey = appId + ':' + devOptions.user + ':' + pageName;
          
          debug('streaming %s from cache', cacheKey);
          var dataStreamed = false;
          return options.cache.readStream(cacheKey)
            .on('data', function(data) {
              dataStreamed = true;
            })
            .on('end', function() {
              if (!dataStreamed) {
                debug("no data returned from cache for key %s", cacheKey);
                return next(Error.http(404, 'Page ' + pageName + ' not found in sandbox cache.', {
                  help: 'Try restarting the development sandbox.'
                }));
              }
            });
        }
      },
      versionAssetPath: '//localhost:' + devOptions.port,
      buildType: devOptions.buildType,
      htmlOptions: {
        liveReload: devOptions.liveReload === '1',
        liveReloadPort: devOptions.liveReloadPort,
        assetPath: '//localhost:' + devOptions.port
      }
    });

    if (options.showBanner === true) {
      debug("add simulator banner to headCssBlocks");
      req.ext.htmlOptions.inject = {
        head: simulatorBannerCss
      };
    }

    next();
  };
};