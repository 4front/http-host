var supertest = require('supertest');
var _ = require('lodash');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var memoryCache = require('memory-cache-stream');
var testUtil = require('./test-util');
var streamTestUtils = require('./stream-test-utils');
var pipeResponse = require('../lib/middleware/pipe-response');

require('dash-assert');

describe('pipeResponse', function() {
  var self;

  beforeEach(function() {
    self = this;
    this.server = express();

    _.extend(this.server.settings, {
      deployedAssetsPath: 'cdnhost.com',
      contentCache: memoryCache()
    });

    this.options = {};

    this.appId = shortid.generate();
    this.versionId = shortid.generate();

    this.server.use(function(req, res, next) {
      req.ext = {
        virtualApp: {
          appId: self.appId
        },
        virtualEnv: 'production',
        virtualAppVersion: {
          versionId: self.versionId
        },
        webPageStream: streamTestUtils.buffer(self.pageContent)
      };
      next();
    });

    this.server.use(function(req, res, next) {
      pipeResponse(self.options)(req, res, next);
    });

    this.server.use(testUtil.errorHandler);
  });

  it('correctly adjusts relative paths in custom error pages', function(done) {
    this.options.webPagePath = 'errors/404.html';
    this.pageContent = '<html><head><link href="../css/main.css"></head></html>';

    supertest(this.server)
      .get('/')
      .expect(200)
      .expect(function(res) {
        var expectedCssPath = '//' + self.server.settings.deployedAssetsPath + '/' + self.appId + '/' + self.versionId + '/css/main.css';
        assert.isTrue(res.text.indexOf(expectedCssPath) > 0);
      })
      .end(done);
  });
});
