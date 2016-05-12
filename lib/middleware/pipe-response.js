var urljoin = require('url-join');
var path = require('path');
var parseUrl = require('url').parse;
var _ = require('lodash');
var instrument = require('../instrument');
var htmlprep = require('htmlprep');
var sha1 = require('sha1');
var debug = require('debug')('4front:http-host:pipe-response');

var DEFAULT_CLIENT_CONFIG_VAR = '__4front__';

module.exports = function(options) {
  _.defaults(options, {
    htmlprep: true,
    contentType: 'text/html',
    baseUrlPlaceholder: 'https://__baseurl__',
    noVersionAssetPatterns: []
  });

  return function(req, res, next) {
    var versionId = req.ext.virtualAppVersion.versionId;
    var versionName = req.ext.virtualAppVersion.name;
    var customHeaderPrefix = req.app.settings.customHttpHeaderPrefix;

    if (!options.clientConfigVar) {
      options.clientConfigVar = req.app.settings.clientConfigVar;
    }

    // The Content-Type may have already been set by http-headers plugin
    if (!res.getHeader('Content-Type')) {
      res.set('Content-Type', options.contentType);
    }

    res.set(customHeaderPrefix + 'version-id', versionId);
    res.set(customHeaderPrefix + 'page-path', req.ext.webPagePath);

    if (!_.isEmpty(versionName)) {
      res.set(customHeaderPrefix + 'version-name', versionName);
    }

    // The Cache-Control may have already been explicitly
    // set by the http-headers plugin.
    if (!res.getHeader('Cache-Control')) {
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
    }

    populateClientConfig(req, res, versionId, versionName);
    pipeFromStorage(req, res, next);
  };

  function pipeFromStorage(req, res, next) {
    var stream = req.ext.webPageStream;

    if (options.contentType === 'text/html' && options.htmlprep !== false) {
      var htmlOptions = buildHtmlOptions(req, res);
      debug('piping page stream through htmlprep');

      var htmlPrepStream = htmlprep(htmlOptions);
      htmlPrepStream.on('start', function() {
        instrument.start(req, 'htmlprep');
      })
      .on('end', function() {
        instrument.finish(req, 'htmlprep');
      });

      stream = stream.pipe(htmlPrepStream);
    }

    stream.pipe(res);
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

    _.assign(req.ext.clientConfig, {
      buildType: req.ext.buildType || 'release',
      webPagePath: req.ext.webPagePath,
      staticAssetPath: versionAssetPath,
      appId: req.ext.virtualApp.appId,
      appName: req.ext.virtualApp.name,
      appUrl: req.ext.virtualApp.url,
      virtualEnv: req.ext.virtualEnv,
      versionName: versionName,
      statusCode: res.statusCode || 200,
      manifestSha: manifestSha,
      baseUrl: (req.secure ? 'https' : 'http') + '://' + req.hostname
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
      fingerprint: req.ext.clientConfig.manifestSha,
      baseUrl: req.ext.clientConfig.baseUrl,
      baseUrlPlaceholder: options.baseUrlPlaceholder,
      noPathPrefixPatterns: options.noVersionAssetPatterns
    }, _.pick(req.ext.htmlOptions || {}, 'deployedAssetsPath'));

    var pathFromRoot = path.dirname(req.ext.webPagePath);
    if (pathFromRoot === '.') pathFromRoot = '';
    htmlOptions.pathFromRoot = pathFromRoot;

    if (options.omitClientConfigVar !== true) {
      // Merge up the head block making sure the __config__ declaration comes first
      var headBlock = '<script>';

      // Support having two global variables that both point to the same object.
      // Always render the DEFAULT_CLIENT_CONFIG_VAR as there is JavaScript that gets
      // injected that relies upon it.
      var configVars = [DEFAULT_CLIENT_CONFIG_VAR];
      if (!_.isEmpty(options.clientConfigVar)) {
        if (options.clientConfigVar !== DEFAULT_CLIENT_CONFIG_VAR) {
          configVars.push(options.clientConfigVar);
        }
      }

      headBlock += configVars.join('=') + '=';
      headBlock += JSON.stringify(req.ext.clientConfig || {});
      headBlock += ';</script>\n';

      htmlOptions.inject.head = headBlock + (htmlOptions.inject.head || '');
    }

    // If autoReload is enabled, inject the client script at the end of the html body
    if (htmlOptions.autoReload === true) {
      var autoReloadPort = req.ext.htmlOptions.sandboxPort;
      var autoReloadUrl = '//localhost:' + autoReloadPort + '/static/autoreload.js';

      var autoReloadScript = '<script src="' + autoReloadUrl + '"></script>' +
        '<script>window.__autoReload = new AutoReload({port:' + autoReloadPort + '});' +
        'window.__autoReload.watch();</script>\n';

      htmlOptions.inject.body = autoReloadScript + (htmlOptions.body || '');
    }

    return htmlOptions;
  }
};
