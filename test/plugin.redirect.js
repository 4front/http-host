var redirect = require('../lib/plugins/redirect');
var express = require('express');
var supertest = require('supertest');

require('simple-errors');

describe('redirect plugin', function() {
  var server;
  var redirectOptions;

  beforeEach(function() {
    server = express();

    server.use(function(req, res, next) {
      req.ext = {clientConfig: {}};
      next();
    });

    server.use(function(req, res, next) {
      redirect(redirectOptions)(req, res, next);
    });

    server.get('/', function(req, res, next) {
      res.send('');
    });

    server.use(function(err, req, res, next) {
      if (!err.status) err.status = 500;
      if (err.status === 500 && err.log !== false) {
        process.stderr.write(err.stack);
      }
      res.status(err.status).json(Error.toJson(err));
    });
  });

  it('simple redirect', function(done) {
    redirectOptions = {
      '/blog/old-title': '/blog/new-title'
    };

    supertest(server)
      .get('/blog/old-title')
      .expect(301)
      .expect('Location', '/blog/new-title')
      .end(done);
  });

  it('rename a directory', function(done) {
    redirectOptions = {
      '/help/:pageTitle': '/support/:pageTitle'
    };

    supertest(server)
      .get('/help/how-to-do-something')
      .expect(301)
      .expect('Location', '/support/how-to-do-something')
      .end(done);
  });

  it('invalid redirect pattern causes error', function(done) {
    redirectOptions = {
      '/help/:pageTitle': '/:somethingElse/foo/:anotherParam'
    };

    supertest(server)
      .get('/help/how-to-do-something')
      .expect(500)
      .end(done);
  });

  it('allows redirect rule to be an array', function(done) {
    redirectOptions = {
      '/help/:pageTitle': [302, '/support/:pageTitle']
    };

    supertest(server)
      .get('/help/how-to')
      .expect(302)
      .expect('Location', '/support/how-to')
      .end(done);
  });

  it('causes error for invalid rule array', function(done) {
    redirectOptions = {
      '/help/:pageTitle': [305, '/support/:pageTitle']
    };

    supertest(server)
      .get('/help/how-to')
      .expect(500)
      .end(done);
  });

  it('skips middleware if no matches', function(done) {
    redirectOptions = {
      '/blog/post-1': '/blog/new-post1',
      '/blog/post-2': '/blog/new-post2'
    };

    supertest(server)
      .get('/blog/post-3')
      .expect(404)
      .end(done);
  });

  describe('file extension match', function() {
    before(function() {
      redirectOptions = {
        '/*.php': '/(.*)'
      };
    });

    it('at root', function(done) {
      supertest(server)
        .get('/about.php')
        .expect(301)
        .expect('Location', '/about')
        .end(done);
    });

    it('with sub-folder', function(done) {
      supertest(server)
        .get('/blog/how-to-do-something.php')
        .expect(301)
        .expect('Location', '/blog/how-to-do-something')
        .end(done);
    });
  });

  it('match querystring param', function(done) {
    redirectOptions = {
      'regex:/page.php\\?id=(:<id>[0-9]+)': '/articles/article${id}'
    };

    supertest(server)
      .get('/page.php?id=1')
      .expect(301)
      .expect('Location', '/articles/article1')
      .end(done);
  });

  it('querystring literal', function(done) {
    redirectOptions = {
      'regex:/page.php\\?id=5': '/articles/hello-world'
    };

    supertest(server)
      .get('/page.php?id=5')
      .expect(301)
      .expect('Location', '/articles/hello-world')
      .end(done);
  });

  // it('', function(done) {
  //
  // });
});
