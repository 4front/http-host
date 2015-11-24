var assert = require('assert');
var _ = require('lodash');
var helper = require('../lib/helper');

describe('helper', function() {
  describe('ensureRequiredOptions()', function() {
    it('throws error for missing option', function() {
      try {
        helper.ensureRequiredOptions({option1: 5}, 'option1', 'option2');
      } catch (err) {
        assert.equal(err.message, 'Required option option2 missing');
        return;
      }

      assert.ok(false);
    });

    it("it throws error when '*Fn' option not a function", function() {
      try {
        helper.ensureRequiredOptions({optionFn: 5}, 'optionFn');
      } catch (err) {
        assert.equal(err.message, 'Option optionFn expected to be a function');
        return;
      }

      assert.ok(false);
    });
  });

  describe('requiredOptionError()', function() {
    it('throws error for missing req.ext property', function() {
      var error = helper.requiredOptionsError({option1: 5}, 'option1', 'option2');
      assert.equal(_.isUndefined(error), false);
      assert.equal(error.message, 'Required option option2 missing');
    });
  });
});
