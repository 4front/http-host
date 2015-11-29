var assert = require('assert');
var sinon = require('sinon');
var express = require('express');
var supertest = require('supertest');
var shortid = require('shortid');
var streamTestUtils = require('./stream-test-utils');
var metapages = require('../lib/middleware/metapages');

require('dash-assert');

describe('metapages', function() {
  var self;

  beforeEach(function() {
    self = this;
    this.server = express();
    this.server.set('trust proxy', true);

    this.appId = shortid.generate();
    this.versionId = shortid.generate();

    this.extendedRequest = {
      virtualApp: {
        appId: self.appId
      },
      virtualAppVersion: {
        versionId: self.versionId
      }
    };

    this.storage = this.server.settings.storage = {
      readFileStream: sinon.spy(function() {
        return streamTestUtils.buffer(self.fileContent);
      })
    };

    this.server.use(function(req, res, next) {
      req.ext = self.extendedRequest;
      next();
    });

    this.server.use(metapages(this.server.settings));

    this.server.use(function(req, res, next) {
      res.status(404).end();
    });
  });

  it('returns sitemap.xml', function(done) {
    this.fileContent = '<sitemap></sitemap>';
    supertest(this.server)
      .get('/sitemap.xml')
      .expect('Content-Type', 'application/xml')
      .expect('etag', this.versionId)
      .expect(200)
      .expect(function(res) {
        assert.isTrue(self.storage.readFileStream.calledWith(self.appId + '/' + self.versionId + '/sitemap.xml'));
        assert.equal(res.text, self.fileContent);
      })
      .end(done);
  });

  it('returns robots.txt', function(done) {
    this.fileContent = 'robots';
    supertest(this.server)
      .get('/robots.txt')
      .expect('Content-Type', /^text\/plain/)
      .expect('etag', this.versionId)
      .expect(200)
      .expect(function(res) {
        assert.isTrue(self.storage.readFileStream.calledWith(self.appId + '/' + self.versionId + '/robots.txt'));
        assert.equal(res.text, self.fileContent);
      })
      .end(done);
  });

  it('returns humans.txt', function(done) {
    this.fileContent = 'humans';
    supertest(this.server)
      .get('/humans.txt')
      .expect('Content-Type', /^text\/plain/)
      .expect('etag', this.versionId)
      .expect(200)
      .expect(function(res) {
        assert.isTrue(self.storage.readFileStream.calledWith(self.appId + '/' + self.versionId + '/humans.txt'));
        assert.equal(res.text, self.fileContent);
      })
      .end(done);
  });

  it('skips middleware when file not found', function(done) {
    this.server.settings.storage.readFileStream = function() {
      return streamTestUtils.emitter('missing');
    };

    supertest(this.server)
      .get('/sitemap.xml')
      .expect(404)
      .end(done);
  });

  it('returns 304 for if-none-match match', function(done) {
    supertest(this.server)
      .get('/sitemap.xml')
      .set('if-none-match', this.versionId)
      .expect(304)
      .end(done);
  });
});
