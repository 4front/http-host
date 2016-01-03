var assert = require('assert');
var _ = require('lodash');
var debug = require('debug');

var loaderSettings = require('./fixtures/plugin-loader-settings');
var pluginLoader = require('../lib/plugin-loader')(loaderSettings);

require('dash-assert');

describe('pluginLoader()', function() {
  it('load built-in plugin', function(done) {
    pluginLoader('sendtext', {}, function(err, plugin) {
      if (err) return done(err);

      assert.ok(_.isFunction(plugin));
      done();
    });
  });

  it('returns error loading missing plugin', function(done) {
    pluginLoader('missing-plugin', {}, function(err) {
      assert.isDefined(err);
      assert.equal(err.code, 'pluginRequireError');

      done();
    });
  });

  it('loads installed plugin', function(done) {
    var options = {
      resave: true,
      saveUninitialized: false,
      secret: 'secret'
    };

    pluginLoader('express-session', options, function(err, plugin) {
      if (err) return done(err);
      assert.ok(_.isFunction(plugin));
      done();
    });
  });

  it('returns error for plugin that does not export a function', function(done) {
    pluginLoader('invalid-export', {}, function(err) {
      assert.isDefined(err);
      assert.equal(err.code, 'pluginInvalidExport');

      done();
    });
  });

  it('returns error for plugin that does not return a function with 3 args', function(done) {
    pluginLoader('invalid-signature', {}, function(err) {
      assert.isDefined(err);
      assert.equal(err.code, 'pluginFunctionSignature');

      done();
    });
  });

  it('returns error for plugin that does returns func with wrong arg names', function(done) {
    pluginLoader('wrong-arg-names', {}, function(err) {
      assert.isDefined(err);
      assert.equal(err.code, 'pluginFunctionSignature');

      done();
    });
  });

  it('returns error for plugin that throws error during creation', function(done) {
    pluginLoader('throws-error', {}, function(err) {
      assert.isDefined(err);
      assert.equal(err.code, 'pluginCreateError');

      done();
    });
  });
});
