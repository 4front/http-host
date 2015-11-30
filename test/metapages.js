var assert = require('assert');
var sinon = require('sinon');
var express = require('express');
var supertest = require('supertest');
var shortid = require('shortid');
var zlib = require('zlib');
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

  it('returns gzipped sitemap.xml', function(done) {
    var metadata = {
      contentEncoding: 'gzip',
      contentType: 'application/xml'
    };

    var contents = '<sitemap></sitemap>';

    this.storage.readFileStream = sinon.spy(function() {
      return streamTestUtils.buffer(zlib.gzipSync(contents), {
        metadata: metadata
      });
    });

    supertest(this.server)
      .get('/sitemap.xml')
      .expect('Content-Type', metadata.contentType)
      .expect('Content-Encoding', metadata.contentEncoding)
      .expect('etag', this.versionId)
      .expect(200)
      .expect(function(res) {
        assert.isTrue(self.storage.readFileStream.calledWith(self.appId + '/' + self.versionId + '/sitemap.xml'));
        assert.equal(res.text, contents);
      })
      .end(done);
  });

  it('returns robots.txt', function(done) {
    var contents = 'robots';

    var metadata = {
      contentType: 'text/plain'
    };

    this.storage.readFileStream = sinon.spy(function() {
      return streamTestUtils.buffer(contents, {
        metadata: metadata
      });
    });

    supertest(this.server)
      .get('/robots.txt')
      .expect('Content-Type', /^text\/plain/)
      .expect('etag', this.versionId)
      .expect(200)
      .expect(function(res) {
        assert.isTrue(self.storage.readFileStream.calledWith(self.appId + '/' + self.versionId + '/robots.txt'));
        assert.equal(res.text, contents);
      })
      .end(done);
  });

  it('returns humans.txt', function(done) {
    var contents = 'humans';

    var metadata = {
      contentType: 'text/plain'
    };

    this.storage.readFileStream = sinon.spy(function() {
      return streamTestUtils.buffer(contents, {
        metadata: metadata
      });
    });

    supertest(this.server)
      .get('/humans.txt')
      .expect('Content-Type', /^text\/plain/)
      .expect('etag', this.versionId)
      .expect(200)
      .expect(function(res) {
        assert.isTrue(self.storage.readFileStream.calledWith(self.appId + '/' + self.versionId + '/humans.txt'));
        assert.equal(res.text, contents);
      })
      .end(done);
  });

  it('skips middleware when file not found', function(done) {
    this.storage.readFileStream = sinon.spy(function() {
      return streamTestUtils.emitter('missing');
    });

    supertest(this.server)
      .get('/sitemap.xml')
      .expect(404)
      .expect(function(res) {
        assert.isTrue(self.storage.readFileStream.calledWith(self.appId + '/' + self.versionId + '/sitemap.xml'));
      })
      .end(done);
  });

  it('returns 304 for if-none-match match', function(done) {
    supertest(this.server)
      .get('/sitemap.xml')
      .set('if-none-match', this.versionId)
      .expect(304)
      .end(done);
  });

  it('skips middleware when request is not for a recognized metafile', function(done) {
    supertest(this.server)
      .get('/index.html')
      .expect(404)
      .expect(function(res) {
        assert.isFalse(self.storage.readFileStream.called);
      })
      .end(done);
  });
});
