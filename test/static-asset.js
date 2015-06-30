var assert = require('assert');
var express = require('express');
var supertest = require('supertest');
var shortid = require('shortid');
var urljoin = require('url-join');
var staticAsset = require('../lib/middleware/static-asset');

describe('staticAsset', function() {
  var self;

  beforeEach(function() {
    self = this;
    this.server = express();
    this.server.settings.deployedAssetsPath = "/deployments";

    this.server.settings.deployer = {
      serve: function(appId, versionId, filePath, res) {
        res.json({
          appId: appId,
          versionId: versionId,
          filePath: filePath
        });
      }
    };

    this.appId = shortid.generate();
    this.versionId = shortid.generate();
    this.server.use(staticAsset());

    this.server.use(function(req, res, next) {
      res.status(404).end();
    });
  });

  it('serves static asset', function(done) {
    supertest(this.server)
      .get(urljoin(this.server.settings.deployedAssetsPath, this.appId, this.versionId, "images/logo.png"))
      .expect(200)
      .expect(function(res) {
        assert.deepEqual(res.body, {
          appId: self.appId,
          versionId: self.versionId,
          filePath: 'images/logo.png'
        });
      })
      .end(done);
  });

  it('skips middleware for non-matching paths', function(done) {
    supertest(this.server)
      .get("images/logo.png")
      .expect(404, done);
  });

  it('skips middleware if no file name', function(done) {
    supertest(this.server)
      .get(urljoin(this.server.settings.deployedAssetsPath, this.appId, this.versionId))
      .expect(404, done);
  });

  it('skips middleware if deployedAssetsPath does not start with forward slash', function(done) {
    this.server.settings.deployedAssetsPath = "somecdn.com";

    supertest(this.server)
      .get(urljoin(this.server.settings.deployedAssetsPath, this.appId, this.versionId, "images/logo.png"))
      .expect(404, done);
  });
});
