/* eslint no-console: 0 */

var assert = require('assert');
var sinon = require('sinon');
var async = require('async');
var appContextLoader = require('../lib/middleware/app-context-loader');
var express = require('express');
var shortid = require('shortid');
var request = require('supertest');
var _ = require('lodash');
var debug = require('debug');
var testUtil = require('./test-util');
// var memoryCache = require('memory-cache-stream');
var redis = require('redis');

require('dash-assert');
var redisClient = redis.createClient();
var customHeaderPrefix = 'x-4front-';

describe('appContextLoader()', function() {
  var self;

  beforeEach(function() {
    self = this;

    this.server = express();
    this.server.set('trust proxy', true);

    this.server.use(function(req, res, next) {
      req.ext = {};
      next();
    });

    this.appId = shortid.generate();
    this.appName = 'app-' + this.appId.replace('_', '-').toLowerCase();
    this.versionId = shortid.generate();
    this.virtualHost = randomDomain();
    this.env = {};

    _.extend(this.server.settings, {
      virtualHost: self.virtualHost,
      defaultVirtualEnvironment: 'production',
      customHttpHeaderPrefix: customHeaderPrefix
    });

    this.database = this.server.settings.database = {
      getDomain: sinon.spy(function(domainName, callback) {
        callback(null, {domainName: domainName});
      }),
      getVersion: sinon.spy(function(appId, versionId, callback) {
        callback(null, {versionId: versionId, name: versionId});
      })
    };

    this.virtualApp = {
      appId: self.appId,
      name: self.appName,
      env: self.env,
      trafficRules: {
        production: [
          {rule: '*', versionId: this.versionId}
        ]
      }
    };

    this.cache = this.server.settings.cache = redisClient;
    this.metrics = this.server.settings.metrics = testUtil.debugMetrics();

    this.appRegistry = this.server.settings.virtualAppRegistry = {
      getByName: sinon.spy(function(name, callback) {
        callback(null, _.assign({}, self.virtualApp, {name: name}));
      }),
      getByDomain: sinon.spy(function(domainName, subDomain, callback) {
        callback(null, _.assign({}, self.virtualApp, {domainName: domainName, subDomain: subDomain}));
      })
    };

    this.server.use(function(req, res, next) {
      req.ext = {
        appCacheEnabled: true
      };
      next();
    });

    this.server.use(appContextLoader(this.server.settings));

    this.server.use(function(req, res, next) {
      res.json(_.pick(req.ext, 'virtualEnv', 'virtualApp', 'virtualHost',
        'clientConfig', 'env', 'virtualAppVersion', 'subDomain'));
    });

    this.server.use(testUtil.errorHandler);
  });

  describe('virtual env in host', function() {
    it('should recognize prefix format', function(done) {
      this.virtualApp.trafficRules = {
        test: [{rule: '*', versionId: self.versionId}]
      };

      request(this.server)
        .get('/')
        .set('Host', 'appname--test.' + this.virtualHost)
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.appRegistry.getByName.calledWith('appname'));
          assert.equal(res.body.virtualEnv, 'test');
          assert.equal(res.body.virtualHost, 'appname.' + self.virtualHost);
          assert.equal(res.body.virtualAppVersion.versionId, self.versionId);
        })
        .end(done);
    });

    it('should default to prod when no env found', function(done) {
      this.server.settings.defaultVirtualEnvironment = 'staging';
      this.virtualApp.trafficRules = {
        staging: [{rule: '*', versionId: self.versionId}]
      };

      request(this.server)
        .get('/')
        .set('Host', 'appname.' + this.virtualHost)
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body.virtualEnv, self.server.settings.defaultVirtualEnvironment);
          assert.equal(res.body.virtualHost, 'appname.' + self.virtualHost);
        })
        .end(done);
    });
  });

  describe('virtualAppRegistry returns null', function() {
    it('should return 404', function(done) {
      this.server.settings.virtualAppRegistry.getByName = function(name, cb) {
        cb(null, null);
      };

      request(this.server)
        .get('/')
        .set('Host', 'appname.' + self.virtualHost)
        .expect(404, done);
    });
  });

  describe('request with custom domain', function() {
    beforeEach(function() {
      self = this;
      this.domainName = randomDomain();
    });

    it('find app with subdomain', function(done) {
      request(this.server)
        .get('/')
        .set('Host', 'www.' + this.domainName)
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.appRegistry.getByDomain.called);
          assert.isTrue(self.appRegistry.getByDomain.calledWith(self.domainName, 'www'));
          assert.equal('production', res.body.virtualEnv);
          assert.equal(res.body.virtualApp.appId, self.appId);
          assert.equal(res.body.virtualHost, 'www.' + self.domainName);
        })
        .end(done);
    });

    it('find app by apex domain', function(done) {
      request(this.server)
        .get('/')
        .set('Host', this.domainName)
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.appRegistry.getByDomain.calledWith(self.domainName, '@'));
          assert.equal(res.body.virtualEnv, 'production');
          assert.equal(res.body.virtualApp.appId, self.appId);
          assert.equal(res.body.virtualHost, self.domainName);
        })
        .end(done);
    });

    it('subdomain with virtual env', function(done) {
      self.virtualApp.trafficRules = {
        test1: [{rule: '*', versionId: this.versionId}]
      };

      request(this.server)
        .get('/')
        .set('Host', 'www--test1.' + this.domainName)
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.appRegistry.getByDomain.calledWith(self.domainName, 'www'));
          assert.equal(res.body.virtualEnv, 'test1');
          assert.equal(res.body.virtualHost, 'www.' + self.domainName);
        })
        .end(done);
    });

    it('returns 404 for invalid environment', function(done) {
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        callback(null, _.assign(self.virtualApp, {environments: ['production', 'staging']}));
      });

      request(this.server)
        .get('/')
        .set('Host', 'www--test.' + self.domainName)
        .expect(404)
        .expect('Error-Code', 'invalidVirtualEnv')
        .end(done);
    });

    it('return 404 for invalid environment for apex domain', function(done) {
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        if (subDomain === 'test' || subDomain === '*') {
          callback(null, null);
        } else {
          callback(null, _.assign(self.virtualApp, {environments: ['production', 'staging']}));
        }
      });

      request(this.server)
        .get('/')
        .set('Host', 'test.' + self.domainName)
        .expect(404)
        .expect('Error-Code', 'invalidVirtualEnv')
        .end(done);
    });

    it('apex domain with virtual env', function(done) {
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        if (subDomain === '@') {
          return callback(null, _.assign(self.virtualApp, {
            domainName: domainName,
            subDomain: subDomain,
            trafficRules: {
              test: [{rule: '*', versionId: self.versionId}]
            }
          }));
        }
        callback(null, null);
      });

      request(this.server)
        .get('/')
        .set('Host', 'test.' + self.domainName)
        .expect(200)
        .expect(function(res) {
          assert.equal(self.appRegistry.getByDomain.callCount, 3);
          assert.isTrue(self.appRegistry.getByDomain.calledWith(self.domainName, 'test'));
          assert.isTrue(self.appRegistry.getByDomain.calledWith(self.domainName, '*'));
          assert.isTrue(self.appRegistry.getByDomain.calledWith(self.domainName, '@'));
          assert.equal(res.body.virtualEnv, 'test');
          assert.equal(res.body.virtualHost, self.domainName);
          assert.equal(res.body.virtualApp.appId, self.appId);
        })
        .end(done);
    });

    it('wildcard subdomain', function(done) {
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        if (subDomain === '*') {
          return callback(null, self.virtualApp);
        }
        callback(null, null);
      });

      async.eachSeries(['client1', 'client2'], function(subDomain, cb) {
        self.appRegistry.getByDomain.reset();
        request(self.server)
          .get('/')
          .set('Host', subDomain + '.' + self.domainName)
          .expect(200)
          .expect(function(res) {
            assert.equal(self.appRegistry.getByDomain.callCount, 2);
            assert.isTrue(self.appRegistry.getByDomain.calledWith(self.domainName, subDomain));
            assert.isTrue(self.appRegistry.getByDomain.calledWith(self.domainName, '*'));
            assert.equal(res.body.virtualEnv, 'production');
            assert.equal(res.body.virtualHost, subDomain + '.' + self.domainName);
            assert.equal(res.body.virtualApp.appId, self.appId);
            assert.equal(res.body.subDomain, '*');
          })
          .end(function(err) {
            if (err) return cb(err);
            self.cache.exists(subDomain + '.' + self.domainName, function(_err, exists) {
              assert.equal(exists, 0);
              cb();
            });
          });
      }, done);
    });

    it('404 for request where there is no www and no apex', function(done) {
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        callback(null, null);
      });

      request(this.server)
        .get('/')
        .set('Host', 'www.' + self.domainName)
        .expect(404)
        .expect(function(res) {
          assert.equal(self.appRegistry.getByDomain.callCount, 3);
          assert.isTrue(self.appRegistry.getByDomain.calledWith(self.domainName, 'www'));
          assert.isTrue(self.appRegistry.getByDomain.calledWith(self.domainName, '*'));
          assert.isTrue(self.appRegistry.getByDomain.calledWith(self.domainName, '@'));
        })
        .end(done);
    });

    it('request for apex redirects to www', function(done) {
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        if (subDomain === '@') return callback(null, null);
        callback(null, {url: 'https://www.' + self.domainName});
      });

      async.series([
        function(cb) {
          request(self.server)
            .get('/blog?foo=1')
            .set('Host', self.domainName)
            .expect(302)
            .expect(function(res) {
              assert.equal(self.appRegistry.getByDomain.callCount, 2);
              assert.isTrue(self.appRegistry.getByDomain.calledWith(self.domainName, '@'));
              assert.isTrue(self.appRegistry.getByDomain.calledWith(self.domainName, 'www'));
              assert.equal(res.headers.location, 'https://www.' + self.domainName + '/blog?foo=1');
            })
            .end(cb);
        },
        function(cb) {
          setTimeout(cb, 10);
        },
        function(cb) {
          redisClient.get(self.domainName, function(err, value) {
            if (err) return cb(err);
            assert.isString(value);
            var cachedContext = JSON.parse(value);
            assert.equal(cachedContext.redirect.location, 'https://www.' + self.domainName);
            assert.equal(cachedContext.redirect.statusCode, 302);
            cb();
          });
        },
        // Subsequent request should use cached 302 response
        function(cb) {
          self.appRegistry.getByDomain.reset();
          self.database.getVersion.reset();
          request(self.server)
            .get('/path?foo=2')
            .set('Host', self.domainName)
            .expect(302)
            .expect(function(res) {
              assert.equal(res.headers.location, 'https://www.' + self.domainName + '/path?foo=2');
              assert.isFalse(self.appRegistry.getByDomain.called);
              assert.isFalse(self.database.getVersion.called);
            })
            .end(cb);
        }
      ], done);
    });

    it('request for www redirects to apex', function(done) {
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        if (subDomain === 'www' || subDomain === '*') return callback(null, null);
        callback(null, _.assign(self.virtualApp, {url: 'https://' + self.domainName}));
      });

      async.series([
        function(cb) {
          request(self.server)
            .get('/blog?foo=1')
            .set('Host', 'www.' + self.domainName)
            .expect(302)
            .expect(function(res) {
              assert.equal(self.appRegistry.getByDomain.callCount, 3);
              assert.isTrue(self.appRegistry.getByDomain.calledWith(self.domainName, 'www'));
              assert.isTrue(self.appRegistry.getByDomain.calledWith(self.domainName, '@'));
              assert.isTrue(self.appRegistry.getByDomain.calledWith(self.domainName, '*'));
              assert.equal(res.headers.location, 'https://' + self.domainName + '/blog?foo=1');
            })
            .end(cb);
        },
        function(cb) {
          setTimeout(cb, 10);
        },
        function(cb) {
          self.appRegistry.getByDomain.reset();
          request(self.server)
            .get('/blog?foo=2')
            .set('Host', 'www.' + self.domainName)
            .expect(302)
            .expect(function(res) {
              assert.isFalse(self.appRegistry.getByDomain.called);
              assert.equal(res.headers.location, 'https://' + self.domainName + '/blog?foo=2');
            })
            .end(cb);
        }
      ], done);
    });

    it('returns correct env variables', function(done) {
      var testVersionId = shortid.generate();

      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        if (subDomain === '@') {
          return callback(null, _.assign({}, self.virtualApp, {environments: ['production', 'test']}));
        }
        return callback(null, null);
      });

      _.assign(this.virtualApp, {
        env: {
          _global: {MAX: 10},
          production: {ENV_NAME: 'production'},
          test: {ENV_NAME: 'test'}
        },
        trafficRules: {
          production: [{rule: '*', versionId: self.versionId}],
          test: [{rule: '*', versionId: testVersionId}]
        }
      });

      async.series([
        function(cb) {
          request(self.server)
            .get('/')
            .set('Host', self.domainName)
            .expect(function(res) {
              assert.equal(res.body.virtualEnv, 'production');
              assert.deepEqual(res.body.env, {
                MAX: 10,
                ENV_NAME: 'production'
              });
              assert.equal(res.body.virtualAppVersion.versionId, self.versionId);
            })
            .end(cb);
        },
        function(cb) {
          request(self.server)
            .get('/')
            .set('Host', 'test.' + self.domainName)
            .expect(function(res) {
              assert.equal(res.body.virtualEnv, 'test');
              assert.deepEqual(res.body.env, {
                MAX: 10,
                ENV_NAME: 'test'
              });
              assert.equal(res.body.virtualAppVersion.versionId, testVersionId);
            })
            .end(cb);
        },
        function(cb) {
          setTimeout(cb, 10);
        },
        function(cb) {
          self.appRegistry.getByDomain.reset();
          request(self.server)
            .get('/')
            .set('Host', self.domainName)
            .expect(function(res) {
              assert.isFalse(self.appRegistry.getByDomain.called);
              assert.equal(res.body.virtualEnv, 'production');
              assert.deepEqual(res.body.env, {
                MAX: 10,
                ENV_NAME: 'production'
              });
              assert.equal(res.body.virtualAppVersion.versionId, self.versionId);
            })
            .end(cb);
        },
        function(cb) {
          self.appRegistry.getByDomain.reset();
          request(self.server)
            .get('/')
            .set('Host', 'test.' + self.domainName)
            .expect(function(res) {
              assert.isFalse(self.appRegistry.getByDomain.called);
              assert.equal(res.body.virtualEnv, 'test');
              assert.deepEqual(res.body.env, {
                MAX: 10,
                ENV_NAME: 'test'
              });
              assert.equal(res.body.virtualAppVersion.versionId, testVersionId);
            })
            .end(cb);
        }
      ], done);
    });
  });

  describe('app with requireSsl set to true', function() {
    it('should redirect to https', function(done) {
      var appName = randomSubDomain();
      this.appRegistry.getByName = function(name, callback) {
        callback(null, _.assign(self.virtualApp, {
          name: appName,
          requireSsl: true,
          url: 'https://' + appName + '.' + self.virtualHost
        }));
      };

      async.series([
        function(cb) {
          request(self.server)
            .get('/path')
            .set('Host', appName + '.' + self.virtualHost)
            .expect(302)
            .expect(function(res) {
              assert.equal(res.headers.location, 'https://' + appName + '.' + self.virtualHost + '/path');
            })
            .end(cb);
        },
        function(cb) {
          // The redirect should not be in the cache
          self.cache.exists(appName + '.' + self.virtualHost, function(err, exists) {
            if (err) return cb(err);
            assert.equal(exists, 0);
            cb();
          });
        },
        function(cb) {
          request(self.server)
            .get('/path')
            .set('Host', appName + '.' + self.virtualHost)
            .set('x-forwarded-proto', 'https')
            .expect(200)
            .end(cb);
        },
        function(cb) {
          // The app context should now be in the cache
          self.cache.get(appName + '.' + self.virtualHost, function(err, json) {
            if (err) return cb(err);
            assert.equal(JSON.parse(json).virtualApp.name, appName);
            cb();
          });
        },
        // Now make a non-ssl request when the app context is cached.
        function(cb) {
          request(self.server)
            .get('/')
            .set('Host', appName + '.' + self.virtualHost)
            .expect(302)
            .expect('Location', 'https://' + appName + '.' + self.virtualHost)
            .end(cb);
        }
      ], done);
    });

    it('should redirect to https for root request', function(done) {
      this.appRegistry.getByName = function(name, callback) {
        callback(null, {requireSsl: true, url: 'https://appname.' + self.virtualHost});
      };

      request(this.server)
        .get('/')
        .set('Host', 'appname.' + self.virtualHost)
        .expect(302)
        .expect(function(res) {
          assert.equal(res.headers.location, 'https://appname.' + self.virtualHost);
        })
        .end(done);
    });

    it('should redirect custom domains when requireSsl is true', function(done) {
      var customDomain = randomDomain();
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        callback(null, _.assign(self.virtualApp, {
          requireSsl: true,
          url: 'https://' + customDomain
        }));
      });

      async.series([
        function(cb) {
          request(self.server)
            .get('/path')
            .set('Host', customDomain)
            .expect(302)
            .expect(function(res) {
              assert.isTrue(self.appRegistry.getByDomain.calledWith(customDomain, '@'));
              assert.equal(res.headers.location, 'https://' + customDomain + '/path');
            })
            .end(cb);
        },
        function(cb) {
          // Redirect to https should not be cached
          self.cache.exists(customDomain, function(err, exists) {
            if (err) return cb(err);
            assert.equal(exists, 0);
            cb();
          });
        }
      ], done);
    });

    it('should redirect staging custom domain to https', function(done) {
      var customDomain = randomDomain();
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        if (subDomain === '@') {
          callback(null, {requireSsl: true, urls: {
            production: 'https://' + customDomain,
            test: 'https://test.' + customDomain
          }});
        } else {
          callback(null, null);
        }
      });

      request(this.server)
        .get('/path?foo=1')
        .set('Host', 'test.' + customDomain)
        .expect(302)
        .expect(function(res) {
          assert.equal(res.headers.location, 'https://test.' + customDomain + '/path?foo=1');
          assert.isTrue(self.appRegistry.getByDomain.calledWith(customDomain, 'test'));
          assert.isFalse(self.database.getVersion.called);
        })
        .end(done);
    });

    it('does not redirect custom domains when requireSsl is false', function(done) {
      var customDomain = randomDomain();
      this.appRegistry.getByDomain = function(domainName, subDomain, callback) {
        callback(null, _.assign(self.virtualApp, {requireSsl: false}));
      };

      request(this.server)
        .get('/path')
        .set('Host', 'www.' + customDomain)
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body.virtualHost, 'www.' + customDomain);
          assert.equal(res.body.virtualEnv, 'production');
        })
        .end(done);
    });
  });

  describe('environment variables', function() {
    beforeEach(function() {
      this.server.settings.defaultVirtualEnvironment = 'production';

      _.extend(this.env, {
        _global: {
          key1: 'global_key1',
          key2: 'global_key2'
        },
        test: {
          key1: 'test_key1'
        },
        production: {
          key2: 'production_key2'
        }
      });
    });

    it('works for test env', function(done) {
      this.virtualApp.trafficRules = {test: [{rule: '*', versionId: this.versionId}]};
      request(this.server)
        .get('/')
        .set('Host', 'appname--test.' + this.virtualHost)
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body.virtualEnv, 'test');
          assert.deepEqual(res.body.env, {
            key1: 'test_key1',
            key2: 'global_key2'
          });

          assert.isUndefined(res.body.virtualApp.env);
        })
        .end(done);
    });

    it('works for default virtual env', function(done) {
      request(this.server)
        .get('/')
        .set('Host', 'appname.' + this.virtualHost)
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body.virtualEnv, 'production');
          assert.deepEqual(res.body.env, {
            key1: 'global_key1',
            key2: 'production_key2'
          });
        })
        .end(done);
    });
  });

  describe('app cache', function() {
    it('shared domain apps', function(done) {
      testAppContextCache(self.virtualHost, self.appName, done);
    });

    it('custom domains', function(done) {
      var subDomain = randomSubDomain();
      var customDomain = randomDomain();
      testAppContextCache(customDomain, subDomain, done);
    });

    function testAppContextCache(domainName, subDomain, callback) {
      async.series([
        function(cb) {
          request(self.server).get('/')
            .set('Host', subDomain + '.' + domainName)
            .expect(200)
            .expect(customHeaderPrefix + 'app-id', self.appId)
            .expect(customHeaderPrefix + 'version-id', self.versionId)
            .expect(function(res) {
              if (domainName === self.virtualHost) {
                assert.isTrue(self.appRegistry.getByName.calledWith(self.appName));
              } else {
                assert.isTrue(self.appRegistry.getByDomain.calledWith(domainName, subDomain));
              }

              assert.isTrue(self.database.getVersion.calledWith(self.appId, self.versionId));
              assert.isTrue(self.metrics.miss.calledWith('app-cache-hitrate'));
            })
            .end(cb);
        },
        function(cb) {
          setTimeout(cb, 10);
        },
        function(cb) {
          redisClient.get(subDomain + '.' + domainName, function(err, value) {
            if (err) return cb(err);
            var cachedContext = JSON.parse(value);
            assert.equal(cachedContext.virtualApp.appId, self.appId);
            assert.equal(cachedContext.virtualAppVersion.versionId, self.versionId);
            cb();
          });
        },
        function(cb) {
          self.appRegistry.getByName.reset();
          self.appRegistry.getByDomain.reset();
          self.database.getVersion.reset();
          // On subsequent request, the app context should come from the cache
          request(self.server).get('/')
            .set('Host', subDomain + '.' + domainName)
            .expect(200)
            .expect(customHeaderPrefix + 'app-id', self.appId)
            .expect(customHeaderPrefix + 'version-id', self.versionId)
            .expect(function(res) {
              if (domainName === self.virtualHost) {
                assert.isFalse(self.appRegistry.getByDomain.called);
              } else {
                assert.isFalse(self.appRegistry.getByName.called);
              }

              assert.isFalse(self.database.getVersion.called);
              assert.equal(res.body.virtualEnv, 'production');
              assert.isTrue(self.metrics.hit.calledWith('app-cache-hitrate'));
            })
            .end(cb);
        }
      ], callback);
    }
  });

  describe('custom domain catch-all redirect', function() {
    beforeEach(function() {
      self = this;
      this.domainName = randomDomain();
      // App not found
      this.appRegistry.getByDomain = function(domainName, subDomain, callback) {
        callback(null, null);
      };

      this.server.settings.database.getDomain = sinon.spy(function(domainName, callback) {
        callback(null, {
          domainName: domainName,
          catchAllRedirect: self.catchAllRedirect
        });
      });
    });

    it('redirects preserving path and query', function(done) {
      this.catchAllRedirect = 'https://somewhere.com';
      request(this.server)
        .get('/path?id=1')
        .set('Host', 'appname.' + this.domainName)
        .expect(302)
        .expect(function(res) {
          assert.isTrue(self.server.settings.database.getDomain.calledWith(self.domainName));
          assert.equal(res.headers.location, 'https://somewhere.com/path?id=1');
        })
        .end(done);
    });

    it('returns 404 if no catch-all redirect specified', function(done) {
      this.catchAllRedirect = null;
      request(this.server)
        .get('/')
        .set('Host', 'appname.' + this.domainName)
        .expect(404)
        .end(done);
    });

    it('returns 404 if domain not found', function(done) {
      this.server.settings.database.getDomain = function(domainName, callback) {
        callback(null, null);
      };

      request(this.server)
        .get('/')
        .set('Host', 'appname.' + this.domainName)
        .expect(404)
        .end(done);
    });

    it('does not preserve path and query if catchAllRedirect already has path', function(done) {
      this.catchAllRedirect = 'https://somewhere.com/404';
      request(this.server)
        .get('/path?id=1')
        .set('Host', 'appname.' + this.domainName)
        .expect(302)
        .expect(function(res) {
          assert.isTrue(self.database.getDomain.calledWith(self.domainName));
          assert.equal(res.headers.location, 'https://somewhere.com/404');
        })
        .end(done);
    });

    it('catch all redirect to apex domain', function(done) {
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        callback(null, _.assign(self.virtualApp, {environments: ['test']}));
      });

      this.catchAllRedirect = 'https://somewhere.com';

      request(this.server)
        .get('/')
        .set('Host', 'appname.' + this.domainName)
        .expect(302)
        .expect(function(res) {
          assert.isTrue(self.appRegistry.getByDomain.calledWith(self.domainName, 'appname'));
          assert.equal(res.headers.location, 'https://somewhere.com');
        })
        .end(done);
    });
  });
});

function randomSubDomain() {
  return _.random(1000, 5000) + '-' + Date.now().toString();
}

function randomDomain() {
  return _.random(1000, 5000) + '-' + Date.now().toString() + '.com';
}
