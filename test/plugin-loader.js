var assert = require('assert');
var sinon = require('sinon');
var path = require('path');
var _ = require('lodash');
var debug = require('debug');

require('dash-assert');

describe('pluginLoader()', function(){
  var self;

  beforeEach(function(){
    self = this;

    this.pluginLoader = require('../lib/plugin-loader')({
      builtInPluginsDir: [path.join(__dirname, "./fixtures/plugins")]
    });
  });

  it('load built-in plugin', function(done) {
    this.pluginLoader("sendtext", {}, function(err, plugin) {
      if (err) return done(err);

      assert.ok(_.isFunction(plugin));
      done();
    });
  });

  it("returns error loading missing plugin", function(done) {
    this.pluginLoader("missing-plugin", {}, function(err, plugin) {
      assert.isDefined(err);
      assert.equal(err.code, "pluginLoadError");

      done();
    });
  });

  it("loads installed plugin", function(done) {
    var options = {
      resave: true,
      saveUninitialized: false,
      secret: 'secret'
    };

    this.pluginLoader("express-session", options, function(err, plugin) {
      if (err) return done(err);
      assert.ok(_.isFunction(plugin));
      done();
    });
  });

  it('returns error for plugin that does not export a function', function(done) {
    this.pluginLoader("invalid-export", {}, function(err, plugin) {
      assert.isDefined(err);
      assert.equal(err.code, "pluginInvalidExport");

      done();
    });
  });

  it('returns error for plugin that does not return a function with 3 args', function(done) {
    this.pluginLoader("invalid-signature", {}, function(err, plugin) {
      assert.isDefined(err);
      assert.equal(err.code, "pluginFunctionSignature");

      done();
    });
  });

  it('returns error for plugin that does returns func with wrong arg names', function(done) {
    this.pluginLoader("wrong-arg-names", {}, function(err, plugin) {
      assert.isDefined(err);
      assert.equal(err.code, "pluginFunctionSignature");

      done();
    });
  });

  it('returns error for plugin that throws error during creation', function(done) {
    this.pluginLoader("throws-error", {}, function(err, plugin) {
      assert.isDefined(err);
      assert.equal(err.code, "pluginCreateError");

      done();
    });
  });
});
