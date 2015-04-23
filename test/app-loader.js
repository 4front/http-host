
var assert = require('assert');
var sinon = require('sinon');
var virtualAppLoader = require('../lib/middleware/app-loader');
var querystring = require('querystring');
var express = require('express');
var shortid = require('shortid');
var request = require('supertest');
var _ = require('lodash');
var debug = require('debug');

require('dash-assert');

describe('virtualAppLoader()', function(){
  var self;

  beforeEach(function(){
    self = this;

    this.server = express();

    this.server.use(function(req, res, next) {
      req.ext = {};
      next();
    });

    this.appId = shortid.generate();
    this.server.settings.virtualHost = 'testapps.com';
    this.server.settings.virtualAppRegistry = {
      getByName: sinon.spy(function(name, callback) {
        callback(null, {
          appId: self.appId,
          name: name
        })
      })
    };

    this.server.use(virtualAppLoader(self.virtualAppLoaderOptions));

    this.server.use(function(req, res, next) {
      res.json(_.pick(req.ext, 'virtualEnv', 'virtualApp', 'virtualHost', 'clientConfig', 'configSettings'));
    });

    this.server.use(function(err, req, res, next) {
      res.statusCode = err.status || 500;
      if (res.statusCode === 500) {
        console.log(err.stack);
        res.end(err.stack);
      }
      else
        res.end();
    });
  });

  describe('virtual env in host', function(){
    it('should recognize prefix format', function(done){
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

    it('should default to prod when no env found', function(done){
      request(this.server)
        .get('/')
        .set('Host', 'appname.testapps.com')
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body.virtualEnv, 'prod');
          assert.equal(res.body.virtualHost, 'appname.testapps.com');
        })
        .end(done);
    });
  });

  describe('virtualAppRegistry returns null', function() {
    it('should return 404', function(done) {
      this.server.settings.virtualAppRegistry.getByName = function(name, cb) {
        cb(null, null)
      };

      request(this.server)
        .get('/')
        .set('Host', 'appname.testapps.com')
        .expect(404, done);
    });
  });

  describe('request with custom domain', function() {
    it('should call findApp passing in a domain', function(done) {
      var customDomain = "www.custom-domain.com";

      this.server.settings.virtualAppRegistry.getByDomain = function(domain, callback) {
        callback(null, {domain: customDomain});
      };

      request(this.server)
        .get('/')
        .set('Host', customDomain)
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body.virtualApp.domain, customDomain);
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

  // describe('virtual app config settings', function() {
  //   beforeEach(function() {
  //     this.configSettings = {
  //       _default: {
  //         setting1: {value: 'foo', sendToClient: true},
  //         apiKey: {envVariable: 'API_KEY'}
  //       }
  //     };

  //     var self = this;
  //     this.virtualAppLoaderOptions.findAppFn = function(query, callback) {
  //       callback(null, { configSettings: self.configSettings });
  //     };

  //     this.envVariables = {
  //       API_KEY: "api-key"
  //     };

  //     this.virtualAppLoaderOptions.envVariable = function(virtualApp, key) {
  //       return self.envVariables[key];
  //     }
  //   });

  //   it('should load settings', function(done) {
  //     request(server)
  //       .get('/path')
  //       .set('Host', 'appname.testapps.com')
  //       .expect(200)
  //       .expect(function(res) {
  //         var configSettings = JSON.parse(res.text).configSettings;
  //         assert.equal(configSettings.setting1, 'foo');
  //         assert.equal(configSettings.apiKey, 'api-key');
  //       })
  //       .end(done);
  //   });

  //   it('should override default with environment specific value', function(done) {
  //     this.configSettings['test'] = {
  //       setting1: {value: 'test-foo'}
  //     };

  //     request(server)
  //       .get('/path')
  //       .set('Host', 'appname--test.testapps.com')
  //       .expect(200)
  //       .expect(function(res) {
  //         var configSettings = JSON.parse(res.text).configSettings;
  //         assert.equal(configSettings.setting1, 'test-foo');
  //       })
  //       .end(done);
  //   });

  //   it('should only add to clientConfig settings where sendToClient===true', function(done) {
  //     this.configSettings = {
  //       _default: {
  //         setting1: {value:'foo', sendToClient:true},
  //         setting2: {value:'bar'}
  //       }
  //     };

  //     request(server)
  //       .get('/path')
  //       .set('Host', 'appname.testapps.com')
  //       .expect(200)
  //       .expect(function(res) {
  //         var clientSettings = JSON.parse(res.text).clientConfig.settings;
  //         debugger;
  //         assert.equal(clientSettings.setting1, 'foo');
  //         assert.ok(_.isUndefined(clientSettings.setting2));
  //       })
  //       .end(done);
  //   });
  // });
});
