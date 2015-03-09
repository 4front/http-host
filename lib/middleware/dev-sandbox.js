var _ = require('lodash');
var querystring = require('querystring');
var url = require('url');
var stream = require('stream');
var cookieParser = require('cookie-parser');
var debug = require('debug')('4front:middleware:dev-sandbox');
var helper = require('../helper');
var htmlprep = require('htmlprep');

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
    clientConfigVar: '__config__',  // Name of the global config variable 
    clientConfig: {},       // Object with configSettings to echo to the globalConfigVar
    ensureAuthenticated: function() { return false; },
    showBanner: true,
    cache: null,
    htmlprep: {}
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
      return res.redirect(req.protocol + "://localhost:" + (devOptions.port || defaultDevOptions.port) + req.path);
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

      var redirectUrl = url.format(originalUrl);
      var remainingQuery = _.omit(req.query, options.queryParam);
      if (_.isEmpty(remainingQuery) === false)
        redirectUrl += '?' + querystring.stringify(remainingQuery);

      return res.redirect(redirectUrl);
    }

    if (_.isEmpty(devOptions.user))
      return next(new Error("No user parameter found in the found in the " + options.cookieName + " cookie. Please restart the dev simulator."));

    // Apply the default dev options to the values from the cookie
    _.defaults(devOptions, defaultDevOptions);
    if (devOptions.liveReload === '1')
      devOptions.liveReload = true;

    // Determine which html page should be loaded.
    var pageName = helper.determineHtmlPage(
      req, options.ensureAuthenticated(req));

    // Load the developer's private copy of the index page. Generate a unique hash key by combining
    // the current developer userId and the full app host.
    // req.virtualApp.appId + ':' + req.user.userId + ':' + fieldName
    var cacheKey = req.ext.virtualApp.appId + ':' + devOptions.user + ':' + pageName;

    options.cache.exists(cacheKey, function(err, exists) {
      if (err) return next(err);

      if (!exists) {
        debug('index page not found in cache with key %s', cacheKey);
        return next(Error.http(404, 
          'Page not found in simulator cache.', {
            help: 'Try restarting the development simulator.'
          }));  
      }

      _.extend(options.htmlprep, devOptions, {
        assetPathPrefix: '//localhost:' + devOptions.port
      });

      _.extend(req.ext.clientConfig, {
        buildType: devOptions.buildType,
        pageName: pageName,
        simulator: true,
        virtualEnv: 'dev',
        user: req.user,
        assetPath: '//localhost:' + devOptions.port,
        assetHost: 'localhost:' + devOptions.port
      });

      // Emit a global JavaScript variable with the JSON clientConfig object. These settings
      // can be accessed by any JS executing within the page.
      var headBlock = '<script>' + options.clientConfigVar + '=' + JSON.stringify(req.ext.clientConfig) + ';</script>';
      if (options.showBanner === true) {
        debug("add simulator banner to headCssBlocks");
        headBlock += simulatorBannerCss;
      }

      var htmlOptions = _.cloneDeep(options.htmlprep);

      if (_.isObject(htmlOptions.inject) === false)
        htmlOptions.inject = {};

      // Force the headScript to come before anything already specified in htmlprep.inject.head.
      if (htmlOptions.inject.head)
        htmlOptions.inject.head = (headBlock + htmlOptions.inject.head);
      else
        htmlOptions.inject.head = headBlock;

      res.set('Content-Type', 'text/html');

      // Pipe the html through the html-preprocessor then 
      // out to the response.
      debug('found %s in simulator cache, piping to htmlprep', cacheKey);
      options.cache.readStream(cacheKey)
        .pipe(htmlprep(htmlOptions))
        .pipe(res);
    });
  };
};