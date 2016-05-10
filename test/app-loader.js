/* eslint no-console: 0 */

var assert = require('assert');
var sinon = require('sinon');
var virtualAppLoader = require('../lib/middleware/app-loader');
var express = require('express');
var shortid = require('shortid');
var request = require('supertest');
var _ = require('lodash');
var debug = require('debug');
var testUtil = require('./test-util');

require('dash-assert');

describe('virtualAppLoader()', function() {
  var self;

  beforeEach(function() {
    self = this;

    this.server = express();

    this.server.use(function(req, res, next) {
      req.ext = {};
      next();
    });

    this.appId = shortid.generate();
    this.env = {};

    _.extend(this.server.settings, {
      virtualHost: 'testapps.com',
      defaultVirtualEnvironment: 'production',
      database: {
        getDomain: sinon.spy(function(domainName, callback) {
          callback(null, {domainName: domainName});
        })
      }
    });

    this.virtualApp = {
      appId: self.appId,
      env: self.env
    };

    this.appRegistry = this.server.settings.virtualAppRegistry = {
      getByName: sinon.spy(function(name, callback) {
        callback(null, _.assign({}, self.virtualApp, {name: name}));
      })
    };

    this.server.use(virtualAppLoader(this.server.settings));

    this.server.use(function(req, res, next) {
      res.json(_.pick(req.ext, 'virtualEnv', 'virtualApp', 'virtualHost', 'clientConfig', 'env'));
    });

    this.server.use(testUtil.errorHandler);
  });

  describe('virtual env in host', function() {
    it('should recognize prefix format', function(done) {
      request(this.server)
        .get('/')
        .set('Host', 'appname--test.testapps.com')
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.appRegistry.getByName.calledWith('appname'));
          assert.equal(res.body.virtualEnv, 'test');
          assert.equal(res.body.virtualHost, 'appname.testapps.com');
        })
        .end(done);
    });

    it('should default to prod when no env found', function(done) {
      this.server.settings.defaultVirtualEnvironment = 'staging';

      request(this.server)
        .get('/')
        .set('Host', 'appname.testapps.com')
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body.virtualEnv, self.server.settings.defaultVirtualEnvironment);
          assert.equal(res.body.virtualHost, 'appname.testapps.com');
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
        .set('Host', 'appname.testapps.com')
        .expect(404, done);
    });
  });

  describe('request with custom domain', function() {
    beforeEach(function() {
      self = this;
    });

    it('find app with subdomain', function(done) {
      var appId = shortid.generate();
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        callback(null, {appId: appId});
      });

      request(this.server)
        .get('/')
        .set('Host', 'www.custom-domain.com')
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.appRegistry.getByDomain.calledWith('custom-domain.com', 'www'));
          assert.equal('production', res.body.virtualEnv);
          assert.equal(res.body.virtualApp.appId, appId);
          assert.equal(res.body.virtualHost, 'www.custom-domain.com');
        })
        .end(done);
    });

    it('find app by apex domain', function(done) {
      var appId = shortid.generate();
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        callback(null, {appId: appId});
      });

      request(this.server)
        .get('/')
        .set('Host', 'apex.net')
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.appRegistry.getByDomain.calledWith('apex.net', '@'));
          assert.equal(res.body.virtualEnv, 'production');
          assert.equal(res.body.virtualApp.appId, appId);
          assert.equal(res.body.virtualHost, 'apex.net');
        })
        .end(done);
    });

    it('subdomain with virtual env', function(done) {
      var appId = shortid.generate();
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        callback(null, {appId: appId});
      });

      request(this.server)
        .get('/')
        .set('Host', 'www--test1.customdomain.com')
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.appRegistry.getByDomain.calledWith('customdomain.com', 'www'));
          assert.equal(res.body.virtualEnv, 'test1');
          assert.equal(res.body.virtualHost, 'www.customdomain.com');
        })
        .end(done);
    });

    it('returns 404 for invalid environment', function(done) {
      var appId = shortid.generate();
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        callback(null, {appId: appId, environments: ['production', 'staging']});
      });

      request(this.server)
        .get('/')
        .set('Host', 'www--test.customdomain.com')
        .expect(404)
        .expect('Error-Code', 'invalidVirtualEnv')
        .end(done);
    });

    it('return 404 for invalid environment for apex domain', function(done) {
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        if (subDomain === 'test') {
          callback(null, null);
        } else {
          callback(null, _.assign(self.virtualApp, {environments: ['production', 'staging']}));
        }
      });

      request(this.server)
        .get('/')
        .set('Host', 'test.customdomain.com')
        .expect(404)
        .expect('Error-Code', 'invalidVirtualEnv')
        .end(done);
    });

    it('apex domain with virtual env', function(done) {
      var appId = shortid.generate();
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        if (subDomain === '@') return callback(null, {appId: appId});
        callback(null, null);
      });

      request(this.server)
        .get('/')
        .set('Host', 'test.customdomain.com')
        .expect(200)
        .expect(function(res) {
          assert.equal(self.appRegistry.getByDomain.callCount, 2);
          assert.isTrue(self.appRegistry.getByDomain.calledWith('customdomain.com', 'test'));
          assert.isTrue(self.appRegistry.getByDomain.calledWith('customdomain.com', '@'));
          assert.equal(res.body.virtualEnv, 'test');
          assert.equal(res.body.virtualHost, 'customdomain.com');
          assert.equal(res.body.virtualApp.appId, appId);
        })
        .end(done);
    });

    it('404 for request where there is no www and no apex', function(done) {
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        callback(null, null);
      });

      request(this.server)
        .get('/')
        .set('Host', 'www.customdomain.com')
        .expect(404)
        .expect(function(res) {
          assert.equal(self.appRegistry.getByDomain.callCount, 2);
          assert.isTrue(self.appRegistry.getByDomain.calledWith('customdomain.com', 'www'));
          assert.isTrue(self.appRegistry.getByDomain.calledWith('customdomain.com', '@'));
        })
        .end(done);
    });

    it('request for apex redirects to www', function(done) {
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        if (subDomain === '@') return callback(null, null);
        callback(null, {url: 'https://www.customdomain.com'});
      });

      request(this.server)
        .get('/blog')
        .set('Host', 'customdomain.com')
        .expect(302)
        .expect(function(res) {
          assert.equal(self.appRegistry.getByDomain.callCount, 2);
          assert.isTrue(self.appRegistry.getByDomain.calledWith('customdomain.com', '@'));
          assert.isTrue(self.appRegistry.getByDomain.calledWith('customdomain.com', 'www'));
          assert.equal(res.headers.location, 'https://www.customdomain.com/blog');
        })
        .end(done);
    });

    it('request for www redirects to apex', function(done) {
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        if (subDomain === 'www') return callback(null, null);
        callback(null, {
          url: 'https://customdomain.com',
          environments: ['dev', 'production']
        });
      });

      request(this.server)
        .get('/blog')
        .set('Host', 'www.customdomain.com')
        .expect(302)
        .expect(function(res) {
          assert.equal(self.appRegistry.getByDomain.callCount, 2);
          assert.isTrue(self.appRegistry.getByDomain.calledWith('customdomain.com', 'www'));
          assert.isTrue(self.appRegistry.getByDomain.calledWith('customdomain.com', '@'));
          assert.equal(res.headers.location, 'https://customdomain.com/blog');
        })
        .end(done);
    });
  });

  describe('app with requireSsl set to true', function() {
    it('should redirect to https', function(done) {
      this.appRegistry.getByName = function(name, callback) {
        callback(null, {requireSsl: true, url: 'https://appname.testapps.com'});
      };

      request(this.server)
        .get('/path')
        .set('Host', 'appname.testapps.com')
        .expect(302)
        .expect(function(res) {
          assert.equal(res.headers.location, 'https://appname.testapps.com/path');
        })
        .end(done);
    });

    it('should redirect to https for root request', function(done) {
      this.appRegistry.getByName = function(name, callback) {
        callback(null, {requireSsl: true, url: 'https://appname.testapps.com'});
      };

      request(this.server)
        .get('/')
        .set('Host', 'appname.testapps.com')
        .expect(302)
        .expect('Cache-Control', 'no-cache')
        .expect(function(res) {
          assert.equal(res.headers.location, 'https://appname.testapps.com');
        })
        .end(done);
    });

    it('should redirect custom domains when requireSsl is true', function(done) {
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        callback(null, {requireSsl: true, url: 'https://domain.net'});
      });

      request(this.server)
        .get('/path')
        .set('Host', 'domain.net')
        .expect(302)
        .expect('Cache-Control', 'no-cache')
        .expect(function(res) {
          assert.isTrue(self.appRegistry.getByDomain.calledWith('domain.net', '@'));
          assert.equal(res.headers.location, 'https://domain.net/path');
        })
        .end(done);
    });

    it('should redirect staging custom domain to https', function(done) {
      this.appRegistry.getByDomain = sinon.spy(function(domainName, subDomain, callback) {
        if (subDomain === '@') {
          callback(null, {requireSsl: true, urls: {
            production: 'https://domain.net',
            test: 'https://test.domain.net'
          }});
        } else {
          callback(null, null);
        }
      });

      request(this.server)
        .get('/path')
        .set('Host', 'test.domain.net')
        .expect(302)
        .expect('Cache-Control', 'no-cache')
        .expect(function(res) {
          assert.equal(res.headers.location, 'https://test.domain.net/path');
        })
        .end(done);
    });

    it('does not redirect custom domains when requireSsl is false', function(done) {
      this.appRegistry.getByDomain = function(domainName, subDomain, callback) {
        callback(null, {requireSsl: false});
      };

      request(this.server)
        .get('/path')
        .set('Host', 'www.test.io')
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body.virtualHost, 'www.test.io');
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
      request(this.server)
        .get('/')
        .set('Host', 'appname--test.testapps.com')
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
        .set('Host', 'appname.testapps.com')
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

  describe('custom domain catch-all redirect', function() {
    beforeEach(function() {
      self = this;
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
        .set('Host', 'appname.customdomain.com')
        .expect(302)
        .expect(function(res) {
          assert.isTrue(self.server.settings.database.getDomain.calledWith('customdomain.com'));
          assert.equal(res.headers.location, 'https://somewhere.com/path?id=1');
        })
        .end(done);
    });

    it('returns 404 if no catch-all redirect specified', function(done) {
      this.catchAllRedirect = null;
      request(this.server)
        .get('/')
        .set('Host', 'appname.customdomain.com')
        .expect(404)
        .end(done);
    });

    it('returns 404 if domain not found', function(done) {
      this.server.settings.database.getDomain = function(domainName, callback) {
        callback(null, null);
      };

      request(this.server)
        .get('/')
        .set('Host', 'appname.customdomain.com')
        .expect(404)
        .end(done);
    });

    it('does not preserve path and query if catchAllRedirect already has path', function(done) {
      this.catchAllRedirect = 'https://somewhere.com/404';
      request(this.server)
        .get('/path?id=1')
        .set('Host', 'appname.customdomain.com')
        .expect(302)
        .expect(function(res) {
          assert.isTrue(self.server.settings.database.getDomain.calledWith('customdomain.com'));
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
        .set('Host', 'appname.customdomain.com')
        .expect(302)
        .expect(function(res) {
          assert.isTrue(self.appRegistry.getByDomain.calledWith('customdomain.com', 'appname'));
          // assert.isTrue(self.server.settings.database.getDomain.calledWith('customdomain.com'));
          assert.equal(res.headers.location, 'https://somewhere.com');
        })
        .end(done);
    });
  });
});
