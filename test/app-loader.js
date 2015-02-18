
var assert = require('assert');
var virtualAppLoader = require('../lib/middleware/app-loader');
var querystring = require('querystring');
var express = require('express');
var request = require('supertest');
var _ = require('lodash');
var debug = require('debug');

describe('virtualAppLoader()', function(){
  var server;

  beforeEach(function(){
    var self = this;

    server = express();

    server.use(function(req, res, next) {
      req.ext = {};
      next();
    });

    this.virtualAppLoaderOptions = {
      virtualHostDomain: 'testapps.com',
      findApp: function(query, callback) {
        if (_.isEmpty(query.name) === false)
          callback(null, {name: query.name});
        else if (_.isEmpty(query.domain) === false)
          callback(null, {name: 'custom-domain'});
      }
    };

    server.use(virtualAppLoader(self.virtualAppLoaderOptions));

    server.use(function(req, res, next) {
      res.json(_.pick(req.ext, 'virtualEnv', 'virtualApp', 'virtualHost', 'clientConfig', 'configSettings'));
    });

    server.use(function(err, req, res, next) {
      res.statusCode = err.status || 500;
      if (res.statusCode === 500) {
        console.log(err);
        res.end(err.stack);
      }
      else 
        res.end();
    });
  });

  describe('virtual env in host', function(){
    it('should recognize prefix format', function(done){
      request(server)
        .get('/')
        .set('Host', 'appname--test.testapps.com')
        .expect(200)
        .expect(function(res) {
          var json = JSON.parse(res.text);
          assert.equal(json.virtualEnv, 'test');
          assert.equal(json.virtualHost, 'appname.testapps.com');
        })
        .end(done);
    });

    it('should default to prod when no env found', function(done){
      request(server)
        .get('/')
        .set('Host', 'appname.testapps.com')
        .expect(200)
        .expect(function(res) {
          var json = JSON.parse(res.text);
          assert.equal(json.virtualEnv, 'prod');
          assert.equal(json.virtualHost, 'appname.testapps.com');
        })
        .end(done);
    });
  });

  describe('findApp returns null', function() {
    it('should return 404', function(done) {
      this.virtualAppLoaderOptions.findApp = function(query, callback) {
        debugger;
        callback(null);
      };

      request(server)
        .get('/')
        .set('Host', 'appname.testapps.com')
        .expect(404, done);
    });
  });

  describe('request with custom domain', function() {
    it('should call findApp passing in a domain', function(done) {
      var customDomain = "www.custom-domain.com";

      this.virtualAppLoaderOptions.findApp = function(query, callback) {
        callback(null, {domain: customDomain});
      };

      request(server)
        .get('/')
        .set('Host', customDomain)
        .expect(200)
        .expect(function(res) {
          assert.equal(JSON.parse(res.text).virtualApp.domain, customDomain);
        })
        .end(done);
    });
  });

  describe('app with requireSsl set to true', function() {
    it('should redirect to https', function(done) {
      this.virtualAppLoaderOptions.findApp = function(query, callback) {
        callback(null, {requireSsl: true});
      };

      request(server)
        .get('/path')
        .set('Host', 'appname.testapps.com')
        .expect(302)
        .expect(function(res) {
          assert.ok(res.text.indexOf('https://appname.testapps.com/path') > 0);
        })
        .end(done);
    });
  });

  describe('virtual app config settings', function() {
    beforeEach(function() {
      this.configSettings = {
        _default: {
          setting1: {value: 'foo', sendToClient: true},
          apiKey: {envVariable: 'API_KEY'}
        }
      };

      var self = this;
      this.virtualAppLoaderOptions.findApp = function(query, callback) {
        callback(null, { configSettings: self.configSettings });
      };

      this.envVariables = {
        API_KEY: "api-key"
      };

      this.virtualAppLoaderOptions.envVariable = function(virtualApp, key) {
        return self.envVariables[key];
      }
    });

    it('should load settings', function(done) {
      request(server)
        .get('/path')
        .set('Host', 'appname.testapps.com')
        .expect(200)
        .expect(function(res) {
          var configSettings = JSON.parse(res.text).configSettings;
          assert.equal(configSettings.setting1, 'foo');
          assert.equal(configSettings.apiKey, 'api-key');
        })
        .end(done);
    });

    it('should override default with environment specific value', function(done) {
      this.configSettings['test'] = {
        setting1: {value: 'test-foo'}
      };

      request(server)
        .get('/path')
        .set('Host', 'appname--test.testapps.com')
        .expect(200)
        .expect(function(res) {
          var configSettings = JSON.parse(res.text).configSettings;
          assert.equal(configSettings.setting1, 'test-foo');
        })
        .end(done);
    });

    it('should only add to clientConfig settings where sendToClient===true', function(done) {
      this.configSettings = {
        _default: {
          setting1: {value:'foo', sendToClient:true},
          setting2: {value:'bar'}
        }
      };

      request(server)
        .get('/path')
        .set('Host', 'appname.testapps.com')
        .expect(200)
        .expect(function(res) {
          var clientSettings = JSON.parse(res.text).clientConfig.settings;
          debugger;
          assert.equal(clientSettings.setting1, 'foo');
          assert.ok(_.isUndefined(clientSettings.setting2));
        })
        .end(done);
    });
  });
});