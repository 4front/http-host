/* eslint no-console: 0 */

var assert = require('assert');
var sinon = require('sinon');
var virtualAppLoader = require('../lib/middleware/app-loader');
var express = require('express');
var shortid = require('shortid');
var request = require('supertest');
var _ = require('lodash');
var debug = require('debug');

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

    this.server.settings.virtualHost = 'testapps.com';
    this.server.settings.virtualAppRegistry = {
      getByName: sinon.spy(function(name, callback) {
        callback(null, {
          appId: self.appId,
          name: name,
          env: self.env
        });
      })
    };

    this.server.use(virtualAppLoader(this.server.settings));

    this.server.use(function(req, res, next) {
      res.json(_.pick(req.ext, 'virtualEnv', 'virtualApp', 'virtualHost', 'clientConfig', 'env'));
    });

    this.server.use(function(err, req, res, next) {
      res.statusCode = err.status || 500;
      if (res.statusCode === 500) {
        console.log(err.stack);
        res.end(err.stack);
      } else {
        res.end();
      }
    });
  });

  describe('virtual env in host', function() {
    it('should recognize prefix format', function(done) {
      request(this.server)
        .get('/')
        .set('Host', 'appname--test.testapps.com')
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.server.settings.virtualAppRegistry.getByName.calledWith('appname'));
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

    it('should call findApp passing in a domain', function(done) {
      var customDomain = {domain: 'www.custom-domain.com'};

      this.server.settings.virtualAppRegistry.getByDomain = sinon.spy(function(domain, callback) {
        callback(null, {domain: customDomain});
      });

      request(this.server)
        .get('/')
        .set('Host', customDomain.domain)
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.server.settings.virtualAppRegistry.getByDomain.calledWith(customDomain.domain));
          assert.deepEqual(res.body.virtualApp.domain, customDomain);
        })
        .end(done);
    });

    it('should redirect custom domain with action of redirect', function(done) {
      var customDomain = {domain: 'custom-domain.com', action: 'redirect'};
      var appUrl = 'http://www.custom-domain.com';

      this.server.settings.virtualAppRegistry.getByDomain = sinon.spy(function(domain, callback) {
        callback(null, {domain: customDomain, url: appUrl});
      });

      request(this.server)
        .get('/')
        .set('Host', customDomain.domain)
        .expect(301)
        .expect(function(res) {
          assert.isTrue(self.server.settings.virtualAppRegistry.getByDomain.calledWith(customDomain.domain));
          assert.equal(res.headers.location, appUrl);
        })
        .end(done);
    });
  });

  describe('app with requireSsl set to true', function() {
    it('should redirect to https', function(done) {
      this.server.settings.virtualAppRegistry.getByName = function(name, callback) {
        callback(null, {requireSsl: true});
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
});
