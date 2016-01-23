var urljoin = require('url-join');
var etag = require('etag');
var parseUrl = require('url').parse;
var _ = require('lodash');
var htmlprep = require('htmlprep');
var sha1 = require('sha1');
var debug = require('debug')('4front:http-host:pipe-response');

var DEFAULT_CLIENT_CONFIG_VAR = '__4front__';

module.exports = function(options) {
  _.defaults(options, {
    htmlprep: true,
    contentType: 'text/html'
  });

  return function(req, res, next) {
    var versionId = req.ext.virtualAppVersion.versionId;
    var versionName = req.ext.virtualAppVersion.name;

    if (!options.clientConfigVar) {
      options.clientConfigVar = req.app.settings.clientConfigVar;
    }

    res.set('Content-Type', options.contentType);
    res.set('Virtual-App-Version', versionId);
    res.set('Virtual-App-Page', req.ext.webPagePath);

    if (!_.isEmpty(versionName)) {
      res.set('Virtual-App-Version-Name', versionName);
    }

    var cacheControl = null;
    if (options.maxAge) {
      cacheControl = 'max-age=' + options.maxAge;
    } else if (options.cacheControl) {
      cacheControl = options.cacheControl;
    } else {
      // TODO: Should this be public, max-age=31536000, no-cache
      cacheControl = 'no-cache';
    }
    res.setHeader('Cache-Control', cacheControl);

    populateClientConfig(req, res, versionId, versionName);

    // Only use etags for 200 OK GET requests
    if (req.method === 'GET' && (!_.isNumber(res.statusCode) || res.statusCode === 200)) {
      var etagHeader = generateETag(req, res);
      if (etagHeader) {
        // If the etag matches the if-none-match header,
        // return a 304 Not Modified response.
        if (req.get('if-none-match') === etagHeader) {
          // According to the RFC, the server should still send back the same
          // headers that would appear in a 200 response.
          // https://tools.ietf.org/html/rfc7232#section-4.1
          res.set('Cache-Control', 'no-cache');
          res.set('ETag', etagHeader);
          return res.status(304).end();
        }
        res.setHeader('ETag', etagHeader);
      }
    }

    // If req.ext.webPageStream is a function, then evaluate it to get
    // the actual stream. This is used to lazy fetch the stream in case
    // we don't actually need it, like when the etag is a match.
    var stream;
    if (_.isFunction(req.ext.webPageStream)) {
      stream = req.ext.webPageStream();
    } else {
      stream = req.ext.webPageStream;
    }

    if (options.contentType === 'text/html' && options.htmlprep !== false) {
      var htmlOptions = buildHtmlOptions(req, res);
      debug('piping page stream through htmlprep');
      stream = stream.pipe(htmlprep(htmlOptions));
    }
    stream.pipe(res);
  };

  function generateETag(req, res) {
    // Don't set an etag if there is a user context or if this is the developer sandbox.
    if (req.ext.user || req.ext.virtualEnv === 'local') return null;

    // The etag is determined by hashing the stringified JSON versionId, and env variables.
    // Taken together they represent a unique hash of the html page response. The reason
    // the env variables are included is that they can change outside of a new version deployment.
    // Include the minimal amount of contextual data to maximize the cache hit rate.
    return etag(JSON.stringify({
      versionId: req.ext.virtualAppVersion.versionId,
      env: req.ext.env,
      webPagePath: req.ext.webPagePath,
      statusCode: res.statusCode || 200,
      buildType: req.ext.buildType || 'release'
    }));
  }

  function populateClientConfig(req, res, versionId, versionName) {
    if (!req.ext.clientConfig) {
      req.ext.clientConfig = {};
    }

    var versionAssetPath = req.ext.versionAssetPath;
    if (!versionAssetPath) {
      versionAssetPath = urljoin(req.app.settings.deployedAssetsPath,
        req.ext.virtualApp.appId, versionId);

      // If the versionAssetPath does not have a protocol or does
      // not start with a leading slash (used when assets are hosted on the same
      // domain), prepend a double slash which the browser will translate into
      // an absolute url with the same protocol as the host page.
      if (!parseUrl(versionAssetPath).protocol && versionAssetPath[0] !== '/') {
        versionAssetPath = '//' + versionAssetPath;
      }
    }

    // Calculate a hash of the stringified manifest + env variables. These are the two
    // contextual bit of information that could impact the response from a plugin and thus
    // invalidate the cached response. It is passed along in the fingerprint
    // option of htmlprep.
    var manifestSha = sha1(JSON.stringify({
      manifest: req.ext.virtualAppVersion.manifest || {},
      env: req.ext.env
    }));

    _.extend(req.ext.clientConfig, {
      buildType: req.ext.buildType || 'release',
      webPagePath: req.ext.webPagePath,
      staticAssetPath: versionAssetPath,
      appId: req.ext.virtualApp.appId,
      appName: req.ext.virtualApp.name,
      appUrl: req.ext.virtualApp.url,
      virtualEnv: req.ext.virtualEnv,
      versionName: versionName,
      statusCode: res.statusCode || 200,
      manifestSha: manifestSha
    });

    if (!_.isEmpty(req.ext.virtualAppVersion.commit)) {
      req.ext.clientConfig.versionCommit = req.ext.virtualAppVersion.commit;
    }

    // If this is a custom domain, echo back the domain name and
    // certificate name if applicable.
    if (req.ext.virtualApp.domain) {
      req.ext.clientConfig.customDomain = req.ext.virtualApp.domain.domain;
      if (req.ext.virtualApp.domain.certificate) {
        req.ext.clientConfig.certificate = req.ext.virtualApp.domain.certificate;
      }
    }

    // If there is a logged in user, only expose certain attributes to the client code.
    if (req.ext.user) {
      req.ext.clientConfig.user = _.pick(req.ext.user, 'userId', 'username', 'avatar');
    }
  }

  function buildHtmlOptions(req, res) {
    var htmlOptions;

    // Clone the options so that we aren't modifying shared state
    if (!_.isObject(options.htmlprep)) {
      htmlOptions = {};
    } else {
      htmlOptions = _.cloneDeep(options.htmlprep);
    }

    _.defaults(htmlOptions, req.ext.htmlOptions, {
      inject: {}
    });

    _.extend(htmlOptions, {
      buildType: req.ext.buildType || 'release',
      assetPathPrefix: req.ext.clientConfig.staticAssetPath,
      // Get everything up to and including the final forward slash.
      pathFromRoot: req.path.slice(0, req.path.lastIndexOf('/')),
      fingerprint: req.ext.clientConfig.manifestSha
    }, _.pick(req.ext.htmlOptions || {}, 'deployedAssetsPath'));

    // Merge up the head block making sure the __config__ declaration comes first
    var headBlock = '<script>';

    // Support having two global variables that both point to the same object.
    // Always render the DEFAULT_CLIENT_CONFIG_VAR as there is JavaScript that gets
    // injected that relies upon it.
    var configVars = [DEFAULT_CLIENT_CONFIG_VAR];
    if (!_.isEmpty(options.clientConfigVar) && options.clientConfigVar !== DEFAULT_CLIENT_CONFIG_VAR) {
      configVars.push(options.clientConfigVar);
    }

    headBlock += configVars.join('=') + '=';
    headBlock += JSON.stringify(req.ext.clientConfig || {});
    headBlock += ';</script>';

    htmlOptions.inject.head = headBlock + (htmlOptions.inject.head || '');

    // If autoReload is enabled, inject the client script at the end of the html body
    if (htmlOptions.autoReload === true) {
      var autoReloadPort = req.ext.htmlOptions.sandboxPort;
      var autoReloadUrl = '//localhost:' + autoReloadPort + '/static/autoreload.js';

      var autoReloadScript = '<script src="' + autoReloadUrl + '"></script>' +
        '<script>window.__autoReload = new AutoReload({port:' + autoReloadPort + '});' +
        'window.__autoReload.watch();</script>';

      htmlOptions.inject.body = autoReloadScript + (htmlOptions.body || '');
    }

    return htmlOptions;
  }
};
