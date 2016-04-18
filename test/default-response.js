var defaultResponse = require('../lib/middleware/default-response');
var express = require('express');
var shortid = require('shortid');
var request = require('supertest');
var testUtil = require('./test-util');
var debug = require('debug');

require('dash-assert');

describe('defaultResponse()', function() {
  var self;
  beforeEach(function() {
    self = this;
    this.server = express();

    this.versionId = shortid.generate();

    this.extendedRequest = {
      virtualAppVersion: {versionId: self.versionId}
    };

    this.server.use(function(req, res, next) {
      req.ext = self.extendedRequest;
      next();
    });

    this.server.use(defaultResponse(this.server.settings));

    this.server.use(function(req, res, next) {
      res.status(404).send('not found');
    });

    this.server.use(testUtil.errorHandler);
  });

  it('returns default favicon', function(done) {
    request(this.server).get('/favicon.ico')
      .expect(200)
      .expect('Content-Type', 'image/x-icon')
      .expect('ETag', self.versionId)
      .end(done);
  });

  it('returns default robots.txt', function(done) {
    request(this.server).get('/robots.txt')
      .expect(200)
      .expect('Content-Type', 'text/plain')
      .expect('ETag', self.versionId)
      .end(done);
  });

  it('return 404 for request without a default response', function(done) {
    request(this.server).get('/')
      .expect(404)
      .end(done);
  });
});
