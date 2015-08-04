var assert = require('assert');
var pluginOptions = require('../lib/plugin-options');

describe('pluginOptions', function() {

  describe('environment variable substitution', function() {
    it('env variable options', function() {
      var options = {
        option1: "env:KEY1",
        another: 'foo',
        more: {
          option2: "env:KEY2"
        }
      };

      var expandedOptions = pluginOptions(options, {
        env: {
          KEY1: {value: 'key1'},
          KEY2: {value: 'key2'}
        }
      });

      assert.deepEqual(expandedOptions, {
        option1: 'key1',
        another: 'foo',
        more: {
          option2: 'key2'
        }
      });
    });

    it('throws error for missing environment variable', function() {
      var options = {
        option1: "env:MISSING",
      };

      assert.throws(function() {
        pluginOptions(options, {
          env: {
            KEY1: {value:'key1'}
          }
        });
      }, function(err) {
        return err.code === 'invalidEnvironmentVariable';
      });
    });
  });

  describe('regex expansion', function() {
    it('turns option into regex', function() {
      var options = {
        option1: "regex:[a-z]+",
      };

      var expandedOptions = pluginOptions(options, {});
      assert.ok(typeof expandedOptions.option1, RegExp);
      debugger;
      assert.equal(expandedOptions.option1.toString(), "/[a-z]+/")
    });

    it('throws error for invalid regex', function() {
      var options = {
        option1: "regex:/\\",
      };

      assert.throws(function() {
        pluginOptions(options, {
          env: {
            KEY1: {value:'key1'}
          }
        });
      }, function(err) {
        return err.code === 'invalidRegexOption';
      });
    });
  });

  describe('user property expansion', function() {
    it('expands user property', function() {
      var options = {
        option1: 'user:username',
        option2: {
          userId: 'user:userId'
        }
      };

      var expandedOptions = pluginOptions(options, {
        user: {
          username: 'Bob',
          userId: '123'
        }
      });

      assert.deepEqual(expandedOptions, {
        option1: 'Bob',
        option2: {
          userId: '123'
        }
      });
    });

    it('throws error for missing user', function() {
      var options = {
        option1: 'user:username'
      };

      assert.throws(function() {
        pluginOptions(options, {});
      }, function(err) {
        return err.code === 'missingSessionUser'
      });
    });

    it('throws error for missing user property', function() {
      var options = {
        option1: 'user:missing_property'
      };

      assert.throws(function() {
        pluginOptions(options, {user:{}});
      }, function(err) {
        return err.code === 'invalidUserProperty'
      });
    });
  });
});
