
var assert = require('assert');
var sinon = require('sinon');
var trafficControl = require('../lib/middleware/traffic-control');
var querystring = require('querystring');
var express = require('express');
var request = require('supertest');
var _ = require('lodash');
var testUtil = require('./test-util');
var debug = require('debug');

describe('trafficControl()', function(){
  var server;

  beforeEach(function(){
    var self = this;

    this.server = express();
    this.server.settings.database = {
      getVersion: sinon.spy(function(appId, versionId, callback) {
        callback(null, {versionId: versionId, appId: appId, name: versionId});
      })
    };

    // self.trafficControlRules = [];
    this.extendedRequest = {
      virtualEnv: 'production',
      virtualApp: {
        trafficRules: {
          production: [
            {rule: '*', versionId:'1'}
          ]
        }
      },
      clientConfig: {}
    };

    this.server.use(function(req, res, next) {
      req.ext = self.extendedRequest;
      next();
    });

    this.server.use(require('cookie-parser')());

    this.server.use(trafficControl());

    this.server.use(function(req, res, next) {
      res.json(_.pick(req.ext, 'virtualAppVersion'));
    });

    this.server.use(testUtil.errorHandler);
  });

  describe('passing _version querystring', function(){
    it('should set cookie and redirect', function(done){
      request(this.server)
        .get('/?_version=abc')
        .set('Host', 'testapp.platform.com')
        .expect(302)
        .expect(function(res) {
          var setCookieHeader = res.headers['set-cookie'];

          var cookieValue = encodeURIComponent(JSON.stringify({
            versionId: 'abc',
            method: 'urlOverride'
          }));

          assert.equal(res.headers['set-cookie'][0], '_version=' + cookieValue + '; Path=/; HttpOnly');
          assert.ok(/testapp.platform.com/.test(res.text));
        })
        .end(done);
    });
  });

  describe('when _version cookie', function() {
    it('should use that version', function(done) {
      request(this.server)
        .get('/')
        .set('Cookie', '_version=' + encodeURIComponent(JSON.stringify({versionId:'1.1.1', method:'urlOverride'})))
        .expect(200)
        .expect('Virtual-App-Version-Method', 'urlOverride')
        .expect('Virtual-App-Version-Id', '1.1.1')
        .end(done);
    });
  });

  describe('when traffic control rules', function() {
    it('sends request to single version', function(done) {
      request(this.server)
        .get('/')
        .expect(200)
        .expect('Virtual-App-Version-Id', '1')
        .expect('Virtual-App-Version-Method', 'trafficRules')
        .end(done);
    });

    it('returns 404 if traffic control version is not valid', function(done) {
      this.server.settings.database.getVersion = function(appId, versionId, callback) {
        callback(null, null);
      };

      request(this.server)
        .get('/')
        .expect(404)
        .expect('Error-Code', "versionNotFound")
        .end(done);
    });
  });

  it("returns 404 when no traffic rules configured for environment", function(done) {
    this.extendedRequest.virtualApp.trafficRules.production = [];

    request(this.server)
      .get('/')
      .expect(404)
      .expect('Error-Code', "noTrafficRulesForEnvironment")
      .end(done);
  });

  describe('version in cookie does not exist', function() {
    it('falls back to traffic control rules', function(done) {
      this.server.settings.database.getVersion = function(appId, versionId, callback) {
        if (versionId == '2')
          callback(null, null);
        else
          callback(null, {versionId: versionId});
      };

      request(this.server)
        .get('/')
        .set('Cookie', '_version=' + encodeURIComponent(JSON.stringify({versionId: '2'})))
        .expect(200)
        .expect('Virtual-App-Version-Id', '1')
        .end(done);
    });
  });

  it('reverts to traffic rules if invalid JSON cookie', function(done) {
    request(this.server)
      .get('/')
      .set('Cookie', '_version=invalid_json')
      .expect(200)
      .expect('Virtual-App-Version-Id', '1')
      .expect('Virtual-App-Version-Method', 'trafficRules')
      .expect(function(res) {
        assert.ok(res.headers['set-cookie'][0].indexOf('_version=;') > -1);
      })
      .end(done);
  });
});
