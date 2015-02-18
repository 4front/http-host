
var assert = require('assert');
var htmlPageStream = require('../lib/middleware/page-stream');
var querystring = require('querystring');
var express = require('express');
var request = require('supertest');
var _ = require('lodash');
var stream = require('stream');
var debug = require('debug');
var fs = require('fs');
var shortid = require('shortid');

describe('htmlPageStream()', function(){
  var server;

  beforeEach(function(){
    var self = this;

    server = express();

    this.extendedRequest = {
      virtualApp: {
        appId: shortid.generate()
      },
      virtualAppVersion: {
        versionId: shortid.generate()
      }
    };

    server.use(function(req, res, next) {
      req.ext = self.extendedRequest;
      next();
    });

    this.options = {
      assetHost: 'somecdn.com',
      readPageStream: function(virtualApp, version, pageName) {
        return readStream('<html><head></head></html>');
      }
    };

    server.use(htmlPageStream(self.options));

    server.use(function(err, req, res, next) {
      res.statusCode = err.status || 500;
      if (res.statusCode === 500)
        console.log(err.stack);

      res.end(err.stack);
    });
  });

  describe('virtual env in host', function(){
    it('should render ', function(done){
      request(server)
        .get('/')
        .expect(200)
        .expect(function(res) {
          console.log(res.text);
        })
        .end(done);
    });
  });

  describe('when index page does not exist', function() {
    it('should return a 404', function(done) {
      this.options.readPageStream = function(virtualApp, version, pageName) {
        return fs.createReadStream('non-existent.html')
          .on('error', function() {
            this.emit('missing');
          });
      };

      request(server)
        .get('/')
        .expect(404, done);
    });
  });  

  describe('missing extended request objects', function() {
    it('returns 404 when virtualApp is missing', function(done) {
      this.extendedRequest.virtualApp = null;

      request(server)
        .get('/')
        .expect(404, done);
    });

    it('returns 404 when virtualAppVersion is missing', function(done) {
      this.extendedRequest.virtualAppVersion = null;

      request(server)
        .get('/')
        .expect(404, done);
    });
  });

  describe('client config object', function() {
    it('sets object properties', function(done) {
      var self = this;
      var version = this.extendedRequest.virtualAppVersion;
      var virtualApp = this.extendedRequest.virtualApp;

      request(server)
        .get('/')
        .expect(function(res) {
          var clientConfig = parseClientConfig(res.text);
          assert.equal(clientConfig.buildType, 'release');
          assert.equal(clientConfig.pageName, 'index');
          assert.equal(clientConfig.versionId, version.versionId);
          assert.equal(clientConfig.versionName, version.versionName);

          assert.equal(clientConfig.assetPath, '//' + self.options.assetHost + '/' + virtualApp.appId + '/' + version.versionId);
        })
        .end(done);
    });
  });
});

function parseClientConfig(text) {
  return JSON.parse(text.match('__config__=(.*);')[1]);
}

function readStream(str) {
  var Readable = stream.Readable;
  var rs = Readable();
  rs._read = function () {
    rs.push(str);
    rs.push(null);
  };
  return rs;
}